import { Hono } from 'hono';

import {
	MAIL_LIMITS,
	type MailAccess,
	type MailAttachment,
	type MailboxInfo,
	type MailboxInput,
	type MailMessage,
	type MailNote,
	type MailStatus,
	type MailTestResult,
	type MailThread,
	type MailThreadDetail,
} from '../../shared/mail';
import { P, has } from '../../shared/permissions';
import { loadActor } from '../grades';
import { cleanName, fail, readJson, workspaceStub, type AppEnv, type Ctx } from '../http';
import { ImapClient } from '../mail/imap';
import { seal, unseal } from '../mail/secret';
import { smtpSend } from '../mail/smtp';
import { MailError, attachmentKey, bodyKey, loadBox, sendReply, type BoxRow } from '../mail/store';
import { transport } from '../mail/wire';

export const mailRoutes = new Hono<AppEnv>();

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const OWNER: MailAccess = { owner: true, view: true, reply: true, manage: true };

// Hôtes internes refusés : le Worker ne sert pas de rebond.
export function privateHost(host: string): boolean {
	if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) {
		return true;
	}
	const ip = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
	if (!ip) {
		return false;
	}
	const a = Number(ip[1]);
	const b = Number(ip[2]);
	return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

const hostOf = (value: unknown) => {
	const host = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return HOST_RE.test(host) ? host : '';
};

type BoxFields = Required<Omit<MailboxInput, 'password'>> & { password: string | null };

function parseInput(body: Partial<MailboxInput>, requirePassword: boolean): BoxFields | string {
	const name = cleanName(body.name);
	const address = typeof body.address === 'string' ? body.address.trim().toLowerCase() : '';
	const imapHost = hostOf(body.imapHost);
	const smtpHost = hostOf(body.smtpHost);
	const imapPort = Number(body.imapPort ?? 993);
	const smtpPort = Number(body.smtpPort);
	const username = typeof body.username === 'string' ? body.username.trim() : '';
	const password = typeof body.password === 'string' && body.password !== '' ? body.password : null;
	if (!name) {
		return 'Nom requis';
	}
	if (!EMAIL_RE.test(address) || address.length > 254) {
		return 'Adresse invalide';
	}
	if (!imapHost || !smtpHost) {
		return 'Serveur invalide';
	}
	if (privateHost(imapHost) || privateHost(smtpHost)) {
		return 'Serveur interne refusé';
	}
	if (imapPort !== 993) {
		return 'IMAP : port 993 (TLS) uniquement';
	}
	if (smtpPort !== 465 && smtpPort !== 587) {
		return 'SMTP : port 465 (TLS) ou 587 (STARTTLS)';
	}
	if (!username || username.length > 254 || /[\r\n]/.test(username)) {
		return 'Identifiant invalide';
	}
	if (password !== null && (password.length > 512 || /[\r\n]/.test(password))) {
		return 'Mot de passe invalide';
	}
	if (requirePassword && password === null) {
		return 'Mot de passe d’application requis';
	}
	return { name, address, imapHost, imapPort, smtpHost, smtpPort, username, password };
}

const parseIds = (raw: string): string[] => {
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
};

type PermCache = Map<string, number>;

const mailboxStub = (env: Env, id: string) => env.MAILBOX.getByName(id);

// Accès hors propriétaire : union des permissions de grade des espaces de partage.
async function accessFor(c: Ctx, box: BoxRow, userId: string, cache: PermCache = new Map()): Promise<MailAccess> {
	if (box.owner_id === userId) {
		return OWNER;
	}
	const { results } = await c.env.DB.prepare(
		'SELECT s.workspace_id FROM mailbox_shares s JOIN members m ON m.workspace_id = s.workspace_id AND m.user_id = ? WHERE s.mailbox_id = ?',
	)
		.bind(userId, box.id)
		.all<{ workspace_id: string }>();
	let perms = 0;
	for (const { workspace_id } of results) {
		const key = `${workspace_id}:${userId}`;
		if (!cache.has(key)) {
			cache.set(key, (await loadActor(c.env.DB, workspace_id, userId))?.perms ?? 0);
		}
		perms |= cache.get(key)!;
	}
	const view = has(perms, P.MAIL_VIEW) || has(perms, P.MANAGE_MAIL);
	return { owner: false, view, reply: view && has(perms, P.MAIL_REPLY), manage: has(perms, P.MANAGE_MAIL) };
}

