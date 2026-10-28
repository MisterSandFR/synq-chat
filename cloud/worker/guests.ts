import { DM_MAX_MEMBERS } from '../shared/dm-threads';
import { GUEST_INVITE_TTL, GUEST_PENDING_MAX, type GuestInvite, type GuestInviteCreated, type GuestInviteList, type GuestJoined, type GuestLanding } from '../shared/guests';
import { LIMITS } from '../shared/types';
import { randomToken, sha256 } from './crypto';
import { workspaceStub, type Ctx } from './http';
import { unseal } from './mail/secret';
import { buildMessage, smtpSend } from './mail/smtp';
import type { BoxRow } from './mail/store';
import { transport } from './mail/wire';
import { err, ok, type Result } from './result';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ID = '[\\w-]+';

// Liste blanche : toute route d'espace absente est refusée à un invité.
const GUEST_ROUTES: Array<[string, RegExp]> = [
	['GET', /^\/info$/],
	['GET', /^\/channels$/],
	['GET', new RegExp(`^/channels/${ID}/(messages|pins|announcement)$`)],
	['POST', new RegExp(`^/channels/${ID}/(messages|read)$`)],
	['PATCH', /^\/messages\/\d+$/],
	['DELETE', /^\/messages\/\d+$/],
	['PUT', /^\/messages\/\d+\/reactions\/[^/]+$/],
	['DELETE', /^\/messages\/\d+\/reactions\/[^/]+$/],
	['GET', /^\/messages\/\d+\/thread$/],
	['POST', /^\/messages\/\d+\/thread(\/read)?$/],
	['PUT', /^\/messages\/\d+\/follow$/],
	['GET', /^\/threads$/],
	['GET', /^\/search$/],
	['POST', /^\/files$/],
	['GET', new RegExp(`^/files/${ID}$`)],
	['GET', /^\/dms$/],
	['PATCH', new RegExp(`^/dms/${ID}$`)],
	['GET', /^\/notifications(\/prefs)?$/],
	['PUT', new RegExp(`^/notifications/prefs/${ID}$`)],
	['POST', /^\/notifications\/read$/],
	['GET', /^\/unfurl$/],
	['POST', /^\/voice\/(join|leave|session|tracks|diag)$/],
	['PUT', /^\/voice\/(renegotiate|tracks\/close)$/],
	['GET', /^\/ws$/],
	['POST', new RegExp(`^/channels/${ID}/ai/catchup$`)],
	['POST', /^\/messages\/\d+\/ai\/(translate|summary|reply|thread-summary)$/],
	['POST', /^\/ai\/ask$/],
];

const LEAVE_RE = new RegExp(`^/dms/${ID}/members/(${ID})$`);

// `rest` : chemin après `/api/w/:wid`.
export function guestAllowed(method: string, rest: string, guestId: string): boolean {
	if (method === 'DELETE') {
		const leave = rest.match(LEAVE_RE);
		if (leave) {
			// Un invité ne retire que lui-même.
			return leave[1] === guestId;
		}
	}
	return GUEST_ROUTES.some(([m, re]) => m === method && re.test(rest));
}

// Compte invité : son profil et les routes d'espace, filtrées ensuite par `guestAllowed`.
const GUEST_ACCOUNT_RE = /^\/api\/(me|me\/profile|me\/avatar|ai\/rewrite|avatars\/[^/]+\/[^/]+|workspace-logos\/[^/]+\/[^/]+|w\/.+)$/;

export const guestAccountAllowed = (path: string) => GUEST_ACCOUNT_RE.test(path);

type InviteRow = {
	id: string;
	workspace_id: string;
	channel_id: string;
	email: string;
	created_by: string;
	user_id: string | null;
	expires_at: number;
	revoked_at: number | null;
	created_at: number;
};

const toInvite = (row: InviteRow, now = Date.now()): GuestInvite => ({
	id: row.id,
	email: row.email,
	status: row.revoked_at ? 'revoked' : row.user_id ? 'joined' : row.expires_at <= now ? 'expired' : 'pending',
	userId: row.user_id,
	createdBy: row.created_by,
	expiresAt: row.expires_at,
	createdAt: row.created_at,
});

export const guestSlots = (memberCount: number) => DM_MAX_MEMBERS - memberCount;

