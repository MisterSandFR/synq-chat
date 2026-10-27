import {
	CALENDAR_LIMITS,
	DAY,
	nextRemindAt,
	occurrences,
	validTimeZone,
	type Attendee,
	type CalendarEvent,
	type CalendarFeed,
	type CalendarListing,
	type CalendarPerson,
	type CalendarReminder,
	type EventInput,
	type EventTiming,
	type Recurrence,
	type RsvpResponse,
} from '../shared/calendar';
import { P, has } from '../shared/permissions';
import type { Actor } from '../shared/types';
import { randomToken, sha256 } from './crypto';
import { loadActor } from './grades';
import { workspaceStub } from './http';
import { parseIcs, toIcs } from './ics';
import { err, ok, type Result } from './result';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
// Rappel manqué depuis plus longtemps (cron en retard) : abandonné.
const STALE_REMINDER = 15 * 60_000;
const FREQS = new Set(['daily', 'weekly', 'monthly']);

type EventRow = {
	id: string;
	workspace_id: string | null;
	created_by: string;
	uid: string;
	title: string;
	description: string;
	starts_at: number;
	ends_at: number;
	all_day: number;
	timezone: string;
	location: string;
	channel_id: string | null;
	color: string;
	rrule_freq: Recurrence['freq'] | null;
	rrule_interval: number;
	rrule_until: number | null;
	reminder_minutes: number | null;
	next_remind_at: number | null;
	updated_at: number;
};

type Access = Map<string, Actor>;

export async function loadAccess(db: D1Database, userId: string): Promise<Access> {
	const { results } = await db.prepare('SELECT workspace_id FROM members WHERE user_id = ?').bind(userId).all<{ workspace_id: string }>();
	const access: Access = new Map();
	await Promise.all(
		results.map(async ({ workspace_id }) => {
			const actor = await loadActor(db, workspace_id, userId);
			if (actor) {
				access.set(workspace_id, actor);
			}
		}),
	);
	return access;
}

const permsIn = (access: Access, workspaceId: string) => access.get(workspaceId)?.perms ?? 0;

const canEdit = (row: EventRow, userId: string, access: Access) =>
	row.workspace_id === null
		? row.created_by === userId
		: has(permsIn(access, row.workspace_id), P.MANAGE_EVENTS) || (row.created_by === userId && has(permsIn(access, row.workspace_id), P.CREATE_EVENTS));

const recurrenceOf = (row: EventRow): Recurrence | null => (row.rrule_freq ? { freq: row.rrule_freq, interval: row.rrule_interval, until: row.rrule_until } : null);

const timingOf = (row: EventRow, exceptions: number[]): EventTiming => ({
	startsAt: row.starts_at,
	endsAt: row.ends_at,
	timezone: row.timezone,
	recurrence: recurrenceOf(row),
	exceptions,
});

function toEvent(row: EventRow, attendees: Attendee[], exceptions: number[], userId: string, access: Access): CalendarEvent {
	return {
		...timingOf(row, exceptions),
		id: row.id,
		workspaceId: row.workspace_id,
		createdBy: row.created_by,
		title: row.title,
		description: row.description,
		allDay: row.all_day === 1,
		location: row.location,
		channelId: row.channel_id,
		color: row.color,
		reminderMinutes: row.reminder_minutes,
		attendees,
		canEdit: canEdit(row, userId, access),
		myResponse: attendees.find((a) => a.id === userId)?.response ?? null,
	};
}

async function details(db: D1Database, ids: string[]) {
	const attendees = new Map<string, Attendee[]>();
	const exceptions = new Map<string, number[]>();
	if (!ids.length) {
		return { attendees, exceptions };
	}
	const json = JSON.stringify(ids);
	const [people, skips] = await db.batch([
		db
			.prepare(
				'SELECT a.event_id, u.id, u.name, u.avatar_url AS avatarUrl, a.response FROM event_attendees a JOIN users u ON u.id = a.user_id WHERE a.event_id IN (SELECT value FROM json_each(?)) ORDER BY u.name COLLATE NOCASE',
			)
			.bind(json),
		db.prepare('SELECT event_id, occurs_at FROM event_exceptions WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY occurs_at').bind(json),
	]);
	for (const { event_id, ...attendee } of people!.results as Array<Attendee & { event_id: string }>) {
		attendees.set(event_id, [...(attendees.get(event_id) ?? []), attendee]);
	}
	for (const { event_id, occurs_at } of skips!.results as Array<{ event_id: string; occurs_at: number }>) {
		exceptions.set(event_id, [...(exceptions.get(event_id) ?? []), occurs_at]);
	}
	return { attendees, exceptions };
}