type Access = MailAccess & { box: BoxRow };

async function boxAccess(c: Ctx, id: string): Promise<Access | null> {
	const box = await loadBox(c.env.DB, id);
	if (!box) {
		return null;
	}
	const access = await accessFor(c, box, c.get('user').id);
	return access.view ? { ...access, box } : null;
}

async function visibleBoxes(c: Ctx): Promise<Access[]> {
	const userId = c.get('user').id;
	const { results } = await c.env.DB.prepare(
		'SELECT DISTINCT b.* FROM mailboxes b LEFT JOIN mailbox_shares s ON s.mailbox_id = b.id LEFT JOIN members m ON m.workspace_id = s.workspace_id AND m.user_id = ? WHERE b.owner_id = ? OR m.user_id IS NOT NULL ORDER BY b.name COLLATE NOCASE',
	)
		.bind(userId, userId)
		.all<BoxRow>();
	const cache: PermCache = new Map();
	const out: Access[] = [];
	for (const box of results) {
		const access = await accessFor(c, box, userId, cache);
		if (access.view) {
			out.push({ ...access, box });
		}
	}
	return out;
}

async function boxJson(c: Ctx, box: BoxRow, access: MailAccess): Promise<MailboxInfo> {
	const [shares, owner] = await c.env.DB.batch([
		c.env.DB.prepare(
			'SELECT s.workspace_id, w.name, s.channel_ids, EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = s.workspace_id AND m.user_id = ?) AS mine FROM mailbox_shares s JOIN workspaces w ON w.id = s.workspace_id WHERE s.mailbox_id = ? ORDER BY w.name COLLATE NOCASE',
		).bind(c.get('user').id, box.id),
		c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(box.owner_id),
	]);
	return {
		id: box.id,
		name: box.name,
		address: box.address,
		ownerId: box.owner_id,
		ownerName: (owner!.results[0] as { name: string } | undefined)?.name ?? '',
		access: { owner: access.owner, view: access.view, reply: access.reply, manage: access.manage },
		shares: (shares!.results as Array<{ workspace_id: string; name: string; channel_ids: string; mine: number }>)
			.filter((share) => access.owner || share.mine === 1)
			.map((share) => ({ workspaceId: share.workspace_id, workspaceName: share.name, channelIds: parseIds(share.channel_ids) })),
		syncedAt: box.synced_at,
		syncError: box.sync_error,
		config: access.owner ? { imapHost: box.imap_host, imapPort: box.imap_port, smtpHost: box.smtp_host, smtpPort: box.smtp_port, username: box.username } : null,
	};
}

async function ownedBox(c: Ctx, id: string): Promise<BoxRow | Response> {
	const box = await loadBox(c.env.DB, id);
	const userId = c.get('user').id;
	if (box?.owner_id === userId) {
		return box;
	}
	const visible = box ? (await accessFor(c, box, userId)).view : false;
	return visible ? fail(c, 403, 'Réservé au propriétaire de la boîte') : fail(c, 404, 'Boîte introuvable');
}

const unavailable = (c: Ctx) => c.json({ error: 'Mail non configuré' }, 503);

mailRoutes.get('/mail/boxes', async (c) => {
	const boxes = await visibleBoxes(c);
	return c.json(await Promise.all(boxes.map((access) => boxJson(c, access.box, access))));
});

mailRoutes.post('/mail/boxes', async (c) => {
	if (!c.env.MAIL_KEY) {
		return unavailable(c);
	}
	const input = parseInput(await readJson<MailboxInput>(c), true);
	if (typeof input === 'string') {
		return fail(c, 400, input);
	}
	const id = crypto.randomUUID();
	await c.env.DB.prepare(
		'INSERT INTO mailboxes (id, owner_id, name, address, imap_host, imap_port, smtp_host, smtp_port, username, secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
	)
		.bind(id, c.get('user').id, input.name, input.address, input.imapHost, input.imapPort, input.smtpHost, input.smtpPort, input.username, await seal(c.env.MAIL_KEY, input.password!), Date.now())
		.run();
	await mailboxStub(c.env, id).start(id);
	return c.json(await boxJson(c, (await loadBox(c.env.DB, id))!, OWNER), 201);
});