export async function listGuestInvites(c: Ctx, channelId: string): Promise<GuestInviteList> {
	const [invites, box] = await c.env.DB.batch([
		c.env.DB.prepare('SELECT * FROM guest_invites WHERE workspace_id = ? AND channel_id = ? ORDER BY created_at DESC LIMIT 50').bind(c.get('workspaceId'), channelId),
		c.env.DB.prepare('SELECT 1 FROM mailboxes WHERE owner_id = ? LIMIT 1').bind(c.get('actor').id),
	]);
	return { invites: (invites!.results as InviteRow[]).map((row) => toInvite(row)), canEmail: box!.results.length > 0 };
}

export async function createGuestInvite(c: Ctx, channelId: string, rawEmail: unknown, send: boolean, conversationName: string): Promise<Result<GuestInviteCreated>> {
	const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
	if (!EMAIL_RE.test(email) || email.length > 254) {
		return err(400, 'Email invalide');
	}
	const workspaceId = c.get('workspaceId');
	const actor = c.get('actor');
	const now = Date.now();
	const pending = await c.env.DB.prepare(
		'SELECT COUNT(*) AS n FROM guest_invites WHERE workspace_id = ? AND channel_id = ? AND user_id IS NULL AND revoked_at IS NULL AND expires_at > ?',
	)
		.bind(workspaceId, channelId, now)
		.first<{ n: number }>();
	if ((pending?.n ?? 0) >= GUEST_PENDING_MAX) {
		return err(400, 'Trop d’invitations en attente pour ce groupe');
	}
	const token = randomToken();
	const row: InviteRow = {
		id: crypto.randomUUID(),
		workspace_id: workspaceId,
		channel_id: channelId,
		email,
		created_by: actor.id,
		user_id: null,
		expires_at: now + GUEST_INVITE_TTL,
		revoked_at: null,
		created_at: now,
	};
	await c.env.DB.prepare('INSERT INTO guest_invites (id, workspace_id, channel_id, email, token_hash, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(row.id, workspaceId, channelId, email, await sha256(token), actor.id, row.expires_at, now)
		.run();
	const link = `${new URL(c.req.url).origin}/invite/guest/${token}`;
	let emailed = false;
	let mailError: string | null = null;
	if (send) {
		try {
			emailed = await mailInvite(c, email, link, conversationName || 'Groupe');
			mailError = emailed ? null : 'Aucune boîte mail configurée : copie le lien';
		} catch (error) {
			console.error(JSON.stringify({ level: 'error', message: 'guest mail', error: String(error) }));
			mailError = 'Envoi du mail impossible : copie le lien';
		}
	}
	return ok({ invite: toInvite(row, now), link, emailed, mailError });
}

// Boîte personnelle de l'invitant seulement ; sans boîte, lien à copier.
async function mailInvite(c: Ctx, to: string, link: string, conversationName: string): Promise<boolean> {
	const actor = c.get('actor');
	const box = await c.env.DB.prepare('SELECT * FROM mailboxes WHERE owner_id = ? ORDER BY created_at LIMIT 1').bind(actor.id).first<BoxRow>();
	if (!box) {
		return false;
	}
	const workspace = await c.env.DB.prepare('SELECT name FROM workspaces WHERE id = ?').bind(c.get('workspaceId')).first<{ name: string }>();
	const text = [
		`${actor.name} t’invite dans la conversation « ${conversationName} » sur Synq (${workspace?.name ?? 'espace'}).`,
		'',
		'Ouvre ce lien et indique ton nom, aucun compte n’est nécessaire :',
		link,
		'',
		'Le lien expire dans 7 jours.',
	].join('\n');
	const messageId = `<${crypto.randomUUID()}@${box.address.split('@')[1] ?? 'synq.invalid'}>`;
	const data = buildMessage({ fromName: actor.name, fromAddr: box.address, to: [to], subject: `Invitation : ${conversationName}`, text, messageId });
	await smtpSend(
		transport.open,
		{ host: box.smtp_host, port: box.smtp_port, username: box.username, password: await unseal(c.env.MAIL_KEY, box.secret) },
		Date.now() + 30_000,
		{ from: box.address, to: [to], data },
	);
	return true;
}

export async function revokeGuestInvite(c: Ctx, channelId: string, inviteId: string): Promise<boolean> {
	const done = await c.env.DB.prepare('UPDATE guest_invites SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND channel_id = ? AND revoked_at IS NULL')
		.bind(Date.now(), inviteId, c.get('workspaceId'), channelId)
		.run();
	return done.meta.changes > 0;
}

type ValidRow = InviteRow & { workspace_name: string; inviter_name: string };

async function validInvite(env: Env, token: string): Promise<ValidRow | null> {
	if (!/^[\w-]{16,128}$/.test(token)) {
		return null;
	}
	const row = await env.DB.prepare(
		'SELECT g.*, w.name AS workspace_name, u.name AS inviter_name FROM guest_invites g JOIN workspaces w ON w.id = g.workspace_id JOIN users u ON u.id = g.created_by WHERE g.token_hash = ?',
	)
		.bind(await sha256(token))
		.first<ValidRow>();
	return row && !row.revoked_at && row.expires_at > Date.now() ? row : null;
}

const INVALID = 'Invitation invalide, expirée ou révoquée';

export async function guestLanding(env: Env, token: string): Promise<Result<GuestLanding>> {
	const row = await validInvite(env, token);
	const conversation = row ? await workspaceStub(env, row.workspace_id).guestConversation(row.channel_id, row.user_id) : null;
	if (!row || !conversation) {
		return err(404, INVALID);
	}
	return ok({
		workspaceName: row.workspace_name,
		conversationName: conversation.name || 'Groupe',
		inviterName: row.inviter_name,
		email: row.email,
		joined: row.user_id !== null,
	});
}

// Premier passage : compte invité créé et ajouté au groupe ; ensuite le lien rouvre seulement une session.
export async function acceptGuest(env: Env, token: string, rawName: unknown): Promise<Result<GuestJoined & { userId: string }>> {
	const row = await validInvite(env, token);
	const room = row ? workspaceStub(env, row.workspace_id) : null;
	if (!row || !room || !(await room.guestConversation(row.channel_id, row.user_id))) {
		return err(404, INVALID);
	}
	const done = { workspaceId: row.workspace_id, channelId: row.channel_id };
	if (row.user_id) {
		return ok({ ...done, userId: row.user_id });
	}
	const name = typeof rawName === 'string' ? rawName.trim().slice(0, LIMITS.nameLength) : '';
	if (!name) {
		return err(400, 'Nom requis');
	}
	const userId = crypto.randomUUID();
	const now = Date.now();
	try {
		await env.DB.batch([
			env.DB.prepare("INSERT INTO users (id, email, name, password_hash, guest, created_at) VALUES (?, ?, ?, '', 1, ?)").bind(userId, `guest-${row.id}@guests.invalid`, name, now),
			env.DB.prepare("INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'guest', ?)").bind(row.workspace_id, userId, now),
			env.DB.prepare('UPDATE guest_invites SET user_id = ? WHERE id = ? AND user_id IS NULL').bind(userId, row.id),
		]);
	} catch {
		// Double envoi : l'autre requête a créé le compte.
		const again = await env.DB.prepare('SELECT user_id FROM guest_invites WHERE id = ?').bind(row.id).first<{ user_id: string | null }>();
		return again?.user_id ? ok({ ...done, userId: again.user_id }) : err(409, 'Réessaie dans un instant');
	}
	const joined = await room.guestJoin(row.channel_id, userId);
	if (!joined.ok) {
		await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
		return err(joined.status, joined.error);
	}
	return ok({ ...done, userId });
}

// Invité retiré d'un groupe : lien révoqué, et sortie de l'espace s'il n'a plus aucun groupe.
export async function guestLeft(c: Ctx, channelId: string, userId: string): Promise<void> {
	const workspaceId = c.get('workspaceId');
	const member = await c.env.DB.prepare('SELECT role FROM members WHERE workspace_id = ? AND user_id = ?').bind(workspaceId, userId).first<{ role: string }>();
	if (member?.role !== 'guest') {
		return;
	}
	await c.env.DB.prepare('UPDATE guest_invites SET revoked_at = COALESCE(revoked_at, ?) WHERE workspace_id = ? AND channel_id = ? AND user_id = ?')
		.bind(Date.now(), workspaceId, channelId, userId)
		.run();
	const room = workspaceStub(c.env, workspaceId);
	if ((await room.guestContacts(userId)).length > 0) {
		return;
	}
	await c.env.DB.batch([
		c.env.DB.prepare('DELETE FROM members WHERE workspace_id = ? AND user_id = ?').bind(workspaceId, userId),
		c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
	]);
	await room.memberRemoved(userId);
}