// Événements d'espace (VIEW_EVENTS) et personnels (auteur ou invité) qui touchent [from, to[.
async function visibleRows(db: D1Database, userId: string, access: Access, from: number, to: number): Promise<EventRow[]> {
	const workspaces = [...access].filter(([, actor]) => has(actor.perms, P.VIEW_EVENTS)).map(([id]) => id);
	const { results } = await db
		.prepare(
			`SELECT * FROM events e
			WHERE (e.workspace_id IN (SELECT value FROM json_each(?1))
				OR (e.workspace_id IS NULL AND (e.created_by = ?2 OR EXISTS (SELECT 1 FROM event_attendees a WHERE a.event_id = e.id AND a.user_id = ?2))))
			AND e.starts_at < ?4
			AND (CASE WHEN e.rrule_freq IS NULL THEN MAX(e.ends_at, e.starts_at + 1) ELSE COALESCE(e.rrule_until + MAX(e.ends_at - e.starts_at, 1), ?4) END) > ?3
			ORDER BY e.starts_at LIMIT 2000`,
		)
		.bind(JSON.stringify(workspaces), userId, from, to)
		.all<EventRow>();
	return results;
}

async function visibleRow(db: D1Database, userId: string, id: string, access: Access): Promise<EventRow | null> {
	const row = await db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();
	if (!row) {
		return null;
	}
	if (row.workspace_id !== null) {
		return has(permsIn(access, row.workspace_id), P.VIEW_EVENTS) ? row : null;
	}
	if (row.created_by === userId) {
		return row;
	}
	const invited = await db.prepare('SELECT 1 FROM event_attendees WHERE event_id = ? AND user_id = ?').bind(id, userId).first();
	return invited ? row : null;
}

export async function listEvents(db: D1Database, userId: string, from: number, to: number): Promise<CalendarListing> {
	const access = await loadAccess(db, userId);
	const rows = await visibleRows(db, userId, access, from, to);
	const { attendees, exceptions } = await details(
		db,
		rows.map((row) => row.id),
	);
	const events = rows.map((row) => toEvent(row, attendees.get(row.id) ?? [], exceptions.get(row.id) ?? [], userId, access));
	const list = events.flatMap((event) => occurrences(event, from, to).map((startsAt) => ({ eventId: event.id, startsAt, endsAt: startsAt + event.endsAt - event.startsAt })));
	list.sort((a, b) => a.startsAt - b.startsAt);
	return { events, occurrences: list.slice(0, CALENDAR_LIMITS.occurrences) };
}

export async function getEvent(db: D1Database, userId: string, id: string): Promise<Result<CalendarEvent>> {
	const access = await loadAccess(db, userId);
	const row = await visibleRow(db, userId, id, access);
	if (!row) {
		return err(404, 'Événement introuvable');
	}
	const { attendees, exceptions } = await details(db, [id]);
	return ok(toEvent(row, attendees.get(id) ?? [], exceptions.get(id) ?? [], userId, access));
}

const text = (value: unknown, fallback: string, max: number) => (value === undefined ? fallback : typeof value === 'string' ? value.trim().slice(0, max) : '');

