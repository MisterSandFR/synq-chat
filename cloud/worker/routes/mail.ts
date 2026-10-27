import { Hono } from 'hono';

import {
	MAIL_LIMITS,
	type MailAccess,
	type MailAddress,
	type MailAiInput,
	type MailAiResult,
	type MailAttachment,
	type MailboxInfo,
	type MailboxInput,
	type MailCard,
	type MailDraft,
	type MailHtml,
	type MailMessage,
	type MailNote,
	type MailSendInput,
	type MailShareInput,
	type MailStatus,
	type MailTestResult,
	type MailThread,
	type MailThreadDetail,
	type MailUpload,
} from '../../shared/mail';
import { P, has } from '../../shared/permissions';
import { loadActor } from '../grades';
import { cleanName, fail, readJson, unwrap, workspaceStub, type AppEnv, type Ctx } from '../http';
import { AI_ACTIONS, AI_TONES, ai, mailPrompt, parseSuggestions, type AiTone } from '../mail/ai';
import { sanitizeMail, textDocument } from '../mail/html';
import { ImapClient } from '../mail/imap';
import { binary, parseAddresses } from '../mail/mime';
import { seal, unseal } from '../mail/secret';
import { smtpSend, type OutgoingAttachment } from '../mail/smtp';
import { MailError, attachmentKey, bodyKey, htmlKey, loadBox, sendMail, sendReply, type BoxRow } from '../mail/store';
import { transport } from '../mail/wire';
import { uniqueNames, zipStore } from '../mail/zip';

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
	pinned: number;
	snoozed_until: number | null;
};

const THREAD_SELECT =
	'SELECT t.id, t.mailbox_id, t.subject, t.snippet, t.participants, t.status, t.assignee_id, u.name AS assignee_name, t.message_count, t.last_at, t.pinned, t.snoozed_until FROM mail_threads t LEFT JOIN users u ON u.id = t.assignee_id';

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
	pinned: row.pinned === 1,
	snoozedUntil: row.snoozed_until,
});

mailRoutes.get('/mail/threads', async (c) => {
	const boxFilter = c.req.query('box');
	const workspaceFilter = c.req.query('workspace');
	const statusParam = c.req.query('status');
	const status: MailStatus = statusParam === 'done' ? 'done' : 'open';
	const before = Number(c.req.query('before'));
	const now = Date.now();
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
	const binds: Array<string | number> = [...ids];
	let sql = `${THREAD_SELECT} WHERE t.mailbox_id IN (${ids.map(() => '?').join(', ')}) AND t.deleted_at IS NULL`;
	if (statusParam === 'snoozed') {
		sql += ' AND t.snoozed_until > ?';
		binds.push(now);
	} else {
		sql += ' AND t.status = ?';
		binds.push(status);
		// En rappel : hors des ouverts jusqu'à l'échéance.
		if (status === 'open') {
			sql += ' AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)';
			binds.push(now);
		}
	}
	if (c.req.query('mine') === '1') {
		sql += ' AND t.assignee_id = ?';
		binds.push(c.get('user').id);
	}
	// Épinglés tous sur la première page : exclus des pages suivantes.
	if (Number.isInteger(before) && before > 0) {
		sql += ' AND t.last_at < ? AND t.pinned = 0';
		binds.push(before);
	}
	const { results } = await c.env.DB.prepare(`${sql} ORDER BY t.pinned DESC, t.last_at DESC LIMIT 50`)
		.bind(...binds)
		.all<ThreadRow>();
	return c.json(results.map(toThread));
});

async function threadAccess(c: Ctx, id: string): Promise<{ thread: ThreadRow; access: Access } | null> {
	const thread = await c.env.DB.prepare(`${THREAD_SELECT} WHERE t.id = ? AND t.deleted_at IS NULL`).bind(id).first<ThreadRow>();
	const access = thread ? await boxAccess(c, thread.mailbox_id) : null;
	return thread && access ? { thread, access } : null;
}

