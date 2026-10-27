import { Hono } from 'hono';

import { NOTIFY_LEVELS, type NotificationFilter, type NotifyLevel } from '../../shared/notifications';
import { fail, readJson, stub, unwrap, type AppEnv } from '../http';

export const notificationRoutes = new Hono<AppEnv>();

const FILTERS: NotificationFilter[] = ['all', 'mentions', 'unread'];

notificationRoutes.get('/w/:wid/notifications', async (c) => {
	const filter = (c.req.query('filter') ?? 'all') as NotificationFilter;
	const rawBefore = c.req.query('before');
	const before = rawBefore === undefined ? null : Number(rawBefore);
	if (!FILTERS.includes(filter) || (before !== null && !(Number.isInteger(before) && before > 0))) {
		return fail(c, 400, 'Requête invalide');
	}
	return c.json(await stub(c).notificationsList(c.get('actor'), filter, before));
});

notificationRoutes.post('/w/:wid/notifications/read', async (c) => {
	const { ids, all } = await readJson<{ ids: number[]; all: boolean }>(c);
	if (all === true) {
		return c.json(await stub(c).notificationsRead(c.get('actor'), 'all'));
	}
	if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((id) => Number.isInteger(id) && id > 0)) {
		return fail(c, 400, 'Requête invalide');
	}
	return c.json(await stub(c).notificationsRead(c.get('actor'), ids));
});

notificationRoutes.get('/w/:wid/notifications/prefs', async (c) => c.json(await stub(c).notificationPrefs(c.get('actor'))));

notificationRoutes.put('/w/:wid/notifications/prefs/:cid', async (c) => {
	const { level } = await readJson<{ level: NotifyLevel }>(c);
	if (!NOTIFY_LEVELS.includes(level as NotifyLevel)) {
		return fail(c, 400, 'Niveau invalide');
	}
	return unwrap(c, await stub(c).setNotificationPref(c.get('actor'), c.req.param('cid'), level as NotifyLevel));
});
