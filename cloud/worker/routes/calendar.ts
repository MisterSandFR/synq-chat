import { Hono } from 'hono';

import { CALENDAR_LIMITS, DAY, type EventInput } from '../../shared/calendar';
import { createEvent, deleteEvent, feedIcs, feedStatus, getEvent, importIcs, listEvents, listPeople, respond, revokeFeed, rotateFeed, updateEvent } from '../calendar';
import { fail, readJson, unwrap, type AppEnv } from '../http';

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
	return created.ok ? c.json(created.value, 201) : fail(c, created.status, created.error);
});

calendarRoutes.get('/calendar/events/:id', async (c) => unwrap(c, await getEvent(c.env.DB, c.get('user').id, c.req.param('id'))));

calendarRoutes.patch('/calendar/events/:id', async (c) => unwrap(c, await updateEvent(c.env, c.get('user').id, c.req.param('id'), await readJson<EventInput>(c))));

calendarRoutes.delete('/calendar/events/:id', async (c) => {
	const raw = c.req.query('occurrence');
	const occurrence = stamp(raw);
	// Occurrence illisible : refus plutôt que suppression de toute la série.
	if (raw !== undefined && occurrence === null) {
		return fail(c, 400, 'Occurrence invalide');
	}
	return unwrap(c, await deleteEvent(c.env.DB, c.get('user').id, c.req.param('id'), occurrence));
});

calendarRoutes.put('/calendar/events/:id/response', async (c) => {
	const { response } = await readJson<{ response: string }>(c);
	return unwrap(c, await respond(c.env.DB, c.get('user').id, c.req.param('id'), response));
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
	return unwrap(c, await importIcs(c.env, c.get('user').id, source, c.req.query('workspace') || null, c.req.query('tz') ?? 'UTC'));
});
