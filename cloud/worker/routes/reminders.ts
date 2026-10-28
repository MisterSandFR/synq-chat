import { Hono } from 'hono';

import type { ReminderInput, ReminderPatch } from '../../shared/reminders';
import { fail, readJson, stub, unwrap, type AppEnv } from '../http';

export const reminderRoutes = new Hono<AppEnv>();

const isDue = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value));

const reminderId = (raw: string) => (/^\d+$/.test(raw) ? Number(raw) : 0);

reminderRoutes.get('/w/:wid/later', async (c) => c.json(await stub(c).laterItems(c.get('actor'))));

reminderRoutes.post('/w/:wid/reminders', async (c) => {
	const body = await readJson<ReminderInput>(c);
	if (
		!isDue(body.dueAt) ||
		(body.messageId != null && typeof body.messageId !== 'number') ||
		(body.text !== undefined && typeof body.text !== 'string') ||
		(body.done !== undefined && typeof body.done !== 'boolean')
	) {
		return fail(c, 400, 'Requête invalide');
	}
	const result = await stub(c).setReminder(c.get('actor'), c.get('workspaceId'), { messageId: body.messageId ?? null, text: body.text, dueAt: body.dueAt ?? null, done: body.done });
	return result.ok ? c.json(result.value, 201) : unwrap(c, result);
});

reminderRoutes.patch('/w/:wid/reminders/:id', async (c) => {
	const body = await readJson<ReminderPatch>(c);
	if ((body.dueAt !== undefined && !isDue(body.dueAt)) || (body.done !== undefined && typeof body.done !== 'boolean') || (body.dueAt === undefined && body.done === undefined)) {
		return fail(c, 400, 'Requête invalide');
	}
	return unwrap(c, await stub(c).updateReminder(c.get('actor'), reminderId(c.req.param('id')), { dueAt: body.dueAt, done: body.done }));
});

reminderRoutes.delete('/w/:wid/reminders/:id', async (c) => unwrap(c, await stub(c).removeReminder(c.get('actor'), reminderId(c.req.param('id')))));
