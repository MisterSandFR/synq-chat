import { Hono } from 'hono';

import { ABSENCE_LIMITS, daysBetween, validDay, type AbsenceInput } from '../../shared/absences';
import { absenceAudience, createAbsence, deleteAbsence, listAbsences, updateAbsence } from '../absences';
import { fail, readJson, unwrap, type AppEnv } from '../http';
import { calendarChanged } from './calendar';

export const absenceRoutes = new Hono<AppEnv>();

absenceRoutes.get('/absences', async (c) => {
	const from = c.req.query('from');
	const to = c.req.query('to');
	if (!validDay(from) || !validDay(to) || to < from || daysBetween(from, to) > ABSENCE_LIMITS.rangeDays) {
		return fail(c, 400, 'Période invalide');
	}
	return unwrap(c, await listAbsences(c.env.DB, c.get('user').id, from, to, c.req.query('workspace') || null));
});

absenceRoutes.post('/absences', async (c) => {
	const created = await createAbsence(c.env.DB, c.get('user').id, await readJson<AbsenceInput>(c));
	if (!created.ok) {
		return fail(c, created.status, created.error);
	}
	calendarChanged(c, await absenceAudience(c.env.DB, created.value.userId));
	return c.json(created.value, 201);
});

absenceRoutes.patch('/absences/:id', async (c) => {
	const updated = await updateAbsence(c.env.DB, c.get('user').id, c.req.param('id'), await readJson<AbsenceInput>(c));
	if (updated.ok) {
		calendarChanged(c, await absenceAudience(c.env.DB, updated.value.userId));
	}
	return unwrap(c, updated);
});

absenceRoutes.delete('/absences/:id', async (c) => {
	const deleted = await deleteAbsence(c.env.DB, c.get('user').id, c.req.param('id'));
	if (!deleted.ok) {
		return fail(c, deleted.status, deleted.error);
	}
	calendarChanged(c, await absenceAudience(c.env.DB, deleted.value.userId));
	return c.json({ ok: true });
});
