import { describe, expect, it } from 'vitest';

import type { CalendarEvent, CalendarListing, EventCard } from '../shared/calendar';
import type { Message, MessagePage } from '../shared/types';
import { signup, workspaceWithMember } from './helpers';

const HOUR = 3_600_000;
const BASE = Date.UTC(2026, 10, 2, 9);
const input = (extra: Record<string, unknown> = {}) => ({ title: 'Point hebdo', startsAt: BASE, endsAt: BASE + HOUR, timezone: 'UTC', ...extra });

describe('cartes d’événement', () => {
	it('crée l’événement, publie la carte et suit les réponses', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const posted = await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/event-cards`, { event: input({ location: 'Salle 2' }), text: 'On se voit ?' });
		expect(posted.status).toBe(201);
		expect(posted.data).toMatchObject({ channelId: general.id, body: 'On se voit ?' });
		const eventId = posted.data.eventId!;
		expect(eventId).toBeTruthy();

		const page = await member.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.find((m) => m.id === posted.data.id)?.eventId).toBe(eventId);

		const card = await member.req<EventCard>('GET', `/api/w/${wid}/event-cards/${eventId}`);
		expect(card.status).toBe(200);
		expect(card.data).toMatchObject({ status: 'active', event: { title: 'Point hebdo', workspaceId: wid, location: 'Salle 2', myResponse: null } });

		const { ws, next } = await owner.socket(wid);
		expect((await member.req('PUT', `/api/calendar/events/${eventId}/response`, { response: 'yes' })).status).toBe(200);
		expect(await next('event_card')).toEqual({ t: 'event_card', eventId });
		ws.close();

		const after = await owner.req<EventCard>('GET', `/api/w/${wid}/event-cards/${eventId}`);
		expect(after.data.status === 'active' && after.data.event.attendees).toEqual([expect.objectContaining({ id: member.user.id, response: 'yes' })]);
		// Réponse oui : l'événement figure dans le calendrier global du membre.
		const listing = await member.req<CalendarListing>('GET', `/api/calendar/events?from=${BASE - HOUR}&to=${BASE + 2 * HOUR}`);
		expect(listing.data.events.find((e) => e.id === eventId)?.myResponse).toBe('yes');
	});

	it('partage un événement existant et passe en annulé à la suppression', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const event = await owner.req<CalendarEvent>('POST', '/api/calendar/events', input({ workspaceId: wid }));
		const posted = await member.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/event-cards`, { eventId: event.data.id });
		expect(posted.status).toBe(201);
		expect(posted.data).toMatchObject({ body: '', eventId: event.data.id });

		const ics = await member.req<string>('GET', `/api/w/${wid}/event-cards/${event.data.id}/ics`);
		expect(ics.status).toBe(200);
		expect(ics.data).toContain('SUMMARY:Point hebdo');

		expect((await owner.req('DELETE', `/api/calendar/events/${event.data.id}`)).status).toBe(200);
		expect((await member.req<EventCard>('GET', `/api/w/${wid}/event-cards/${event.data.id}`)).data).toEqual({ status: 'cancelled' });
		expect((await member.req('GET', `/api/w/${wid}/event-cards/${event.data.id}/ics`)).status).toBe(404);
	});

	it('refuse les événements hors de l’espace et les intrus', async () => {
		const { owner, wid, general } = await workspaceWithMember();
		const other = await workspaceWithMember();
		const personal = await owner.req<CalendarEvent>('POST', '/api/calendar/events', input());
		const foreign = await other.owner.req<CalendarEvent>('POST', '/api/calendar/events', input({ workspaceId: other.wid }));
		const path = `/api/w/${wid}/channels/${general.id}/event-cards`;
		expect((await owner.req('POST', path, { eventId: personal.data.id })).status).toBe(404);
		expect((await owner.req('POST', path, { eventId: foreign.data.id })).status).toBe(404);
		expect((await owner.req('POST', path, {})).status).toBe(400);
		expect((await owner.req('POST', path, { event: input({ title: '' }) })).status).toBe(400);
		expect((await owner.req('GET', `/api/w/${wid}/event-cards/${foreign.data.id}`)).status).toBe(404);

		const stranger = await signup('Eve');
		const shared = await owner.req<Message>('POST', path, { event: input() });
		expect((await stranger.req('GET', `/api/w/${wid}/event-cards/${shared.data.eventId}`)).status).toBe(404);
		expect((await stranger.req('POST', path, { eventId: shared.data.eventId })).status).toBe(404);
	});

	it('n’ajoute pas d’événement orphelin quand le salon refuse le message', async () => {
		const { member, wid, announcements } = await workspaceWithMember();
		const res = await member.req('POST', `/api/w/${wid}/channels/${announcements.id}/event-cards`, { event: input() });
		expect(res.status).toBe(403);
		const listing = await member.req<CalendarListing>('GET', `/api/calendar/events?from=${BASE - HOUR}&to=${BASE + 2 * HOUR}`);
		expect(listing.data.events).toHaveLength(0);
	});
});