// Saisie partielle fusionnée sur l'existant, puis validée.
function normalize(input: Partial<EventInput>, base: EventInput): Result<EventInput> {
	const pick = <K extends keyof EventInput>(key: K): unknown => (input[key] === undefined ? base[key] : input[key]);
	const allDay = pick('allDay') === true;
	const startsAt = pick('startsAt');
	const endsAt = pick('endsAt');
	const timezone = allDay ? 'UTC' : pick('timezone');
	const color = pick('color');
	const recurrence = pick('recurrence') as Recurrence | null;
	const reminder = pick('reminderMinutes');
	const attendees = pick('attendees');
	const channelId = pick('channelId');
	const workspaceId = pick('workspaceId');
	const data: EventInput = {
		workspaceId: typeof workspaceId === 'string' ? workspaceId : null,
		title: text(input.title, base.title, CALENDAR_LIMITS.title),
		description: text(input.description, base.description, CALENDAR_LIMITS.description),
		location: text(input.location, base.location, CALENDAR_LIMITS.location),
		startsAt: startsAt as number,
		endsAt: endsAt as number,
		allDay,
		timezone: timezone as string,
		channelId: typeof channelId === 'string' && channelId ? channelId : null,
		color: typeof color === 'string' ? color.toUpperCase() : '',
		recurrence,
		reminderMinutes: reminder as number | null,
		attendees: Array.isArray(attendees) ? [...new Set(attendees.filter((id): id is string => typeof id === 'string'))] : [],
	};
	if (!data.title) {
		return err(400, 'Titre requis');
	}
	if (!Number.isSafeInteger(data.startsAt) || !Number.isSafeInteger(data.endsAt) || data.endsAt < data.startsAt || data.endsAt - data.startsAt > 366 * DAY) {
		return err(400, 'Dates invalides');
	}
	if (allDay && (data.startsAt % DAY !== 0 || data.endsAt % DAY !== 0 || data.endsAt === data.startsAt)) {
		return err(400, 'Journée entière : dates invalides');
	}
	if (!validTimeZone(data.timezone)) {
		return err(400, 'Fuseau horaire invalide');
	}
	if (data.color && !HEX_RE.test(data.color)) {
		return err(400, 'Couleur invalide');
	}
	if (recurrence !== null) {
		const valid =
			typeof recurrence === 'object' &&
			FREQS.has(recurrence.freq) &&
			Number.isInteger(recurrence.interval) &&
			recurrence.interval >= 1 &&
			recurrence.interval <= CALENDAR_LIMITS.interval &&
			(recurrence.until === null || (Number.isSafeInteger(recurrence.until) && recurrence.until >= data.startsAt));
		if (!valid) {
			return err(400, 'Récurrence invalide');
		}
		data.recurrence = { freq: recurrence.freq, interval: recurrence.interval, until: recurrence.until };
	}
	if (data.reminderMinutes !== null && (!Number.isInteger(data.reminderMinutes) || data.reminderMinutes < 0 || data.reminderMinutes > CALENDAR_LIMITS.reminderMinutes)) {
		return err(400, 'Rappel invalide');
	}
	if (data.attendees.length > CALENDAR_LIMITS.attendees) {
		return err(400, `${CALENDAR_LIMITS.attendees} participants maximum`);
	}
	if (data.workspaceId === null && data.channelId) {
		return err(400, 'Salon vocal réservé aux événements d’espace');
	}
	return ok(data);
}

const EMPTY: EventInput = {
	workspaceId: null,
	title: '',
	description: '',
	startsAt: Number.NaN,
	endsAt: Number.NaN,
	allDay: false,
	timezone: 'UTC',
	location: '',
	channelId: null,
	color: '',
	recurrence: null,
	reminderMinutes: null,
	attendees: [],
};

export async function listPeople(db: D1Database, userId: string, workspaceId: string | null): Promise<Result<CalendarPerson[]>> {
	if (workspaceId) {
		const member = await db.prepare('SELECT 1 FROM members WHERE workspace_id = ? AND user_id = ?').bind(workspaceId, userId).first();
		if (!member) {
			return err(404, 'Espace introuvable');
		}
		const { results } = await db
			.prepare('SELECT u.id, u.name, u.avatar_url AS avatarUrl FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name COLLATE NOCASE')
			.bind(workspaceId)
			.all<CalendarPerson>();
		return ok(results);
	}
	// Invités personnels : seulement des gens qui partagent un espace avec soi.
	const { results } = await db
		.prepare(
			'SELECT DISTINCT u.id, u.name, u.avatar_url AS avatarUrl FROM members mine JOIN members m ON m.workspace_id = mine.workspace_id JOIN users u ON u.id = m.user_id WHERE mine.user_id = ? ORDER BY u.name COLLATE NOCASE LIMIT 1000',
		)
		.bind(userId)
		.all<CalendarPerson>();
	return ok(results);
}