mailRoutes.patch('/mail/boxes/:id', async (c) => {
	if (!c.env.MAIL_KEY) {
		return unavailable(c);
	}
	const box = await ownedBox(c, c.req.param('id'));
	if (box instanceof Response) {
		return box;
	}
	const input = parseInput(await readJson<MailboxInput>(c), false);
	if (typeof input === 'string') {
		return fail(c, 400, input);
	}
	const secret = input.password === null ? box.secret : await seal(c.env.MAIL_KEY, input.password);
	// Autre serveur ou autre compte : les UID connus ne valent plus.
	const moved = input.imapHost !== box.imap_host || input.username !== box.username ? 1 : 0;
	await c.env.DB.prepare(
		'UPDATE mailboxes SET name = ?, address = ?, imap_host = ?, imap_port = ?, smtp_host = ?, smtp_port = ?, username = ?, secret = ?, sync_error = NULL, last_uid = CASE WHEN ? THEN 0 ELSE last_uid END, uid_validity = CASE WHEN ? THEN 0 ELSE uid_validity END WHERE id = ?',
	)
		.bind(input.name, input.address, input.imapHost, input.imapPort, input.smtpHost, input.smtpPort, input.username, secret, moved, moved, box.id)
		.run();
	await mailboxStub(c.env, box.id).start(box.id);
	return c.json(await boxJson(c, (await loadBox(c.env.DB, box.id))!, OWNER));
});

