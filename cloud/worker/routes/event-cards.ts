import { Hono } from 'hono';

import { deleteEvent, eventAudience } from '../calendar';
import { cardEvent, cardIcs, readCard } from '../event-cards';
import { fail, readJson, stub, unwrap, type AppEnv } from '../http';
import { calendarChanged } from './calendar';

export const eventCardRoutes = new Hono<AppEnv>();

eventCardRoutes.post('/w/:wid/channels/:cid/event-cards', async (c) => {
	const input = await readJson<{ eventId: string; event: unknown; text: string }>(c);
	const userId = c.get('user').id;
	const found = await cardEvent(c.env, userId, c.get('workspaceId'), input);
	if (!found.ok) {
		return fail(c, found.status, found.error);
	}
	const { event, created } = found.value;
	const posted = await stub(c).postMessage(c.get('actor'), c.req.param('cid'), typeof input.text === 'string' ? input.text : '', [], null, event.id);
	if (!posted.ok) {
		// Pas d'événement orphelin quand le salon refuse le message.
		if (created) {
			await deleteEvent(c.env.DB, userId, event.id, null);
		}
		return fail(c, posted.status, posted.error);
	}
	if (created) {
		calendarChanged(c, await eventAudience(c.env.DB, event.id));
	}
	return c.json(posted.value, 201);
});

eventCardRoutes.get('/w/:wid/event-cards/:eid', async (c) => unwrap(c, await readCard(c.env.DB, c.get('user').id, c.get('workspaceId'), c.req.param('eid'))));

eventCardRoutes.get('/w/:wid/event-cards/:eid/ics', async (c) => {
	const file = await cardIcs(c.env.DB, c.get('user').id, c.get('workspaceId'), c.req.param('eid'));
	if (!file.ok) {
		return fail(c, file.status, file.error);
	}
	const name = file.value.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'evenement';
	return new Response(file.value.body, {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': `attachment; filename="evenement.ics"; filename*=UTF-8''${encodeURIComponent(name)}.ics`,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
		},
	});
});
