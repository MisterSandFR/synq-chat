import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { DAY, occurrences, type CalendarEvent, type CalendarListing } from '../shared/calendar';
import { P } from '../shared/permissions';
import type { Grade } from '../shared/types';
import { sendReminders } from '../worker/calendar';
import { parseIcs } from '../worker/ics';
import { Client, signup, workspaceWithMember } from './helpers';

const HOUR = 3_600_000;
// Secrets absents en test : seuls DB et WORKSPACE servent ici.
const workerEnv = env as unknown as Env;
const ICS_TYPE = { 'content-type': 'text/calendar' };
const BASE = Date.UTC(2026, 10, 2, 9);
const RANGE = `from=${BASE - DAY}&to=${BASE + DAY}`;

const input = (extra: Record<string, unknown> = {}) => ({ title: 'Point hebdo', startsAt: BASE, endsAt: BASE + HOUR, timezone: 'UTC', ...extra });

describe('calendrier : accès', () => {
	it('montre les événements d’espace aux seuls membres', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const stranger = await signup('Eve');
		const created = await owner.req<CalendarEvent>('POST', '/api/calendar/events', input({ workspaceId: wid, attendees: [member.user.id] }));
		expect(created.status).toBe(201);
		expect(created.data).toMatchObject({ workspaceId: wid, canEdit: true, attendees: [{ id: member.user.id, response: 'pending' }] });

		const seen = await member.req<CalendarListing>('GET', `/api/calendar/events?${RANGE}`);
		expect(seen.data.events.map((e) => e.id)).toEqual([created.data.id]);
		expect(seen.data.events[0]).toMatchObject({ myResponse: 'pending', canEdit: false });
		expect(seen.data.occurrences).toEqual([{ eventId: created.data.id, startsAt: BASE, endsAt: BASE + HOUR }]);

		expect((await stranger.req<CalendarListing>('GET', `/api/calendar/events?${RANGE}`)).data.events).toHaveLength(0);
		expect((await stranger.req('GET', `/api/calendar/events/${created.data.id}`)).status).toBe(404);
		expect((await stranger.req('POST', '/api/calendar/events', input({ workspaceId: wid }))).status).toBe(404);
		expect((await stranger.req('PUT', `/api/calendar/events/${created.data.id}/response`, { response: 'yes' })).status).toBe(404);
		expect((await new Client().req('GET', `/api/calendar/events?${RANGE}`)).status).toBe(401);
	});

	it('applique les permissions de grade', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const mine = await member.req<CalendarEvent>('POST', '/api/calendar/events', input({ workspaceId: wid }));
		expect(mine.status).toBe(201);
		expect(mine.data.canEdit).toBe(true);
		const theirs = await owner.req<CalendarEvent>('POST', '/api/calendar/events', input({ workspaceId: wid }));
		expect((await member.req('PATCH', `/api/calendar/events/${theirs.data.id}`, { title: 'Pirate' })).status).toBe(403);
		expect((await member.req('DELETE', `/api/calendar/events/${theirs.data.id}`)).status).toBe(403);
		expect((await owner.req<CalendarEvent>('PATCH', `/api/calendar/events/${mine.data.id}`, { title: 'Renommé' })).data.title).toBe('Renommé');

		const grades = await owner.req<Grade[]>('GET', `/api/w/${wid}/grades`);
		const base = grades.data.find((g) => g.id === 'default')!.permissions;
		expect(base & P.CREATE_EVENTS).toBeTruthy();
		await owner.req('PATCH', `/api/w/${wid}/grades/default`, { permissions: base & ~P.CREATE_EVENTS });
		expect((await member.req('POST', '/api/calendar/events', input({ workspaceId: wid }))).status).toBe(403);
		expect((await member.req('PATCH', `/api/calendar/events/${mine.data.id}`, { title: 'Encore' })).status).toBe(403);

		await owner.req('PATCH', `/api/w/${wid}/grades/default`, { permissions: base & ~P.CREATE_EVENTS & ~P.VIEW_EVENTS });
		expect((await member.req<CalendarListing>('GET', `/api/calendar/events?${RANGE}`)).data.events).toHaveLength(0);
	});

	it('limite un événement personnel à son auteur et ses invités', async () => {
		const { owner, member } = await workspaceWithMember();
		const stranger = await signup('Eve');
		expect((await owner.req('POST', '/api/calendar/events', input({ workspaceId: null, attendees: [stranger.user.id] }))).status).toBe(400);
		const created = await owner.req<CalendarEvent>('POST', '/api/calendar/events', input({ workspaceId: null, attendees: [member.user.id] }));
		expect(created.status).toBe(201);

		expect((await member.req('PUT', `/api/calendar/events/${created.data.id}/response`, { response: 'yes' })).status).toBe(200);
		expect((await member.req('PUT', `/api/calendar/events/${created.data.id}/response`, { response: 'peut-être' })).status).toBe(400);
		expect((await member.req<CalendarEvent>('GET', `/api/calendar/events/${created.data.id}`)).data.myResponse).toBe('yes');
		expect((await member.req('PATCH', `/api/calendar/events/${created.data.id}`, { title: 'X' })).status).toBe(403);
		expect((await stranger.req('GET', `/api/calendar/events/${created.data.id}`)).status).toBe(404);
	});

	it('valide la saisie', async () => {
		const owner = await signup('Alice');
		const bad = [
			input({ title: '  ' }),
			input({ endsAt: BASE - 1 }),
			input({ allDay: true }),
			input({ timezone: 'Mars/Olympus' }),
			input({ color: 'rouge' }),
			input({ recurrence: { freq: 'yearly', interval: 1, until: null } }),
			input({ reminderMinutes: -5 }),
			input({ channelId: 'abc' }),
		];
		for (const body of bad) {
			expect((await owner.req('POST', '/api/calendar/events', body)).status).toBe(400);
		}
		expect((await owner.req('GET', `/api/calendar/events?from=0&to=${1000 * DAY}`)).status).toBe(400);
	});
});