// Droits, participants et salon vocal vérifiés côté serveur.
async function authorize(env: Env, userId: string, access: Access, data: EventInput): Promise<Result<null>> {
	if (data.workspaceId !== null) {
		const actor = access.get(data.workspaceId);
		if (!actor) {
			return err(404, 'Espace introuvable');
		}
		if (data.channelId) {
			const channels = await workspaceStub(env, data.workspaceId).channels(actor);
			if (!channels.some((channel) => channel.id === data.channelId && channel.kind === 'voice')) {
				return err(400, 'Salon vocal introuvable');
			}
		}
	}
	if (data.attendees.length) {
		const people = await listPeople(env.DB, userId, data.workspaceId);
		const allowed = new Set(people.ok ? people.value.map((p) => p.id) : []);
		if (!data.attendees.every((id) => allowed.has(id))) {
			return err(400, 'Participant inconnu');
		}
	}
	return ok(null);
}

const attendeeStatements = (db: D1Database, id: string, attendees: string[]) => [
	db.prepare('DELETE FROM event_attendees WHERE event_id = ? AND user_id NOT IN (SELECT value FROM json_each(?))').bind(id, JSON.stringify(attendees)),
	db.prepare('INSERT INTO event_attendees (event_id, user_id) SELECT ?, value FROM json_each(?) WHERE true ON CONFLICT DO NOTHING').bind(id, JSON.stringify(attendees)),
];

const remindAt = (data: EventInput, exceptions: number[]) => nextRemindAt({ ...data, exceptions }, data.reminderMinutes, Date.now());

const INSERT_SQL = `INSERT INTO events (id, workspace_id, created_by, uid, title, description, starts_at, ends_at, all_day, timezone, location, channel_id, color,
	rrule_freq, rrule_interval, rrule_until, reminder_minutes, next_remind_at, created_at, updated_at)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (created_by, uid) DO NOTHING`;

const insertEvent = (db: D1Database, id: string, uid: string, userId: string, data: EventInput, nextRemind: number | null, now: number) =>
	db
		.prepare(INSERT_SQL)
		.bind(
			id,
			data.workspaceId,
			userId,
			uid,
			data.title,
			data.description,
			data.startsAt,
			data.endsAt,
			data.allDay ? 1 : 0,
			data.timezone,
			data.location,
			data.channelId,
			data.color,
			data.recurrence?.freq ?? null,
			data.recurrence?.interval ?? 1,
			data.recurrence?.until ?? null,
			data.reminderMinutes,
			nextRemind,
			now,
			now,
		);

export async function createEvent(env: Env, userId: string, input: Partial<EventInput>): Promise<Result<CalendarEvent>> {
	const normalized = normalize(input, EMPTY);
	if (!normalized.ok) {
		return normalized;
	}
	const data = normalized.value;
	const access = await loadAccess(env.DB, userId);
	if (data.workspaceId !== null && access.has(data.workspaceId) && !has(permsIn(access, data.workspaceId), P.CREATE_EVENTS)) {
		return err(403, 'Permission insuffisante');
	}
	const allowed = await authorize(env, userId, access, data);
	if (!allowed.ok) {
		return allowed;
	}
	const id = crypto.randomUUID();
	await env.DB.batch([insertEvent(env.DB, id, id, userId, data, remindAt(data, []), Date.now()), ...attendeeStatements(env.DB, id, data.attendees)]);
	return getEvent(env.DB, userId, id);
}

export async function updateEvent(env: Env, userId: string, id: string, input: Partial<EventInput>): Promise<Result<CalendarEvent>> {
	const current = await getEvent(env.DB, userId, id);
	if (!current.ok) {
		return current;
	}
	const event = current.value;
	if (!event.canEdit) {
		return err(403, 'Modification non autorisée');
	}
	// Un événement ne change pas d'espace.
	const normalized = normalize({ ...input, workspaceId: event.workspaceId }, { ...event, attendees: event.attendees.map((a) => a.id) });
	if (!normalized.ok) {
		return normalized;
	}
	const data = normalized.value;
	const access = await loadAccess(env.DB, userId);
	const allowed = await authorize(env, userId, access, data);
	if (!allowed.ok) {
		return allowed;
	}
	// Exceptions liées aux anciens horaires : obsolètes si la série bouge.
	const moved =
		data.startsAt !== event.startsAt || data.timezone !== event.timezone || JSON.stringify(data.recurrence) !== JSON.stringify(event.recurrence);
	const exceptions = moved ? [] : event.exceptions;
	await env.DB.batch([
		env.DB.prepare(
			`UPDATE events SET title = ?, description = ?, starts_at = ?, ends_at = ?, all_day = ?, timezone = ?, location = ?, channel_id = ?, color = ?,
			rrule_freq = ?, rrule_interval = ?, rrule_until = ?, reminder_minutes = ?, next_remind_at = ?, updated_at = ? WHERE id = ?`,
		).bind(
			data.title,
			data.description,
			data.startsAt,
			data.endsAt,
			data.allDay ? 1 : 0,
			data.timezone,
			data.location,
			data.channelId,
			data.color,
			data.recurrence?.freq ?? null,
			data.recurrence?.interval ?? 1,
			data.recurrence?.until ?? null,
			data.reminderMinutes,
			remindAt(data, exceptions),
			Date.now(),
			id,
		),
		...(moved ? [env.DB.prepare('DELETE FROM event_exceptions WHERE event_id = ?').bind(id)] : []),
		...attendeeStatements(env.DB, id, data.attendees),
	]);
	return getEvent(env.DB, userId, id);
}

