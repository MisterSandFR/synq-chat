import { Hono } from 'hono';

import { AVATAR_TYPES, RC_LIMITS, USER_STATUSES, type Profile, type ProfileInput, type UserStatus, type Webhook, type WebhookPayload, type WebhookWithUrl } from '../../shared/rc';
import type { User } from '../../shared/types';
import { randomToken, sha256 } from '../crypto';
import { fail, readJson, stub, unwrap, workspaceStub, type AppEnv, type Ctx } from '../http';

export const rcRoutes = new Hono<AppEnv>();

// Monté avant le middleware de session : le secret de l'URL tient lieu d'authentification.
export const rcPublicRoutes = new Hono<AppEnv>();

const AVATAR_PATH = '/api/avatars/';

type ProfileRow = { id: string; status: UserStatus; status_text: string; status_until: number | null; bio: string; timezone: string };

const PROFILE_COLUMNS = 'id, status, status_text, status_until, bio, timezone';

// Invisible : hors ligne pour les autres. Texte expiré : effacé à la lecture, sans tâche planifiée.
export function toProfile(row: ProfileRow, viewerId: string, now = Date.now()): Profile {
	const expired = row.status_until !== null && row.status_until <= now;
	return {
		userId: row.id,
		status: row.status === 'invisible' && row.id !== viewerId ? 'offline' : row.status,
		statusText: expired ? '' : row.status_text,
		statusUntil: expired ? null : row.status_until,
		bio: row.bio,
		timezone: row.timezone,
	};
}