describe('calendrier : récurrence et rappels', () => {
	it('suit le changement d’heure et supprime une occurrence', async () => {
		const owner = await signup('Alice');
		// Lundi 9 h à Paris, de part et d'autre du passage à l'heure d'hiver.
		const start = Date.UTC(2026, 9, 19, 7);
		const created = await owner.req<CalendarEvent>('POST', '/api/calendar/events', {
			title: 'Hebdo',
			startsAt: start,
			endsAt: start + HOUR,
			timezone: 'Europe/Paris',
			recurrence: { freq: 'weekly', interval: 1, until: null },
		});
		expect(created.status).toBe(201);
		const list = async () => (await owner.req<CalendarListing>('GET', `/api/calendar/events?from=${start}&to=${start + 21 * DAY}`)).data.occurrences.map((o) => o.startsAt);
		expect(await list()).toEqual([start, Date.UTC(2026, 9, 26, 8), Date.UTC(2026, 10, 2, 8)]);

		const path = `/api/calendar/events/${created.data.id}`;
		expect((await owner.req('DELETE', `${path}?occurrence=abc`)).status).toBe(400);
		expect((await owner.req('DELETE', `${path}?occurrence=${start + 1}`)).status).toBe(400);
		expect((await owner.req('DELETE', `${path}?occurrence=${Date.UTC(2026, 9, 26, 8)}`)).status).toBe(200);
		expect(await list()).toEqual([start, Date.UTC(2026, 10, 2, 8)]);
		expect((await owner.req('DELETE', path)).status).toBe(200);
		expect(await list()).toEqual([]);
	});

	it('saute les mois sans le jour de départ', () => {
		const start = Date.UTC(2026, 0, 31, 10);
		const starts = occurrences({ startsAt: start, endsAt: start + HOUR, timezone: 'UTC', recurrence: { freq: 'monthly', interval: 1, until: null }, exceptions: [] }, start, Date.UTC(2026, 5, 1));
		expect(starts.map((ms) => new Date(ms).getUTCMonth())).toEqual([0, 2, 4]);
	});

	it('pousse le rappel aux sockets du destinataire, une seule fois', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const socket = await member.socket(wid);
		await socket.next('hello');
		const startsAt = Math.ceil((Date.now() + 30 * 60_000) / 1000) * 1000;
		const created = await owner.req<CalendarEvent>('POST', '/api/calendar/events', {
			workspaceId: wid,
			title: 'Démo',
			startsAt,
			endsAt: startsAt + HOUR,
			timezone: 'UTC',
			reminderMinutes: 15,
			attendees: [member.user.id],
		});
		expect(created.status).toBe(201);
		const due = startsAt - 15 * 60_000;
		expect(await sendReminders(workerEnv, due - 1000)).toBe(0);
		expect(await sendReminders(workerEnv, due + 1000)).toBe(1);
		const event = await socket.next('calendar_reminder');
		expect(event).toMatchObject({ t: 'calendar_reminder', reminder: { eventId: created.data.id, title: 'Démo', startsAt, workspaceId: wid } });
		expect(await sendReminders(workerEnv, due + 2000)).toBe(0);
		socket.ws.close();
	});
});

