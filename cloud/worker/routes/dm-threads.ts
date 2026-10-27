import { Hono } from 'hono';

import { DM_MAX_MEMBERS } from '../../shared/dm-threads';
import type { Attachment } from '../../shared/types';
import { guestLeft } from '../guests';
import { cleanName, fail, readJson, stub, unwrap, type AppEnv, type Ctx } from '../http';

export const dmThreadsRoutes = new Hono<AppEnv>();

const messageId = (c: Ctx) => Number(c.req.param('mid'));

const userList = (value: unknown): string[] | null =>
	Array.isArray(value) && value.length <= DM_MAX_MEMBERS && value.every((id) => typeof id === 'string') ? [...new Set(value as string[])] : null;

// Le DO ne connaît pas la liste des membres : vérifiée côté D1 ; un invité n'entre que par son lien.
async function allMembers(c: Ctx, ids: string[]): Promise<boolean> {
	const { results } = await c.env.DB.prepare(`SELECT user_id FROM members WHERE workspace_id = ? AND role != 'guest' AND user_id IN (${ids.map(() => '?').join(', ')})`)
		.bind(c.get('workspaceId'), ...ids)
		.all<{ user_id: string }>();
	return results.length === ids.length;
}

dmThreadsRoutes.get('/w/:wid/dms', async (c) => c.json(await stub(c).directs(c.get('actor'))));

dmThreadsRoutes.post('/w/:wid/dms', async (c) => {
	const body = await readJson<{ userIds: string[]; name: string }>(c);
	const others = userList(body.userIds);
	if (!others) {
		return fail(c, 400, 'Requête invalide');
	}
	const actor = c.get('actor');
	const ids = [...new Set([actor.id, ...others])];
	if (ids.length < 2 || ids.length > DM_MAX_MEMBERS) {
		return fail(c, 400, `Choisis entre 1 et ${DM_MAX_MEMBERS - 1} personnes`);
	}
	if (!(await allMembers(c, ids))) {
		return fail(c, 400, 'Membre introuvable');
	}
	return unwrap(c, await stub(c).openDirect(actor, ids, cleanName(body.name)));
});

dmThreadsRoutes.patch('/w/:wid/dms/:cid', async (c) => {
	const { name } = await readJson<{ name: string }>(c);
	if (typeof name !== 'string') {
		return fail(c, 400, 'Requête invalide');
	}
	return unwrap(c, await stub(c).updateDirect(c.get('actor'), c.req.param('cid'), { name: cleanName(name) }));
});

dmThreadsRoutes.post('/w/:wid/dms/:cid/members', async (c) => {
	const ids = userList((await readJson<{ userIds: string[] }>(c)).userIds);
	if (!ids?.length) {
		return fail(c, 400, 'Requête invalide');
	}
	if (!(await allMembers(c, ids))) {
		return fail(c, 400, 'Membre introuvable');
	}
	return unwrap(c, await stub(c).updateDirect(c.get('actor'), c.req.param('cid'), { add: ids }));
});

dmThreadsRoutes.delete('/w/:wid/dms/:cid/members/:uid', async (c) => {
	const result = await stub(c).updateDirect(c.get('actor'), c.req.param('cid'), { remove: c.req.param('uid') });
	if (result.ok) {
		await guestLeft(c, c.req.param('cid'), c.req.param('uid'));
	}
	return unwrap(c, result);
});

dmThreadsRoutes.get('/w/:wid/threads', async (c) => c.json(await stub(c).followedThreads(c.get('actor'))));

dmThreadsRoutes.get('/w/:wid/messages/:mid/thread', async (c) => unwrap(c, await stub(c).threadView(c.get('actor'), messageId(c))));

dmThreadsRoutes.post('/w/:wid/messages/:mid/thread', async (c) => {
	const body = await readJson<{ body: string; attachmentKey: string; broadcast: boolean }>(c);
	let attachment: Attachment | null = null;
	if (typeof body.attachmentKey === 'string') {
		// Métadonnées relues depuis R2, jamais depuis le client.
		const key = body.attachmentKey;
		const object = key.startsWith(`w/${c.get('workspaceId')}/`) ? await c.env.FILES.head(key) : null;
		if (!object) {
			return fail(c, 400, 'Fichier joint introuvable');
		}
		attachment = {
			key,
			name: object.customMetadata?.name ?? key.split('/').pop() ?? 'fichier',
			size: object.size,
			type: object.httpMetadata?.contentType ?? 'application/octet-stream',
		};
	}
	const text = typeof body.body === 'string' ? body.body : '';
	return unwrap(c, await stub(c).threadReply(c.get('actor'), messageId(c), text, attachment, body.broadcast === true));
});

dmThreadsRoutes.put('/w/:wid/messages/:mid/follow', async (c) => {
	const { following } = await readJson<{ following: boolean }>(c);
	if (typeof following !== 'boolean') {
		return fail(c, 400, 'Requête invalide');
	}
	return unwrap(c, await stub(c).followThread(c.get('actor'), messageId(c), following));
});

dmThreadsRoutes.post('/w/:wid/messages/:mid/thread/read', async (c) => unwrap(c, await stub(c).readThread(c.get('actor'), messageId(c))));