mailRoutes.get('/mail/threads/:tid', async (c) => {
	const found = await threadAccess(c, c.req.param('tid'));
	if (!found) {
		return fail(c, 404, 'Conversation introuvable');
	}
	return c.json(await detailJson(c, found.thread, found.access));
});

const addressList = (value: string): MailAddress[] => parseAddresses(value).map((a) => ({ name: a.name, addr: a.address }));

async function detailJson(c: Ctx, thread: ThreadRow, access: MailAccess): Promise<MailThreadDetail> {
	const [messages, notes] = await c.env.DB.batch([
		c.env.DB.prepare(
			'SELECT id, direction, from_name, from_addr, to_addrs, cc_addrs, subject, date, attachments, sent_by, has_html FROM mail_messages WHERE thread_id = ? ORDER BY date, created_at',
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
		has_html: number;
	};
	const rows = messages!.results as MessageRow[];
	const bodies = await Promise.all(rows.map(async (row) => (await (await c.env.FILES.get(bodyKey(thread.mailbox_id, row.id)))?.text()) ?? ''));
	return {
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
				hasHtml: row.has_html === 1,
				toList: addressList(row.to_addrs),
				ccList: addressList(row.cc_addrs),
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
	};
}

mailRoutes.patch('/mail/threads/:tid', async (c) => {
	const found = await threadAccess(c, c.req.param('tid'));
	if (!found) {
		return fail(c, 404, 'Conversation introuvable');
	}
	const { thread, access } = found;
	if (!access.reply) {
		return fail(c, 403, 'Permission insuffisante');
	}
	const body = await readJson<{ status: MailStatus; assigneeId: string | null; pinned: boolean; snoozedUntil: number | null }>(c);
	let status = thread.status;
	let assignee = thread.assignee_id;
	let pinned = thread.pinned;
	let snoozed = thread.snoozed_until;
	if (body.pinned !== undefined) {
		if (typeof body.pinned !== 'boolean') {
			return fail(c, 400, 'Épinglage invalide');
		}
		pinned = body.pinned ? 1 : 0;
	}
	if (body.snoozedUntil !== undefined) {
		const now = Date.now();
		if (body.snoozedUntil !== null && (!Number.isInteger(body.snoozedUntil) || body.snoozedUntil <= now || body.snoozedUntil > now + SNOOZE_MAX)) {
			return fail(c, 400, 'Date de rappel invalide');
		}
		snoozed = body.snoozedUntil;
	}
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
	await c.env.DB.prepare('UPDATE mail_threads SET status = ?, assignee_id = ?, pinned = ?, snoozed_until = ? WHERE id = ?').bind(status, assignee, pinned, snoozed, thread.id).run();
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

const SNOOZE_MAX = 366 * 24 * 3600 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_TYPE_RE = /^[\w.+-]+\/[\w.+-]+$/;
const INLINE_MAX = 1024 * 1024;
const INLINE_TOTAL = 5 * 1024 * 1024;
const ZIP_MAX = 50 * 1024 * 1024;
const DRAFTS_MAX = 100;

const uploadPrefix = (userId: string) => `mail/uploads/${userId}/`;

const subjectOf = (value: unknown) => (typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').trim().slice(0, MAIL_LIMITS.subjectLength) : '');

type MessageMeta = {
	mailbox_id: string;
	attachments: string;
	date: number;
	from_name: string;
	from_addr: string;
	to_addrs: string;
	cc_addrs: string;
	subject: string;
};

async function messageAccess(c: Ctx, id: string): Promise<{ row: MessageMeta; access: Access } | null> {
	const row = await c.env.DB.prepare(
		'SELECT m.mailbox_id, m.attachments, m.date, m.from_name, m.from_addr, m.to_addrs, m.cc_addrs, m.subject FROM mail_messages m JOIN mail_threads t ON t.id = m.thread_id WHERE m.id = ? AND t.deleted_at IS NULL',
	)
		.bind(id)
		.first<MessageMeta>();
	const access = row ? await boxAccess(c, row.mailbox_id) : null;
	return row && access ? { row, access } : null;
}

async function loadAttachments(env: Env, boxId: string, messageId: string, list: MailAttachment[]): Promise<OutgoingAttachment[]> {
	const out: OutgoingAttachment[] = [];
	for (const a of list) {
		const object = await env.FILES.get(attachmentKey(boxId, messageId, a.index));
		if (object) {
			out.push({ name: a.name, type: a.type, content: new Uint8Array(await object.arrayBuffer()) });
		}
	}
	return out;
}

mailRoutes.get('/mail/messages/:mid/html', async (c) => {
	const id = c.req.param('mid');
	const found = await messageAccess(c, id);
	if (!found) {
		return fail(c, 404, 'Message introuvable');
	}
	const { row } = found;
	const html = await (await c.env.FILES.get(htmlKey(row.mailbox_id, id)))?.text();
	if (!html) {
		const text = (await (await c.env.FILES.get(bodyKey(row.mailbox_id, id)))?.text()) ?? '';
		return c.json(textDocument(text) satisfies MailHtml);
	}
	const attachments = JSON.parse(row.attachments) as MailAttachment[];
	let budget = INLINE_TOTAL;
	const result = await sanitizeMail(html, {
		images: c.req.query('images') === '1',
		inline: async (cid) => {
			const a = attachments.find((item) => item.cid === cid);
			if (!a || !IMAGE_TYPES.has(a.type) || a.size > INLINE_MAX || a.size > budget) {
				return null;
			}
			const object = await c.env.FILES.get(attachmentKey(row.mailbox_id, id, a.index));
			if (!object) {
				return null;
			}
			budget -= a.size;
			return `data:${a.type};base64,${btoa(binary(new Uint8Array(await object.arrayBuffer())))}`;
		},
	});
	return c.json(result satisfies MailHtml);
});

mailRoutes.get('/mail/messages/:mid/attachments.zip', async (c) => {
	const id = c.req.param('mid');
	const found = await messageAccess(c, id);
	if (!found) {
		return fail(c, 404, 'Message introuvable');
	}
	const list = JSON.parse(found.row.attachments) as MailAttachment[];
	if (!list.length) {
		return fail(c, 404, 'Aucune pièce jointe');
	}
	if (list.reduce((n, a) => n + a.size, 0) > ZIP_MAX) {
		return fail(c, 413, 'Pièces jointes trop lourdes pour une archive (50 Mo max)');
	}
	const files = await loadAttachments(c.env, found.row.mailbox_id, id, list);
	const names = uniqueNames(files.map((file) => file.name));
	const zip = zipStore(
		files.map((file, i) => ({ name: names[i]!, data: file.content })),
		new Date(found.row.date),
	);
	return new Response(zip, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': 'attachment; filename="pieces-jointes.zip"',
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, max-age=3600',
			'Content-Length': String(zip.byteLength),
		},
	});
});

// Flux direct vers R2, comme l'envoi de fichiers des salons.
mailRoutes.post('/mail/uploads', async (c) => {
	const size = Number(c.req.header('Content-Length'));
	if (!Number.isInteger(size) || size <= 0) {
		return fail(c, 400, 'Fichier vide ou taille inconnue');
	}
	if (size > MAIL_LIMITS.uploadSize) {
		return fail(c, 413, 'Fichier trop lourd (20 Mo max)');
	}
	let name = 'fichier';
	try {
		name = decodeURIComponent(c.req.header('X-File-Name') ?? '') || name;
	} catch {
		// Nom mal encodé : nom générique.
	}
	name = name.replace(/[/\\\0\r\n]/g, '_').slice(0, 120);
	const declared = c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() ?? '';
	const type = MIME_TYPE_RE.test(declared) ? declared : 'application/octet-stream';
	const userId = c.get('user').id;
	const key = `${uploadPrefix(userId)}${crypto.randomUUID()}`;
	const stream = new FixedLengthStream(size);
	const [object] = await Promise.all([
		c.env.FILES.put(key, stream.readable, { httpMetadata: { contentType: type }, customMetadata: { name, uploadedBy: userId } }),
		c.req.raw.body!.pipeTo(stream.writable),
	]);
	return c.json({ key, name, size: object?.size ?? size, type } satisfies MailUpload, 201);
});

function recipients(value: unknown): string[] | null {
	if (value === undefined || value === null) {
		return [];
	}
	if (!Array.isArray(value)) {
		return null;
	}
	const out: string[] = [];
	for (const item of value) {
		const addr = typeof item === 'string' ? item.trim().toLowerCase() : '';
		if (!EMAIL_RE.test(addr) || addr.length > 254) {
			return null;
		}
		out.push(addr);
	}
	return [...new Set(out)];
}

async function forwarded(c: Ctx, id: string): Promise<{ subject: string; text: string; attachments: OutgoingAttachment[] } | null> {
	const found = await messageAccess(c, id);
	if (!found) {
		return null;
	}
	const { row } = found;
	const body = (await (await c.env.FILES.get(bodyKey(row.mailbox_id, id)))?.text()) ?? '';
	const header = [
		'---------- Message transféré ----------',
		`De : ${row.from_name ? `${row.from_name} <${row.from_addr}>` : row.from_addr}`,
		`Date : ${new Date(row.date).toUTCString()}`,
		`Objet : ${row.subject}`,
		`À : ${row.to_addrs}`,
		...(row.cc_addrs ? [`Cc : ${row.cc_addrs}`] : []),
	].join('\n');
	return { subject: row.subject, text: `${header}\n\n${body}`, attachments: await loadAttachments(c.env, row.mailbox_id, id, JSON.parse(row.attachments) as MailAttachment[]) };
}

mailRoutes.post('/mail/send', async (c) => {
	if (!c.env.MAIL_KEY) {
		return unavailable(c);
	}
	const body = await readJson<MailSendInput>(c);
	const access = typeof body.mailboxId === 'string' ? await boxAccess(c, body.mailboxId) : null;
	if (!access) {
		return fail(c, 404, 'Boîte introuvable');
	}
	if (!access.reply) {
		return fail(c, 403, 'Permission insuffisante');
	}
	const user = c.get('user');
	let thread: ThreadRow | null = null;
	if (body.threadId) {
		const found = typeof body.threadId === 'string' ? await threadAccess(c, body.threadId) : null;
		if (!found || found.thread.mailbox_id !== access.box.id) {
			return fail(c, 404, 'Conversation introuvable');
		}
		thread = found.thread;
	}
	const to = recipients(body.to);
	const cc = recipients(body.cc);
	const bcc = recipients(body.bcc);
	if (!to || !cc || !bcc) {
		return fail(c, 400, 'Adresse invalide');
	}
	if (!to.length && !cc.length && !bcc.length) {
		return fail(c, 400, 'Destinataire requis');
	}
	if (to.length + cc.length + bcc.length > MAIL_LIMITS.recipients) {
		return fail(c, 400, `${MAIL_LIMITS.recipients} destinataires au plus`);
	}
	let text = typeof body.text === 'string' ? body.text.trim() : '';
	if (text.length > MAIL_LIMITS.bodyLength) {
		return fail(c, 400, 'Message trop long');
	}
	let subject = subjectOf(body.subject);
	if (!subject && thread) {
		subject = /^re\s*:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
	}
	const rawKeys: unknown[] = Array.isArray(body.attachments) ? body.attachments : [];
	const prefix = uploadPrefix(user.id);
	if (rawKeys.length > MAIL_LIMITS.attachments || !rawKeys.every((key) => typeof key === 'string' && key.startsWith(prefix) && UUID_RE.test(key.slice(prefix.length)))) {
		return fail(c, 400, 'Pièce jointe invalide');
	}
	const keys = [...new Set(rawKeys as string[])];
	const attachments: OutgoingAttachment[] = [];
	for (const key of keys) {
		const object = await c.env.FILES.get(key);
		if (!object) {
			return fail(c, 400, 'Pièce jointe introuvable');
		}
		attachments.push({
			name: object.customMetadata?.name ?? 'fichier',
			type: object.httpMetadata?.contentType ?? 'application/octet-stream',
			content: new Uint8Array(await object.arrayBuffer()),
		});
	}
	if (body.forwardOf) {
		const original = typeof body.forwardOf === 'string' ? await forwarded(c, body.forwardOf) : null;
		if (!original) {
			return fail(c, 404, 'Message introuvable');
		}
		text = `${text}\n\n${original.text}`.trim();
		attachments.push(...original.attachments);
		subject ||= /^(fwd?|tr)\s*:/i.test(original.subject) ? original.subject : `Tr: ${original.subject}`;
	}
	if (!text && !attachments.length) {
		return fail(c, 400, 'Message vide');
	}
	if (attachments.length > MAIL_LIMITS.attachments) {
		return fail(c, 400, `${MAIL_LIMITS.attachments} pièces jointes au plus`);
	}
	if (attachments.reduce((n, a) => n + a.content.byteLength, 0) > MAIL_LIMITS.sendSize) {
		return fail(c, 413, 'Pièces jointes trop lourdes (20 Mo max)');
	}
	let threadId: string;
	try {
		threadId = await sendMail(c.env, access.box, user, { threadId: thread?.id ?? null, to, cc, bcc, subject, text, attachments }, transport.open);
	} catch (error) {
		if (error instanceof MailError) {
			return fail(c, 400, error.message);
		}
		return c.json({ error: `Envoi impossible : ${errorMessage(error)}` }, 502);
	}
	await Promise.all([
		keys.length ? c.env.FILES.delete(keys) : null,
		typeof body.draftId === 'string' ? c.env.DB.prepare('DELETE FROM mail_drafts WHERE id = ? AND user_id = ?').bind(body.draftId, user.id).run() : null,
	]);
	const sent = await c.env.DB.prepare(`${THREAD_SELECT} WHERE t.id = ?`).bind(threadId).first<ThreadRow>();
	return c.json(await detailJson(c, sent!, access), 201);
});

type DraftRow = {
	id: string;
	mailbox_id: string;
	user_id: string;
	thread_id: string | null;
	to_addrs: string;
	cc_addrs: string;
	subject: string;
	body: string;
	attachments: string;
	updated_at: number;
};

const toDraft = (row: DraftRow): MailDraft => ({
	id: row.id,
	mailboxId: row.mailbox_id,
	threadId: row.thread_id,
	to: JSON.parse(row.to_addrs) as MailAddress[],
	cc: JSON.parse(row.cc_addrs) as MailAddress[],
	subject: row.subject,
	text: row.body,
	attachments: JSON.parse(row.attachments) as MailUpload[],
	updatedAt: row.updated_at,
});

// Brouillon : adresses en cours de saisie acceptées, validées à l'envoi.
function draftAddresses(value: unknown): MailAddress[] | null {
	if (value === undefined || value === null) {
		return [];
	}
	if (!Array.isArray(value) || value.length > MAIL_LIMITS.recipients) {
		return null;
	}
	return value.flatMap((item) => {
		const addr = typeof item?.addr === 'string' ? item.addr.replace(/[\r\n]+/g, '').trim().slice(0, 254) : '';
		return addr ? [{ name: typeof item.name === 'string' ? item.name.replace(/[\r\n]+/g, ' ').trim().slice(0, 120) : '', addr }] : [];
	});
}

function draftUploads(value: unknown, userId: string): MailUpload[] | null {
	if (value === undefined || value === null) {
		return [];
	}
	if (!Array.isArray(value) || value.length > MAIL_LIMITS.attachments) {
		return null;
	}
	const prefix = uploadPrefix(userId);
	const out: MailUpload[] = [];
	for (const item of value) {
		if (typeof item?.key !== 'string' || !item.key.startsWith(prefix) || !UUID_RE.test(item.key.slice(prefix.length)) || typeof item.name !== 'string' || !Number.isInteger(item.size)) {
			return null;
		}
		out.push({ key: item.key, name: item.name.slice(0, 120), size: item.size, type: typeof item.type === 'string' && MIME_TYPE_RE.test(item.type) ? item.type : 'application/octet-stream' });
	}
	return out;
}

mailRoutes.get('/mail/drafts', async (c) => {
	const userId = c.get('user').id;
	const thread = c.req.query('thread');
	const statement = thread
		? c.env.DB.prepare('SELECT * FROM mail_drafts WHERE user_id = ? AND thread_id = ? ORDER BY updated_at DESC').bind(userId, thread)
		: c.env.DB.prepare(`SELECT * FROM mail_drafts WHERE user_id = ? ORDER BY updated_at DESC LIMIT ${DRAFTS_MAX}`).bind(userId);
	const { results } = await statement.all<DraftRow>();
	return c.json(results.map(toDraft));
});

// Id choisi par le client : création ou mise à jour idempotente.
mailRoutes.put('/mail/drafts/:id', async (c) => {
	const id = c.req.param('id').toLowerCase();
	if (!UUID_RE.test(id)) {
		return fail(c, 400, 'Identifiant invalide');
	}
	const userId = c.get('user').id;
	const existing = await c.env.DB.prepare('SELECT user_id FROM mail_drafts WHERE id = ?').bind(id).first<{ user_id: string }>();
	if (existing && existing.user_id !== userId) {
		return fail(c, 404, 'Brouillon introuvable');
	}
	const body = await readJson<MailDraft>(c);
	const access = typeof body.mailboxId === 'string' ? await boxAccess(c, body.mailboxId) : null;
	if (!access) {
		return fail(c, 404, 'Boîte introuvable');
	}
	if (!access.reply) {
		return fail(c, 403, 'Permission insuffisante');
	}
	let threadId: string | null = null;
	if (body.threadId) {
		const found = typeof body.threadId === 'string' ? await threadAccess(c, body.threadId) : null;
		if (!found || found.thread.mailbox_id !== access.box.id) {
			return fail(c, 404, 'Conversation introuvable');
		}
		threadId = found.thread.id;
	}
	const to = draftAddresses(body.to);
	const cc = draftAddresses(body.cc);
	const attachments = draftUploads(body.attachments, userId);
	if (!to || !cc) {
		return fail(c, 400, 'Destinataires invalides');
	}
	if (!attachments) {
		return fail(c, 400, 'Pièce jointe invalide');
	}
	const text = typeof body.text === 'string' ? body.text : '';
	if (text.length > MAIL_LIMITS.bodyLength) {
		return fail(c, 400, 'Brouillon trop long');
	}
	if (!existing) {
		const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM mail_drafts WHERE user_id = ?').bind(userId).first<{ n: number }>();
		if ((count?.n ?? 0) >= DRAFTS_MAX) {
			return fail(c, 400, `${DRAFTS_MAX} brouillons au plus`);
		}
	}
	await c.env.DB.prepare(
		'INSERT INTO mail_drafts (id, mailbox_id, user_id, thread_id, to_addrs, cc_addrs, subject, body, attachments, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET mailbox_id = excluded.mailbox_id, thread_id = excluded.thread_id, to_addrs = excluded.to_addrs, cc_addrs = excluded.cc_addrs, subject = excluded.subject, body = excluded.body, attachments = excluded.attachments, updated_at = excluded.updated_at WHERE mail_drafts.user_id = excluded.user_id',
	)
		.bind(id, access.box.id, userId, threadId, JSON.stringify(to), JSON.stringify(cc), subjectOf(body.subject), text, JSON.stringify(attachments), Date.now())
		.run();
	const row = await c.env.DB.prepare('SELECT * FROM mail_drafts WHERE id = ? AND user_id = ?').bind(id, userId).first<DraftRow>();
	return row ? c.json(toDraft(row)) : fail(c, 404, 'Brouillon introuvable');
});

mailRoutes.delete('/mail/drafts/:id', async (c) => {
	const row = await c.env.DB.prepare('SELECT * FROM mail_drafts WHERE id = ? AND user_id = ?').bind(c.req.param('id').toLowerCase(), c.get('user').id).first<DraftRow>();
	if (!row) {
		return fail(c, 404, 'Brouillon introuvable');
	}
	await c.env.DB.prepare('DELETE FROM mail_drafts WHERE id = ?').bind(row.id).run();
	const keys = toDraft(row).attachments.map((a) => a.key);
	if (keys.length) {
		await c.env.FILES.delete(keys);
	}
	return c.json({ ok: true });
});

mailRoutes.delete('/mail/threads/:tid', async (c) => {
	const found = await threadAccess(c, c.req.param('tid'));
	if (!found) {
		return fail(c, 404, 'Conversation introuvable');
	}
	if (!found.access.reply) {
		return fail(c, 403, 'Permission insuffisante');
	}
	await c.env.DB.prepare('UPDATE mail_threads SET deleted_at = ?, pinned = 0 WHERE id = ?').bind(Date.now(), found.thread.id).run();
	return c.json({ ok: true });
});

mailRoutes.post('/mail/threads/:tid/share', async (c) => {
	const found = await threadAccess(c, c.req.param('tid'));
	if (!found) {
		return fail(c, 404, 'Conversation introuvable');
	}
	const body = await readJson<MailShareInput>(c);
	if (typeof body.workspaceId !== 'string' || typeof body.channelId !== 'string') {
		return fail(c, 400, 'Salon requis');
	}
	const actor = await loadActor(c.env.DB, body.workspaceId, c.get('user').id);
	if (!actor) {
		return fail(c, 404, 'Espace introuvable');
	}
	const { thread } = found;
	const card: MailCard = { threadId: thread.id, subject: thread.subject, from: thread.participants, snippet: thread.snippet.slice(0, 200) };
	return unwrap(c, await workspaceStub(c.env, body.workspaceId).mailShare(actor, body.channelId, card, typeof body.comment === 'string' ? body.comment : ''));
});

mailRoutes.post('/mail/threads/:tid/ai', async (c) => {
	const found = await threadAccess(c, c.req.param('tid'));
	if (!found) {
		return fail(c, 404, 'Conversation introuvable');
	}
	const body = await readJson<MailAiInput>(c);
	const action = AI_ACTIONS.find((item) => item === body.action);
	if (!action) {
		return fail(c, 400, 'Action invalide');
	}
	const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
	if (prompt.length > MAIL_LIMITS.aiPrompt) {
		return fail(c, 400, 'Consigne trop longue');
	}
	if (action === 'ask' && !prompt) {
		return fail(c, 400, 'Question requise');
	}
	const tone: AiTone = typeof body.tone === 'string' && Object.hasOwn(AI_TONES, body.tone) ? body.tone : 'neutre';
	const { success } = await c.env.AUTH_LIMITER.limit({ key: `mail-ai:${c.get('user').id}` });
	if (!success) {
		return fail(c, 429, 'Trop de demandes, réessaie dans une minute');
	}
	const { thread } = found;
	const { results } = await c.env.DB.prepare('SELECT id, from_name, from_addr, date FROM mail_messages WHERE thread_id = ? ORDER BY date DESC, created_at DESC LIMIT 8')
		.bind(thread.id)
		.all<{ id: string; from_name: string; from_addr: string; date: number }>();
	const messages = await Promise.all(
		results.reverse().map(async (row) => ({
			from: row.from_name ? `${row.from_name} <${row.from_addr}>` : row.from_addr,
			date: row.date,
			body: (await (await c.env.FILES.get(bodyKey(thread.mailbox_id, row.id)))?.text()) ?? '',
		})),
	);
	let text: string;
	try {
		text = await ai.run(c.env, mailPrompt({ subject: thread.subject, messages }, { action, prompt, tone }));
	} catch (error) {
		return c.json({ error: `IA indisponible : ${errorMessage(error)}` }, 502);
	}
	if (!text) {
		return c.json({ error: 'IA indisponible : réponse vide' }, 502);
	}
	return c.json((action === 'quick' ? { suggestions: parseSuggestions(text) } : { text }) satisfies MailAiResult);
});
