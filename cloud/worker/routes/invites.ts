import { Hono } from 'hono';

import { DEFAULT_INVITE_TTL, INVITE_EXPIRIES, INVITE_LABEL_MAX, INVITE_MAX_USES, type InviteInput } from '../../shared/invites';
import { DEFAULT_GRADE, P, has } from '../../shared/permissions';
import { randomToken } from '../crypto';
import { listGrades } from '../grades';
import { fail, readJson, stub, unwrap, type AppEnv, type Ctx } from '../http';
import { acceptInvite, invitePreview, listInvites, toInvite } from '../invites';

export const inviteRoutes = new Hono<AppEnv>();

const canInvite = (c: Ctx) => has(c.get('actor').perms, P.CREATE_INVITES) || has(c.get('actor').perms, P.MANAGE_WORKSPACE);

inviteRoutes.get('/w/:wid/invites', async (c) => {
	if (!canInvite(c)) {
		return fail(c, 403, 'Permission insuffisante');
	}
	return c.json(await listInvites(c.env.DB, c.get('workspaceId'), Date.now()));
});

inviteRoutes.post('/w/:wid/invites', async (c) => {
	const actor = c.get('actor');
	if (!has(actor.perms, P.CREATE_INVITES)) {
		return fail(c, 403, 'Permission insuffisante');
	}
	const workspaceId = c.get('workspaceId');
	const body = await readJson<InviteInput>(c);
	const expiresIn = body.expiresIn === undefined ? DEFAULT_INVITE_TTL : body.expiresIn;
	if (expiresIn !== null && !INVITE_EXPIRIES.includes(expiresIn)) {
		return fail(c, 400, 'Durée de validité invalide');
	}
	const maxUses = body.maxUses ?? null;
	if (maxUses !== null && !INVITE_MAX_USES.includes(maxUses)) {
		return fail(c, 400, 'Nombre d’utilisations invalide');
	}
	const temporary = body.temporary === true;
	if (temporary && expiresIn === null) {
		return fail(c, 400, 'Une adhésion temporaire exige une date d’expiration');
	}
	const label = typeof body.label === 'string' ? body.label.trim().slice(0, INVITE_LABEL_MAX) : '';
	let channelId: string | null = null;
	if (body.channelId) {
		const channel = (await stub(c).channels(actor)).find((ch) => ch.id === body.channelId);
		if (!channel || channel.kind !== 'text') {
			return fail(c, 400, 'Salon d’arrivée invalide');
		}
		channelId = channel.id;
	}
	const gradeIds = Array.isArray(body.gradeIds) ? [...new Set(body.gradeIds.filter((id): id is string => typeof id === 'string' && id !== DEFAULT_GRADE))] : [];
	if (gradeIds.length) {
		if (!has(actor.perms, P.MANAGE_GRADES)) {
			return fail(c, 403, 'Attribuer des grades exige de pouvoir gérer les grades');
		}
		const grades = await listGrades(c.env.DB, workspaceId);
		const picked = gradeIds.map((id) => grades.find((g) => g.id === id));
		if (picked.some((g) => !g)) {
			return fail(c, 400, 'Grade inconnu');
		}
		if (!actor.owner && picked.some((g) => g!.position >= actor.top)) {
			return fail(c, 403, 'Tu ne peux attribuer que des grades inférieurs au tien');
		}
	}
	const now = Date.now();
	const row = {
		code: randomToken(9),
		workspace_id: workspaceId,
		created_by: actor.id,
		expires_at: expiresIn === null ? null : now + expiresIn,
		created_at: now,
		max_uses: maxUses,
		uses: 0,
		channel_id: channelId,
		grade_ids: JSON.stringify(gradeIds),
		temporary: temporary ? 1 : 0,
		label,
		revoked_at: null,
	};
	await c.env.DB.prepare(
		'INSERT INTO invites (code, workspace_id, created_by, expires_at, created_at, max_uses, channel_id, grade_ids, temporary, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
	)
		.bind(row.code, workspaceId, actor.id, row.expires_at, now, maxUses, channelId, row.grade_ids, row.temporary, label)
		.run();
	return c.json(toInvite(row, actor.name, now), 201);
});

inviteRoutes.delete('/w/:wid/invites/:code', async (c) => {
	const actor = c.get('actor');
	if (!canInvite(c)) {
		return fail(c, 403, 'Permission insuffisante');
	}
	const row = await c.env.DB.prepare('SELECT created_by, label FROM invites WHERE code = ? AND workspace_id = ?')
		.bind(c.req.param('code'), c.get('workspaceId'))
		.first<{ created_by: string; label: string }>();
	if (!row) {
		return fail(c, 404, 'Invitation introuvable');
	}
	if (row.created_by !== actor.id && !has(actor.perms, P.MANAGE_WORKSPACE)) {
		return fail(c, 403, 'Seul son auteur ou un gestionnaire de l’espace peut révoquer ce lien');
	}
	await c.env.DB.prepare('UPDATE invites SET revoked_at = COALESCE(revoked_at, ?) WHERE code = ?').bind(Date.now(), c.req.param('code')).run();
	return c.json({ ok: true, name: row.label || null });
});

inviteRoutes.get('/invites/:code', async (c) => unwrap(c, await invitePreview(c.env.DB, c.req.param('code'), c.get('user').id, Date.now())));

inviteRoutes.post('/invites/:code/accept', async (c) => unwrap(c, await acceptInvite(c.env, c.req.param('code'), c.get('user'), Date.now())));