mailRoutes.delete('/mail/boxes/:id', async (c) => {
	const box = await ownedBox(c, c.req.param('id'));
	if (box instanceof Response) {
		return box;
	}
	await mailboxStub(c.env, box.id).stop();
	await c.env.DB.prepare('DELETE FROM mailboxes WHERE id = ?').bind(box.id).run();
	let cursor: string | undefined;
	do {
		const page = await c.env.FILES.list({ prefix: `mail/${box.id}/`, cursor });
		if (page.objects.length) {
			await c.env.FILES.delete(page.objects.map((object) => object.key));
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return c.json({ ok: true });
});

mailRoutes.post('/mail/test', async (c) => {
	const body = await readJson<MailboxInput & { id: string }>(c);
	let password = typeof body.password === 'string' && body.password ? body.password : undefined;
	if (!password && typeof body.id === 'string') {
		const box = await ownedBox(c, body.id);
		if (box instanceof Response) {
			return box;
		}
		if (!c.env.MAIL_KEY) {
			return unavailable(c);
		}
		password = await unseal(c.env.MAIL_KEY, box.secret);
	}
	const input = parseInput({ ...body, password }, true);
	if (typeof input === 'string') {
		return fail(c, 400, input);
	}
	const secret = input.password!;
	const [imap, smtp] = await Promise.all([
		(async () => {
			const client = await ImapClient.open(transport.open, input.imapHost, input.imapPort, Date.now() + 15_000);
			try {
				await client.login(input.username, secret);
			} finally {
				await client.logout();
			}
		})().then(() => null, errorMessage),
		smtpSend(transport.open, { host: input.smtpHost, port: input.smtpPort, username: input.username, password: secret }, Date.now() + 15_000).then(() => null, errorMessage),
	]);
	return c.json({ imap, smtp } satisfies MailTestResult);
});

mailRoutes.post('/mail/boxes/:id/sync', async (c) => {
	const access = await boxAccess(c, c.req.param('id'));
	if (!access) {
		return fail(c, 404, 'Boîte introuvable');
	}
	if (!access.manage) {
		return fail(c, 403, 'Permission insuffisante');
	}
	const { fetched } = await mailboxStub(c.env, access.box.id).syncNow();
	return c.json({ fetched, box: await boxJson(c, (await loadBox(c.env.DB, access.box.id))!, access) });
});

// Propriétaire : partage initial. Gestionnaire de l'espace : salons d'une boîte déjà partagée.
mailRoutes.put('/mail/boxes/:id/shares/:wid', async (c) => {
	const userId = c.get('user').id;
	const workspaceId = c.req.param('wid');
	const box = await loadBox(c.env.DB, c.req.param('id'));
	const actor = await loadActor(c.env.DB, workspaceId, userId);
	if (!box || !actor) {
		return fail(c, 404, box ? 'Espace introuvable' : 'Boîte introuvable');
	}
	const shared = await c.env.DB.prepare('SELECT 1 FROM mailbox_shares WHERE mailbox_id = ? AND workspace_id = ?').bind(box.id, workspaceId).first();
	if (!has(actor.perms, P.MANAGE_MAIL) || (box.owner_id !== userId && !shared)) {
		return fail(c, 403, 'Permission insuffisante');
	}
	const { channelIds } = await readJson<{ channelIds: string[] }>(c);
	const visible = new Set((await workspaceStub(c.env, workspaceId).channels(actor)).map((channel) => channel.id));
	const ids = Array.isArray(channelIds) ? [...new Set(channelIds.filter((id): id is string => typeof id === 'string' && visible.has(id)))] : [];
	await c.env.DB.prepare(
		'INSERT INTO mailbox_shares (mailbox_id, workspace_id, channel_ids, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (mailbox_id, workspace_id) DO UPDATE SET channel_ids = excluded.channel_ids',
	)
		.bind(box.id, workspaceId, JSON.stringify(ids), Date.now())
		.run();
	return c.json(await boxJson(c, box, await accessFor(c, box, userId)));
});

mailRoutes.delete('/mail/boxes/:id/shares/:wid', async (c) => {
	const userId = c.get('user').id;
	const workspaceId = c.req.param('wid');
	const box = await loadBox(c.env.DB, c.req.param('id'));
	if (!box) {
		return fail(c, 404, 'Boîte introuvable');
	}
	const actor = await loadActor(c.env.DB, workspaceId, userId);
	if (box.owner_id !== userId && !(actor && has(actor.perms, P.MANAGE_MAIL))) {
		return fail(c, 403, 'Permission insuffisante');
	}
	await c.env.DB.prepare('DELETE FROM mailbox_shares WHERE mailbox_id = ? AND workspace_id = ?').bind(box.id, workspaceId).run();
	return c.json({ ok: true });
});

type ThreadRow = {
	id: string;
	mailbox_id: string;
	subject: string;
	snippet: string;
	participants: string;
	status: MailStatus;
	assignee_id: string | null;
	assignee_name: string | null;
	message_count: number;
	last_at: number;
};

const THREAD_SELECT =
	'SELECT t.id, t.mailbox_id, t.subject, t.snippet, t.participants, t.status, t.assignee_id, u.name AS assignee_name, t.message_count, t.last_at FROM mail_threads t LEFT JOIN users u ON u.id = t.assignee_id';

const toThread = (row: ThreadRow): MailThread => ({
	id: row.id,
	mailboxId: row.mailbox_id,
	subject: row.subject,
	snippet: row.snippet,
	from: row.participants,
	status: row.status,
	assigneeId: row.assignee_id,
	assigneeName: row.assignee_name,
	messageCount: row.message_count,
	lastAt: row.last_at,
});

mailRoutes.get('/mail/threads', async (c) => {
	const boxFilter = c.req.query('box');
	const workspaceFilter = c.req.query('workspace');
	const status: MailStatus = c.req.query('status') === 'done' ? 'done' : 'open';
	const before = Number(c.req.query('before'));
	let boxes = await visibleBoxes(c);
	if (boxFilter) {
		boxes = boxes.filter((access) => access.box.id === boxFilter);
	}
	if (workspaceFilter) {
		const { results } = await c.env.DB.prepare('SELECT mailbox_id FROM mailbox_shares WHERE workspace_id = ?').bind(workspaceFilter).all<{ mailbox_id: string }>();
		const inWorkspace = new Set(results.map((row) => row.mailbox_id));
		boxes = boxes.filter((access) => inWorkspace.has(access.box.id));
	}
	// Plafond de paramètres D1.
	const ids = boxes.slice(0, 90).map((access) => access.box.id);
	if (!ids.length) {
		return c.json([]);
	}
	const binds: Array<string | number> = [...ids, status];
	let sql = `${THREAD_SELECT} WHERE t.mailbox_id IN (${ids.map(() => '?').join(', ')}) AND t.status = ?`;
	if (c.req.query('mine') === '1') {
		sql += ' AND t.assignee_id = ?';
		binds.push(c.get('user').id);
	}
	if (Number.isInteger(before) && before > 0) {
		sql += ' AND t.last_at < ?';
		binds.push(before);
	}
	const { results } = await c.env.DB.prepare(`${sql} ORDER BY t.last_at DESC LIMIT 50`)
		.bind(...binds)
		.all<ThreadRow>();
	return c.json(results.map(toThread));
});

async function threadAccess(c: Ctx, id: string): Promise<{ thread: ThreadRow; access: Access } | null> {
	const thread = await c.env.DB.prepare(`${THREAD_SELECT} WHERE t.id = ?`).bind(id).first<ThreadRow>();
	const access = thread ? await boxAccess(c, thread.mailbox_id) : null;
	return thread && access ? { thread, access } : null;
}

mailRoutes.get('/mail/threads/:tid', async (c) => {
	const found = await threadAccess(c, c.req.param('tid'));
	if (!found) {
		return fail(c, 404, 'Conversation introuvable');
	}
	const { thread, access } = found;
	const [messages, notes] = await c.env.DB.batch([
		c.env.DB.prepare(
			'SELECT id, direction, from_name, from_addr, to_addrs, cc_addrs, subject, date, attachments, sent_by FROM mail_messages WHERE thread_id = ? ORDER BY date, created_at',
		).bind(thread.id),
		c.env.DB.prepare(
			'SELECT n.id, n.author_id, u.name AS author_name, n.body, n.created_at FROM mail_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.thread_id = ? ORDER BY n.created_at',
		).bind(thread.id),
	]);
	type MessageRow = {
		id: string;
		direction: 'in' | 'out';
		from_name: string;
		from_addr: string;
		to_addrs: string;
		cc_addrs: string;
		subject: string;
		date: number;
		attachments: string;
		sent_by: string | null;
	};
	const rows = messages!.results as MessageRow[];
	const bodies = await Promise.all(rows.map(async (row) => (await (await c.env.FILES.get(bodyKey(thread.mailbox_id, row.id)))?.text()) ?? ''));
	return c.json({
		thread: toThread(thread),
		messages: rows.map(
			(row, i): MailMessage => ({
				id: row.id,
				direction: row.direction,
				fromName: row.from_name,
				fromAddr: row.from_addr,
				to: row.to_addrs,
				cc: row.cc_addrs,
				subject: row.subject,
				date: row.date,
				body: bodies[i] ?? '',
				attachments: JSON.parse(row.attachments) as MailAttachment[],
				sentBy: row.sent_by,
			}),
		),
		notes: (notes!.results as Array<{ id: string; author_id: string | null; author_name: string | null; body: string; created_at: number }>).map((row) => ({
			id: row.id,
			authorId: row.author_id,
			authorName: row.author_name ?? 'Ancien membre',
			body: row.body,
			createdAt: row.created_at,
		})),
		access: { owner: access.owner, view: access.view, reply: access.reply, manage: access.manage },
	} satisfies MailThreadDetail);
});

mailRoutes.patch('/mail/threads/:tid', async (c) => {
	const found = await threadAccess(c, c.req.param('tid'));
	if (!found) {
		return fail(c, 404, 'Conversation introuvable');
	}
	const { thread, access } = found;
	if (!access.reply) {
		return fail(c, 403, 'Permission insuffisante');
	}
	const body = await readJson<{ status: MailStatus; assigneeId: string | null }>(c);
	let status = thread.status;
	let assignee = thread.assignee_id;
	if (body.status !== undefined) {
		if (body.status !== 'open' && body.status !== 'done') {
			return fail(c, 400, 'Statut invalide');
		}
		status = body.status;
	}
	if (body.assigneeId !== undefined) {
		if (body.assigneeId !== null && typeof body.assigneeId !== 'string') {
			return fail(c, 400, 'Membre invalide');
		}
		if (body.assigneeId && !(await accessFor(c, access.box, body.assigneeId)).view) {
			return fail(c, 400, 'Ce membre n’a pas accès à cette boîte');
		}
		assignee = body.assigneeId || null;
	}
	await c.env.DB.prepare('UPDATE mail_threads SET status = ?, assignee_id = ? WHERE id = ?').bind(status, assignee, thread.id).run();
	const userId = c.get('user').id;
	const target = assignee;
	if (target && target !== thread.assignee_id && target !== userId) {
		const { results } = await c.env.DB.prepare(
			'SELECT s.workspace_id FROM mailbox_shares s JOIN members m ON m.workspace_id = s.workspace_id AND m.user_id = ? WHERE s.mailbox_id = ?',
		)
			.bind(target, access.box.id)
			.all<{ workspace_id: string }>();
		await Promise.all(
			results.map((row, i) =>
				workspaceStub(c.env, row.workspace_id).mailNotify(target, { t: 'mail_assigned', mailboxId: access.box.id, threadId: thread.id, subject: thread.subject, by: userId }, i === 0),
			),
		);
	}
	const updated = await c.env.DB.prepare(`${THREAD_SELECT} WHERE t.id = ?`).bind(thread.id).first<ThreadRow>();
	return c.json(toThread(updated!));
});

mailRoutes.post('/mail/threads/:tid/notes', async (c) => {
	const found = await threadAccess(c, c.req.param('tid'));
	if (!found) {
		return fail(c, 404, 'Conversation introuvable');
	}
	if (!found.access.reply) {
		return fail(c, 403, 'Permission insuffisante');
	}
	const { body } = await readJson<{ body: string }>(c);
	const text = typeof body === 'string' ? body.trim() : '';
	if (!text || text.length > MAIL_LIMITS.noteLength) {
		return fail(c, 400, 'Note vide ou trop longue');
	}
	const user = c.get('user');
	const note: MailNote = { id: crypto.randomUUID(), authorId: user.id, authorName: user.name, body: text, createdAt: Date.now() };
	await c.env.DB.prepare('INSERT INTO mail_notes (id, thread_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
		.bind(note.id, found.thread.id, user.id, text, note.createdAt)
		.run();
	return c.json(note, 201);
});

mailRoutes.post('/mail/threads/:tid/reply', async (c) => {
	const found = await threadAccess(c, c.req.param('tid'));
	if (!found) {
		return fail(c, 404, 'Conversation introuvable');
	}
	if (!found.access.reply) {
		return fail(c, 403, 'Permission insuffisante');
	}
	if (!c.env.MAIL_KEY) {
		return unavailable(c);
	}
	const { body } = await readJson<{ body: string }>(c);
	const text = typeof body === 'string' ? body.trim() : '';
	if (!text || text.length > MAIL_LIMITS.bodyLength) {
		return fail(c, 400, 'Réponse vide ou trop longue');
	}
	try {
		return c.json(await sendReply(c.env, found.access.box, found.thread.id, c.get('user'), text, transport.open), 201);
	} catch (error) {
		if (error instanceof MailError) {
			return fail(c, 400, error.message);
		}
		return c.json({ error: `Envoi impossible : ${errorMessage(error)}` }, 502);
	}
});

mailRoutes.get('/mail/messages/:mid/attachments/:n', async (c) => {
	const messageId = c.req.param('mid');
	const row = await c.env.DB.prepare('SELECT mailbox_id FROM mail_messages WHERE id = ?').bind(messageId).first<{ mailbox_id: string }>();
	const access = row ? await boxAccess(c, row.mailbox_id) : null;
	const index = Number(c.req.param('n'));
	const object = row && access && Number.isInteger(index) && index >= 0 ? await c.env.FILES.get(attachmentKey(row.mailbox_id, messageId, index)) : null;
	if (!object) {
		return fail(c, 404, 'Pièce jointe introuvable');
	}
	const type = object.httpMetadata?.contentType ?? 'application/octet-stream';
	const inline = IMAGE_TYPES.has(type);
	return new Response(object.body, {
		headers: {
			'Content-Type': inline ? type : 'application/octet-stream',
			'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(object.customMetadata?.name ?? 'piece-jointe')}`,
			'Content-Security-Policy': "default-src 'none'; sandbox",
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, max-age=3600',
			'Content-Length': String(object.size),
		},
	});
});