// `occurrence` : supprime seulement cette occurrence d'une série.
export async function deleteEvent(db: D1Database, userId: string, id: string, occurrence: number | null): Promise<Result<null>> {
	const current = await getEvent(db, userId, id);
	if (!current.ok) {
		return current;
	}
	const event = current.value;
	if (!event.canEdit) {
		return err(403, 'Modification non autorisée');
	}
	if (occurrence === null || !event.recurrence) {
		await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
		return ok(null);
	}
	if (!occurrences({ ...event, endsAt: event.startsAt + 1 }, occurrence, occurrence + 1, 1).includes(occurrence)) {
		return err(400, 'Occurrence introuvable');
	}
	const exceptions = [...event.exceptions, occurrence];
	await db.batch([
		db.prepare('INSERT INTO event_exceptions (event_id, occurs_at) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(id, occurrence),
		db
			.prepare('UPDATE events SET next_remind_at = ?, updated_at = ? WHERE id = ?')
			.bind(nextRemindAt({ ...event, exceptions }, event.reminderMinutes, Date.now()), Date.now(), id),
	]);
	return ok(null);
}

export async function respond(db: D1Database, userId: string, id: string, response: unknown): Promise<Result<null>> {
	if (response !== 'yes' && response !== 'no' && response !== 'maybe') {
		return err(400, 'Réponse invalide');
	}
	const access = await loadAccess(db, userId);
	if (!(await visibleRow(db, userId, id, access))) {
		return err(404, 'Événement introuvable');
	}
	await db
		.prepare('INSERT INTO event_attendees (event_id, user_id, response) VALUES (?, ?, ?) ON CONFLICT (event_id, user_id) DO UPDATE SET response = excluded.response')
		.bind(id, userId, response satisfies RsvpResponse)
		.run();
	return ok(null);
}

export async function feedStatus(db: D1Database, userId: string): Promise<CalendarFeed> {
	const row = await db.prepare('SELECT created_at FROM calendar_feeds WHERE user_id = ?').bind(userId).first<{ created_at: number }>();
	return { active: Boolean(row), createdAt: row?.created_at ?? null };
}

// Nouveau jeton : l'ancien lien cesse de fonctionner. Seul le hash est stocké.
export async function rotateFeed(db: D1Database, userId: string): Promise<string> {
	const token = randomToken(24);
	await db
		.prepare('INSERT INTO calendar_feeds (user_id, token_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at')
		.bind(userId, await sha256(token), Date.now())
		.run();
	return token;
}

export async function revokeFeed(db: D1Database, userId: string): Promise<void> {
	await db.prepare('DELETE FROM calendar_feeds WHERE user_id = ?').bind(userId).run();
}

export async function feedIcs(db: D1Database, token: string): Promise<string | null> {
	const feed = await db.prepare('SELECT user_id FROM calendar_feeds WHERE token_hash = ?').bind(await sha256(token)).first<{ user_id: string }>();
	if (!feed) {
		return null;
	}
	const access = await loadAccess(db, feed.user_id);
	const rows = await visibleRows(db, feed.user_id, access, Date.now() - 180 * DAY, Number.MAX_SAFE_INTEGER);
	const { exceptions } = await details(
		db,
		rows.map((row) => row.id),
	);
	return toIcs(
		rows.map((row) => ({
			...timingOf(row, exceptions.get(row.id) ?? []),
			uid: row.uid.includes('@') ? row.uid : `${row.uid}@synq`,
			title: row.title,
			description: row.description,
			location: row.location,
			allDay: row.all_day === 1,
			updatedAt: row.updated_at,
		})),
		'Synq',
	);
}

export async function importIcs(env: Env, userId: string, source: string, workspaceId: string | null, timezone: string): Promise<Result<{ imported: number; skipped: number }>> {
	if (workspaceId !== null) {
		const access = await loadAccess(env.DB, userId);
		if (!access.has(workspaceId)) {
			return err(404, 'Espace introuvable');
		}
		if (!has(permsIn(access, workspaceId), P.CREATE_EVENTS)) {
			return err(403, 'Permission insuffisante');
		}
	}
	const parsed = parseIcs(source, validTimeZone(timezone) ? timezone : 'UTC', CALENDAR_LIMITS.importEvents);
	const now = Date.now();
	const inserts: D1PreparedStatement[] = [];
	const statements: D1PreparedStatement[] = [];
	for (const item of parsed) {
		const normalized = normalize({ ...item, title: item.title || 'Sans titre', workspaceId, attendees: [], channelId: null }, EMPTY);
		if (!normalized.ok) {
			continue;
		}
		const data = normalized.value;
		const id = crypto.randomUUID();
		const insert = insertEvent(env.DB, id, item.uid || id, userId, data, null, now);
		inserts.push(insert);
		statements.push(insert);
		if (data.recurrence && item.exceptions.length) {
			// Événement déjà importé (même UID) : pas d'exceptions orphelines.
			statements.push(
				env.DB.prepare('INSERT INTO event_exceptions (event_id, occurs_at) SELECT ?, value FROM json_each(?) WHERE EXISTS (SELECT 1 FROM events WHERE id = ?) ON CONFLICT DO NOTHING').bind(
					id,
					JSON.stringify(item.exceptions.slice(0, 500)),
					id,
				),
			);
		}
	}
	let imported = 0;
	for (let i = 0; i < statements.length; i += 100) {
		const chunk = statements.slice(i, i + 100);
		const results = await env.DB.batch(chunk);
		results.forEach((result, index) => {
			if (inserts.includes(chunk[index]!)) {
				imported += result.meta.changes ?? 0;
			}
		});
	}
	return ok({ imported, skipped: parsed.length - imported });
}

// Appelé par le cron chaque minute : rappels dus poussés aux sockets de chaque destinataire.
export async function sendReminders(env: Env, now: number): Promise<number> {
	const { results } = await env.DB.prepare('SELECT * FROM events WHERE next_remind_at <= ? ORDER BY next_remind_at LIMIT 200').bind(now).all<EventRow>();
	let sent = 0;
	for (const row of results) {
		const due = row.next_remind_at!;
		const { attendees, exceptions } = await details(env.DB, [row.id]);
		const next = nextRemindAt(timingOf(row, exceptions.get(row.id) ?? []), row.reminder_minutes, due + 1);
		// Mise à jour conditionnelle : deux crons concurrents n'envoient pas deux fois.
		const claimed = await env.DB.prepare('UPDATE events SET next_remind_at = ? WHERE id = ? AND next_remind_at = ?').bind(next, row.id, due).run();
		if (!claimed.meta.changes || now - due > STALE_REMINDER) {
			continue;
		}
		const recipients = new Set([row.created_by, ...(attendees.get(row.id) ?? []).filter((a) => a.response !== 'no').map((a) => a.id)]);
		const { results: links } = await env.DB.prepare('SELECT workspace_id, user_id FROM members WHERE user_id IN (SELECT value FROM json_each(?))')
			.bind(JSON.stringify([...recipients]))
			.all<{ workspace_id: string; user_id: string }>();
		const reminder: CalendarReminder = {
			eventId: row.id,
			title: row.title,
			startsAt: due + (row.reminder_minutes ?? 0) * 60_000,
			workspaceId: row.workspace_id,
			location: row.location,
		};
		const stored = new Set<string>();
		// Espace de l'événement s'il est partagé, sinon le premier espace de la personne.
		const primary = (link: { workspace_id: string; user_id: string }) => {
			const own = row.workspace_id ? link.workspace_id === row.workspace_id : !stored.has(link.user_id);
			if (own) {
				stored.add(link.user_id);
			}
			return own;
		};
		await Promise.all(links.map((link) => workspaceStub(env, link.workspace_id).calendarReminder(link.user_id, reminder, primary(link))));
		sent++;
	}
	return sent;
}