const ICS = [
	'BEGIN:VCALENDAR',
	'VERSION:2.0',
	'BEGIN:VEVENT',
	'UID:reunion@test',
	'DTSTART;TZID=Europe/Paris:20261105T140000',
	'DTEND;TZID=Europe/Paris:20261105T150000',
	'SUMMARY:Réunion\\, équipe',
	'RRULE:FREQ=WEEKLY;COUNT=3',
	'EXDATE;TZID=Europe/Paris:20261112T140000',
	'BEGIN:VALARM',
	'TRIGGER:-PT15M',
	'END:VALARM',
	'END:VEVENT',
	'BEGIN:VEVENT',
	'UID:ferie@test',
	'DTSTART;VALUE=DATE:20261111',
	'SUMMARY:Férié',
	'END:VEVENT',
	'END:VCALENDAR',
].join('\r\n');

describe('calendrier : ICS', () => {
	it('analyse un fichier ICS', () => {
		const [reunion, ferie] = parseIcs(ICS, 'UTC', 10);
		expect(reunion).toMatchObject({ title: 'Réunion, équipe', startsAt: Date.UTC(2026, 10, 5, 13), timezone: 'Europe/Paris', exceptions: [Date.UTC(2026, 10, 12, 13)] });
		expect(reunion!.recurrence).toEqual({ freq: 'weekly', interval: 1, until: Date.UTC(2026, 10, 19, 13) });
		expect(ferie).toMatchObject({ allDay: true, startsAt: Date.UTC(2026, 10, 11), endsAt: Date.UTC(2026, 10, 12) });
	});

	it('importe sans doublon', async () => {
		const owner = await signup('Alice');
		expect((await owner.req('POST', '/api/calendar/import', 'pas un agenda', ICS_TYPE)).status).toBe(400);
		expect((await owner.req('POST', '/api/calendar/import?tz=Europe/Paris', ICS, ICS_TYPE)).data).toEqual({ imported: 2, skipped: 0 });
		expect((await owner.req('POST', '/api/calendar/import?tz=Europe/Paris', ICS, ICS_TYPE)).data).toEqual({ imported: 0, skipped: 2 });
		const listing = await owner.req<CalendarListing>('GET', `/api/calendar/events?from=${Date.UTC(2026, 10, 1)}&to=${Date.UTC(2026, 11, 1)}`);
		expect(listing.data.occurrences.map((o) => o.startsAt)).toEqual([Date.UTC(2026, 10, 5, 13), Date.UTC(2026, 10, 11), Date.UTC(2026, 10, 19, 13)]);
	});

	it('sert le flux par jeton secret, révocable', async () => {
		const owner = await signup('Alice');
		await owner.req('POST', '/api/calendar/events', input({ title: 'Stand-up; quotidien', recurrence: { freq: 'daily', interval: 1, until: BASE + 4 * DAY } }));
		expect((await owner.req('GET', '/api/calendar/feed')).data).toEqual({ active: false, createdAt: null });
		const feed = await owner.req<{ url: string }>('POST', '/api/calendar/feed');
		expect(feed.status).toBe(201);
		const path = new URL(feed.data.url).pathname;
		const anonymous = new Client();
		const res = await anonymous.raw('GET', path);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/calendar');
		const body = await res.text();
		expect(body).toContain('SUMMARY:Stand-up\\; quotidien');
		expect(body).toContain('RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20261106T090000Z');

		await owner.req('POST', '/api/calendar/feed');
		expect((await anonymous.raw('GET', path)).status).toBe(404);
		await owner.req('DELETE', '/api/calendar/feed');
		expect((await owner.req('GET', '/api/calendar/feed')).data).toMatchObject({ active: false });
		expect((await anonymous.raw('GET', '/api/ics/inconnu.ics')).status).toBe(404);
	});
});
