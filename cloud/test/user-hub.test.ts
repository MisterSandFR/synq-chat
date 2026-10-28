import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { CalendarEvent } from '../shared/calendar';
import type { UserEvent } from '../shared/user-events';
import { BASE, signup, workspaceWithMember, type Client } from './helpers';

const HOUR = 3_600_000;
const START = Date.UTC(2026, 10, 2, 9);

async function personal(client: Client) {
	const res = await exports.default.fetch(new Request(`${BASE}/api/me/ws`, { headers: { Upgrade: 'websocket', cookie: client.cookie } }));
	const ws = res.webSocket!;
	ws.accept();
	const queue: UserEvent[] = [];
	ws.addEventListener('message', (event) => queue.push(JSON.parse(event.data as string) as UserEvent));
	// Les notifications partent en waitUntil : on attend leur arrivée.
	const count = async (n: number) => {
		for (let i = 0; i < 40 && queue.length < n; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		return queue.length;
	};
	return { ws, queue, count };
}

describe('canal personnel', () => {
	it('prévient les membres de l’espace à la création, la modification et la suppression', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const outsider = await signup('Dave');
		const bob = await personal(member);
		const dave = await personal(outsider);
		const created = await owner.req<CalendarEvent>('POST', '/api/calendar/events', { title: 'Point', startsAt: START, endsAt: START + HOUR, timezone: 'UTC', workspaceId: wid });
		expect(created.status).toBe(201);
		expect(await bob.count(1)).toBe(1);
		expect(bob.queue[0]).toEqual({ t: 'calendar' });
		expect((await owner.req('PATCH', `/api/calendar/events/${created.data.id}`, { title: 'Point décalé' })).status).toBe(200);
		expect(await bob.count(2)).toBe(2);
		expect((await owner.req('DELETE', `/api/calendar/events/${created.data.id}`)).status).toBe(200);
		expect(await bob.count(3)).toBe(3);
		// Hors de l'espace : rien.
		expect(await dave.count(1)).toBe(0);
		bob.ws.close();
		dave.ws.close();
	});

	it('prévient les invités d’un événement personnel', async () => {
		const { owner, member } = await workspaceWithMember();
		const bob = await personal(member);
		const created = await owner.req<CalendarEvent>('POST', '/api/calendar/events', { title: 'Déjeuner', startsAt: START, endsAt: START + HOUR, timezone: 'UTC', attendees: [member.user.id] });
		expect(created.status).toBe(201);
		expect(await bob.count(1)).toBe(1);
		bob.ws.close();
	});

	it('refuse sans session', async () => {
		const res = await exports.default.fetch(new Request(`${BASE}/api/me/ws`, { headers: { Upgrade: 'websocket' } }));
		expect(res.status).toBe(401);
	});
});
