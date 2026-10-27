import type { CalendarEvent, EventCard, EventInput } from '../shared/calendar';
import { createEvent, getEvent } from './calendar';
import { workspaceStub } from './http';
import { toIcs } from './ics';
import { err, ok, type Result } from './result';

export async function eventWorkspace(db: D1Database, id: string): Promise<string | null> {
	const row = await db.prepare('SELECT workspace_id FROM events WHERE id = ?').bind(id).first<{ workspace_id: string | null }>();
	return row?.workspace_id ?? null;
}

// Événement de cet espace visible par l'utilisateur.
async function workspaceEvent(db: D1Database, userId: string, workspaceId: string, id: string): Promise<Result<CalendarEvent>> {
	const found = await getEvent(db, userId, id);
	return found.ok && found.value.workspaceId === workspaceId ? found : err(404, 'Événement introuvable');
}

// Événement existant à partager, ou créé dans l'espace ; `created` permet l'annulation si le message échoue.
export async function cardEvent(
	env: Env,
	userId: string,
	workspaceId: string,
	input: { eventId?: unknown; event?: unknown },
): Promise<Result<{ event: CalendarEvent; created: boolean }>> {
	if (typeof input.eventId === 'string') {
		const found = await workspaceEvent(env.DB, userId, workspaceId, input.eventId);
		return found.ok ? ok({ event: found.value, created: false }) : found;
	}
	if (input.event && typeof input.event === 'object') {
		const created = await createEvent(env, userId, { ...(input.event as Partial<EventInput>), workspaceId });
		return created.ok ? ok({ event: created.value, created: true }) : created;
	}
	return err(400, 'Événement requis');
}

export async function readCard(db: D1Database, userId: string, workspaceId: string, id: string): Promise<Result<EventCard>> {
	const found = await getEvent(db, userId, id);
	if (found.ok) {
		return found.value.workspaceId === workspaceId ? ok({ status: 'active', event: found.value }) : err(404, 'Événement introuvable');
	}
	const row = await db.prepare('SELECT workspace_id FROM events WHERE id = ?').bind(id).first<{ workspace_id: string | null }>();
	if (!row) {
		return ok({ status: 'cancelled' });
	}
	return row.workspace_id === workspaceId ? err(403, 'Calendrier de l’espace non accessible') : err(404, 'Événement introuvable');
}

export async function cardIcs(db: D1Database, userId: string, workspaceId: string, id: string): Promise<Result<{ title: string; body: string }>> {
	const found = await workspaceEvent(db, userId, workspaceId, id);
	if (!found.ok) {
		return found;
	}
	const event = found.value;
	const row = await db.prepare('SELECT uid, updated_at FROM events WHERE id = ?').bind(id).first<{ uid: string; updated_at: number }>();
	const uid = row?.uid ?? id;
	const body = toIcs(
		[
			{
				uid: uid.includes('@') ? uid : `${uid}@synq`,
				title: event.title,
				description: event.description,
				location: event.location,
				startsAt: event.startsAt,
				endsAt: event.endsAt,
				allDay: event.allDay,
				timezone: event.timezone,
				recurrence: event.recurrence,
				exceptions: event.exceptions,
				updatedAt: row?.updated_at ?? Date.now(),
			},
		],
		'Synq',
	);
	return ok({ title: event.title, body });
}

// Rafraîchit les cartes de l'espace ; un échec ne doit pas annuler l'action déjà faite.
export async function touchCards(env: Env, eventId: string, workspaceId: string | null): Promise<void> {
	if (workspaceId) {
		await workspaceStub(env, workspaceId)
			.eventCardChanged(eventId)
			.catch(() => undefined);
	}
}
