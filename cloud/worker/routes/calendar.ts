import { Hono } from 'hono';

import { CALENDAR_LIMITS, DAY, type EventInput } from '../../shared/calendar';
import { createEvent, deleteEvent, eventAudience, feedIcs, feedStatus, getEvent, importIcs, listEvents, listPeople, respond, revokeFeed, rotateFeed, updateEvent } from '../calendar';
import { eventWorkspace, touchCards } from '../event-cards';
import { fail, readJson, unwrap, type AppEnv, type Ctx } from '../http';
import { notifyUsers } from '../user-hub';

// Calendriers ouverts rafraîchis après la réponse ; audience lue avant une suppression.
export const calendarChanged = (c: Ctx, users: string[]) => c.executionCtx.waitUntil(notifyUsers(c.env, users, { t: 'calendar' }));

// Monté avant le middleware de session : un agenda externe s'abonne sans cookie.
export const icsRoutes = new Hono<AppEnv>();

icsRoutes.get('/ics/:file', async (c) => {
	const token = /^([\w-]{20,64})\.ics$/.exec(c.req.param('file'))?.[1];
	const body = token ? await feedIcs(c.env.DB, token) : null;
	if (body === null) {
		return fail(c, 404, 'Flux introuvable');
	}
	return new Response(body, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': 'inline; filename="synq.ics"',
			'Cache-Control': 'private, max-age=300',
			'X-Content-Type-Options': 'nosniff',
		},
	});
});

export const calendarRoutes = new Hono<AppEnv>();

const stamp = (value: string | undefined) => {
	const n = Number(value);
	return value !== undefined && value !== '' && Number.isSafeInteger(n) ? n : null;
};

calendarRoutes.get('/calendar/events', async (c) => {
	const from = stamp(c.req.query('from'));
	const to = stamp(c.req.query('to'));
	if (from === null || to === null || to <= from || to - from > CALENDAR_LIMITS.rangeDays * DAY) {
		return fail(c, 400, 'Période invalide');
	}
	return c.json(await listEvents(c.env.DB, c.get('user').id, from, to));
});

calendarRoutes.post('/calendar/events', async (c) => {
	const created = await createEvent(c.env, c.get('user').id, await readJson<EventInput>(c));
	if (!created.ok) {
		return fail(c, created.status, created.error);
	}
	calendarChanged(c, await eventAudience(c.env.DB, created.value.id));
	return c.json(created.value, 201);
});

calendarRoutes.get('/calendar/events/:id', async (c) => unwrap(c, await getEvent(c.env.DB, c.get('user').id, c.req.param('id'))));

calendarRoutes.patch('/calendar/events/:id', async (c) => {
	const before = await eventAudience(c.env.DB, c.req.param('id'));
	const updated = await updateEvent(c.env, c.get('user').id, c.req.param('id'), await readJson<EventInput>(c));
	if (updated.ok) {
		await touchCards(c.env, updated.value.id, updated.value.workspaceId);
		// Invités retirés ou espace changé : l'ancienne audience doit aussi relire.
		calendarChanged(c, [...before, ...(await eventAudience(c.env.DB, updated.value.id))]);
	}
	return unwrap(c, updated);
});

calendarRoutes.delete('/calendar/events/:id', async (c) => {
	const raw = c.req.query('occurrence');
	const occurrence = stamp(raw);
	// Occurrence illisible : refus plutôt que suppression de toute la série.
	if (raw !== undefined && occurrence === null) {
		return fail(c, 400, 'Occurrence invalide');
	}
	const workspaceId = await eventWorkspace(c.env.DB, c.req.param('id'));
	const audience = await eventAudience(c.env.DB, c.req.param('id'));
	const deleted = await deleteEvent(c.env.DB, c.get('user').id, c.req.param('id'), occurrence);
	if (deleted.ok) {
		await touchCards(c.env, c.req.param('id'), workspaceId);
		calendarChanged(c, audience);
	}
	return unwrap(c, deleted);
});

calendarRoutes.put('/calendar/events/:id/response', async (c) => {
	const { response } = await readJson<{ response: string }>(c);
	const answered = await respond(c.env.DB, c.get('user').id, c.req.param('id'), response);
	if (answered.ok) {
		await touchCards(c.env, c.req.param('id'), await eventWorkspace(c.env.DB, c.req.param('id')));
		calendarChanged(c, await eventAudience(c.env.DB, c.req.param('id')));
	}
	return unwrap(c, answered);
});

calendarRoutes.get('/calendar/people', async (c) => unwrap(c, await listPeople(c.env.DB, c.get('user').id, c.req.query('workspace') || null)));

calendarRoutes.get('/calendar/feed', async (c) => c.json(await feedStatus(c.env.DB, c.get('user').id)));

calendarRoutes.post('/calendar/feed', async (c) => {
	const token = await rotateFeed(c.env.DB, c.get('user').id);
	return c.json({ url: `${new URL(c.req.url).origin}/api/ics/${token}.ics` }, 201);
});

calendarRoutes.delete('/calendar/feed', async (c) => {
	await revokeFeed(c.env.DB, c.get('user').id);
	return c.json({ ok: true });
});

calendarRoutes.post('/calendar/import', async (c) => {
	const size = Number(c.req.header('Content-Length'));
	if (!Number.isInteger(size) || size <= 0) {
		return fail(c, 400, 'Fichier vide ou taille inconnue');
	}
	if (size > CALENDAR_LIMITS.importBytes) {
		return fail(c, 413, 'Fichier trop lourd (1 Mo max)');
	}
	const source = await c.req.text();
	if (!/BEGIN:VCALENDAR/i.test(source)) {
		return fail(c, 400, 'Fichier ICS invalide');
	}
	const workspaceId = c.req.query('workspace') || null;
	const imported = await importIcs(c.env, c.get('user').id, source, workspaceId, c.req.query('tz') ?? 'UTC');
	if (imported.ok) {
		const { results } = workspaceId
			? await c.env.DB.prepare("SELECT user_id FROM members WHERE workspace_id = ? AND role != 'guest'").bind(workspaceId).all<{ user_id: string }>()
			: { results: [] };
		calendarChanged(c, [c.get('user').id, ...results.map((row) => row.user_id)]);
	}
	return unwrap(c, imported);
});