function validZone(zone: string): boolean {
	try {
		new Intl.DateTimeFormat('fr-FR', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

async function membersChangedEverywhere(c: Ctx, userId: string): Promise<void> {
	const { results } = await c.env.DB.prepare('SELECT workspace_id FROM members WHERE user_id = ?').bind(userId).all<{ workspace_id: string }>();
	await Promise.all(results.map((row) => workspaceStub(c.env, row.workspace_id).membersChanged()));
}

async function dropAvatar(c: Ctx, url: string | null | undefined): Promise<void> {
	if (url?.startsWith(AVATAR_PATH)) {
		await c.env.FILES.delete(`avatars/${url.slice(AVATAR_PATH.length)}`);
	}
}

rcRoutes.get('/me/profile', async (c) => {
	const user = c.get('user');
	const row = await c.env.DB.prepare(`SELECT ${PROFILE_COLUMNS} FROM users WHERE id = ?`).bind(user.id).first<ProfileRow>();
	return c.json(toProfile(row!, user.id));
});

rcRoutes.patch('/me/profile', async (c) => {
	const user = c.get('user');
	const body = await readJson<ProfileInput>(c);
	const sets: string[] = [];
	const values: Array<string | number | null> = [];
	if (body.status !== undefined) {
		if (!USER_STATUSES.some((s) => s.value === body.status)) {
			return fail(c, 400, 'Statut invalide');
		}
		sets.push('status = ?');
		values.push(body.status);
	}
	if (body.statusText !== undefined) {
		if (typeof body.statusText !== 'string') {
			return fail(c, 400, 'Statut personnalisé invalide');
		}
		sets.push('status_text = ?');
		values.push(body.statusText.trim().replace(/\s+/g, ' ').slice(0, RC_LIMITS.statusText));
	}
	if (body.statusUntil !== undefined) {
		const until = body.statusUntil;
		if (until !== null && (!Number.isInteger(until) || until <= Date.now())) {
			return fail(c, 400, 'Expiration invalide');
		}
		sets.push('status_until = ?');
		values.push(until);
	}
	if (body.bio !== undefined) {
		if (typeof body.bio !== 'string' || body.bio.trim().length > RC_LIMITS.bio) {
			return fail(c, 400, `Bio trop longue (${RC_LIMITS.bio} caractères max)`);
		}
		sets.push('bio = ?');
		values.push(body.bio.trim());
	}
	if (body.timezone !== undefined) {
		if (typeof body.timezone !== 'string' || body.timezone.length > 64 || (body.timezone && !validZone(body.timezone))) {
			return fail(c, 400, 'Fuseau horaire inconnu');
		}
		sets.push('timezone = ?');
		values.push(body.timezone);
	}
	if (!sets.length) {
		return fail(c, 400, 'Rien à modifier');
	}
	const row = await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? RETURNING ${PROFILE_COLUMNS}`)
		.bind(...values, user.id)
		.first<ProfileRow>();
	await membersChangedEverywhere(c, user.id);
	return c.json(toProfile(row!, user.id));
});

// Flux direct vers R2 comme les pièces jointes ; images non exécutables seulement.
rcRoutes.post('/me/avatar', async (c) => {
	const user = c.get('user');
	const type = c.req.header('Content-Type')?.split(';')[0]?.trim() ?? '';
	const size = Number(c.req.header('Content-Length'));
	if (!AVATAR_TYPES.includes(type)) {
		return fail(c, 400, 'Image PNG, JPEG, GIF ou WebP attendue');
	}
	if (!Number.isInteger(size) || size <= 0 || !c.req.raw.body) {
		return fail(c, 400, 'Fichier vide ou taille inconnue');
	}
	if (size > RC_LIMITS.avatarSize) {
		return fail(c, 413, 'Image trop lourde (2 Mo max)');
	}
	const id = crypto.randomUUID();
	const stream = new FixedLengthStream(size);
	await Promise.all([c.env.FILES.put(`avatars/${user.id}/${id}`, stream.readable, { httpMetadata: { contentType: type } }), c.req.raw.body.pipeTo(stream.writable)]);
	const avatarUrl = `${AVATAR_PATH}${user.id}/${id}`;
	const previous = await c.env.DB.prepare('SELECT avatar_url FROM users WHERE id = ?').bind(user.id).first<{ avatar_url: string | null }>();
	await c.env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(avatarUrl, user.id).run();
	await dropAvatar(c, previous?.avatar_url);
	await membersChangedEverywhere(c, user.id);
	return c.json({ ...user, avatarUrl } satisfies User, 201);
});

rcRoutes.delete('/me/avatar', async (c) => {
	const user = c.get('user');
	const previous = await c.env.DB.prepare('SELECT avatar_url FROM users WHERE id = ?').bind(user.id).first<{ avatar_url: string | null }>();
	if (previous?.avatar_url?.startsWith(AVATAR_PATH)) {
		await c.env.DB.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').bind(user.id).run();
		await dropAvatar(c, previous.avatar_url);
		await membersChangedEverywhere(c, user.id);
	}
	return c.json({ ...user, avatarUrl: null } satisfies User);
});

rcRoutes.get('/avatars/:uid/:id', async (c) => {
	const object = await c.env.FILES.get(`avatars/${c.req.param('uid')}/${c.req.param('id')}`);
	if (!object) {
		return fail(c, 404, 'Avatar introuvable');
	}
	return new Response(object.body, {
		headers: {
			'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
			'Content-Length': String(object.size),
			'Content-Security-Policy': "default-src 'none'; sandbox",
			'X-Content-Type-Options': 'nosniff',
			// Clé neuve à chaque envoi : contenu immuable.
			'Cache-Control': 'private, max-age=31536000, immutable',
		},
	});
});

rcRoutes.get('/w/:wid/profiles', async (c) => {
	const { results } = await c.env.DB.prepare(
		'SELECT u.id, u.status, u.status_text, u.status_until, u.bio, u.timezone FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?',
	)
		.bind(c.get('workspaceId'))
		.all<ProfileRow>();
	const viewer = c.get('user').id;
	return c.json(results.map((row) => toProfile(row, viewer)));
});

rcRoutes.get('/w/:wid/saved', async (c) => c.json(await stub(c).savedMessages(c.get('actor'))));

rcRoutes.put('/w/:wid/messages/:mid/saved', async (c) => {
	const { saved } = await readJson<{ saved: boolean }>(c);
	if (typeof saved !== 'boolean') {
		return fail(c, 400, 'Requête invalide');
	}
	return unwrap(c, await stub(c).setSaved(c.get('actor'), Number(c.req.param('mid')), saved));
});

rcRoutes.get('/w/:wid/channels/:cid/announcement', async (c) => unwrap(c, await stub(c).announcement(c.get('actor'), c.req.param('cid'))));

rcRoutes.put('/w/:wid/channels/:cid/announcement', async (c) => {
	const { text } = await readJson<{ text: string }>(c);
	if (typeof text !== 'string') {
		return fail(c, 400, 'Requête invalide');
	}
	return unwrap(c, await stub(c).setAnnouncement(c.get('actor'), c.req.param('cid'), text));
});

rcRoutes.post('/w/:wid/messages/:mid/forward', async (c) => {
	const { channelId, comment } = await readJson<{ channelId: string; comment: string }>(c);
	if (typeof channelId !== 'string' || (comment !== undefined && typeof comment !== 'string')) {
		return fail(c, 400, 'Requête invalide');
	}
	return unwrap(c, await stub(c).forwardMessage(c.get('actor'), Number(c.req.param('mid')), channelId, comment ?? ''));
});

const hookUrl = (c: Ctx, hook: Webhook, secret: string): WebhookWithUrl => ({
	...hook,
	url: `${new URL(c.req.url).origin}/api/hooks/${c.get('workspaceId')}/${hook.id}/${secret}`,
});

rcRoutes.get('/w/:wid/channels/:cid/webhooks', async (c) => unwrap(c, await stub(c).webhookList(c.get('actor'), c.req.param('cid'))));

rcRoutes.post('/w/:wid/channels/:cid/webhooks', async (c) => {
	const { name } = await readJson<{ name: string }>(c);
	const secret = randomToken(24);
	const result = await stub(c).createWebhook(c.get('actor'), c.req.param('cid'), name, await sha256(secret));
	return result.ok ? c.json(hookUrl(c, result.value, secret), 201) : unwrap(c, result);
});

rcRoutes.post('/w/:wid/webhooks/:id/rotate', async (c) => {
	const secret = randomToken(24);
	const result = await stub(c).rotateWebhook(c.get('actor'), c.req.param('id'), await sha256(secret));
	return result.ok ? c.json(hookUrl(c, result.value, secret)) : unwrap(c, result);
});

rcRoutes.delete('/w/:wid/webhooks/:id', async (c) => unwrap(c, await stub(c).deleteWebhook(c.get('actor'), c.req.param('id'))));

rcPublicRoutes.post('/hooks/:wid/:id/:secret', async (c) => {
	const wid = c.req.param('wid');
	const payload = await readJson<WebhookPayload>(c);
	if (typeof payload.text !== 'string' || (payload.username !== undefined && typeof payload.username !== 'string')) {
		return fail(c, 400, 'JSON { text, username? } attendu');
	}
	if (!(await c.env.DB.prepare('SELECT 1 FROM workspaces WHERE id = ?').bind(wid).first())) {
		return fail(c, 404, 'Webhook introuvable');
	}
	const result = await workspaceStub(c.env, wid).webhookPost(c.req.param('id'), await sha256(c.req.param('secret')), payload.text, payload.username ?? '');
	return result.ok ? c.json({ ok: true, id: result.value.id }) : unwrap(c, result);
});
