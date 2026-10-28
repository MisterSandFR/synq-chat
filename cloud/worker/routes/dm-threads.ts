import { Hono } from 'hono';

import { DM_MAX_MEMBERS, type DirectOpened, type GuestOutcome } from '../../shared/dm-threads';
import type { Attachment } from '../../shared/types';
import { loadActors } from '../grades';
import { createGuestInvite, guestLeft } from '../guests';
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

// Grades de l'espace seulement ; vide si absent.
async function gradeList(c: Ctx, value: unknown): Promise<string[] | null> {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value) || value.length > 50 || !value.every((id) => typeof id === 'string')) {
		return null;
	}
	const ids = [...new Set(value as string[])];
	if (!ids.length) {
		return [];
	}
	const { results } = await c.env.DB.prepare(`SELECT id FROM grades WHERE workspace_id = ? AND id IN (${ids.map(() => '?').join(', ')})`)
		.bind(c.get('workspaceId'), ...ids)
		.all<{ id: string }>();
	return results.length === ids.length ? ids : null;
}

dmThreadsRoutes.get('/w/:wid/dms', async (c) => c.json(await stub(c).directs(c.get('actor'))));

dmThreadsRoutes.post('/w/:wid/dms', async (c) => {
	const body = await readJson<{ userIds: string[]; name: string; gradeIds: string[]; guestEmails: string[] }>(c);
	const others = userList(body.userIds);
	const grades = await gradeList(c, body.gradeIds);
	const emails = body.guestEmails === undefined ? [] : userList(body.guestEmails);
	if (!others || !grades || !emails) {
		return fail(c, 400, 'Requête invalide');
	}
	const actor = c.get('actor');
	const ids = [...new Set([actor.id, ...others])];
	if ((ids.length < 2 && !grades.length && !emails.length) || ids.length + emails.length > DM_MAX_MEMBERS) {
		return fail(c, 400, `Choisis un grade ou entre 1 et ${DM_MAX_MEMBERS - 1} personnes`);
	}
	if (!(await allMembers(c, ids))) {
		return fail(c, 400, 'Membre introuvable');
	}
	const actors = grades.length ? await loadActors(c.env.DB, c.get('workspaceId')) : [];
	// Sans nom : les adresses des prestataires, seuls autres participants avant leur arrivée.
	const name = cleanName(body.name) || (emails.length ? cleanName(emails.map((email) => email.split('@')[0]).join(', ')).slice(0, 64) : '');
	const opened = await stub(c).openDirect(actor, ids, name, grades, actors, emails.length);
	if (!opened.ok || !emails.length) {
		return unwrap(c, opened);
	}
	// Groupe créé d'abord : un email refusé ne doit pas empêcher les autres.
	const guestInvites: GuestOutcome[] = [];
	for (const email of emails) {
		const created = await createGuestInvite(c, opened.value.id, email, true, opened.value.name);
		guestInvites.push(
			created.ok
				? { email, link: created.value.link, emailed: created.value.emailed, error: created.value.mailError }
				: { email, link: null, emailed: false, error: created.error },
		);
	}
	return c.json({ ...opened.value, guestInvites } satisfies DirectOpened);
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

dmThreadsRoutes.post('/w/:wid/dms/:cid/grades', async (c) => {
	const grades = await gradeList(c, (await readJson<{ gradeIds: string[] }>(c)).gradeIds);
	if (!grades?.length) {
		return fail(c, 400, 'Requête invalide');
	}
	const actors = await loadActors(c.env.DB, c.get('workspaceId'));
	return unwrap(c, await stub(c).updateDirect(c.get('actor'), c.req.param('cid'), { addGrades: grades }, actors));
});

dmThreadsRoutes.delete('/w/:wid/dms/:cid/grades/:gid', async (c) => {
	const actors = await loadActors(c.env.DB, c.get('workspaceId'));
	return unwrap(c, await stub(c).updateDirect(c.get('actor'), c.req.param('cid'), { removeGrade: c.req.param('gid') }, actors));
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
