import { describe, expect, it } from 'vitest';

import type { NotificationPage } from '../shared/notifications';
import { P } from '../shared/permissions';
import type { Channel, Message, ServerEvent } from '../shared/types';
import { signup, workspaceWithMember } from './helpers';

const post = (client: Awaited<ReturnType<typeof signup>>, wid: string, cid: string, body: string, replyTo?: number) =>
	client.req<Message>('POST', `/api/w/${wid}/channels/${cid}/messages`, { body, replyTo });

const list = (client: Awaited<ReturnType<typeof signup>>, wid: string, query = '') => client.req<NotificationPage>('GET', `/api/w/${wid}/notifications${query}`);

describe('notifications', () => {
	it('notifie une mention et une réponse, jamais l’auteur', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const mention = await post(owner, wid, general.id, `salut <@${member.user.id}> et <@${owner.user.id}>`);
		const mine = await post(member, wid, general.id, 'question');
		await post(owner, wid, general.id, 'réponse', mine.data.id);

		const page = await list(member, wid);
		expect(page.status).toBe(200);
		expect(page.data.unread).toBe(2);
		expect(page.data.items.map((n) => n.kind)).toEqual(['reply', 'mention']);
		expect(page.data.items[1]).toMatchObject({ channelId: general.id, messageId: mention.data.id, actorId: owner.user.id, readAt: null });
		expect(page.data.items[1]!.title).toContain('#général');
		expect((await list(owner, wid)).data.items).toHaveLength(0);

		const mentions = await list(member, wid, '?filter=mentions');
		expect(mentions.data.items.map((n) => n.kind)).toEqual(['reply', 'mention']);
	});

	it('une réponse qui mentionne ne notifie qu’une fois', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const mine = await post(member, wid, general.id, 'question');
		await post(owner, wid, general.id, `<@${member.user.id}> voilà`, mine.data.id);
		const page = await list(member, wid);
		expect(page.data.items.map((n) => n.kind)).toEqual(['mention']);
	});

	it('marque lu, tout marquer lu et filtre non lues', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		for (let i = 0; i < 3; i++) {
			await post(owner, wid, general.id, `<@${member.user.id}> ${i}`);
		}
		const [first] = (await list(member, wid)).data.items;
		const marked = await member.req<{ unread: number }>('POST', `/api/w/${wid}/notifications/read`, { ids: [first!.id] });
		expect(marked.data.unread).toBe(2);
		expect((await list(member, wid, '?filter=unread')).data.items).toHaveLength(2);
		expect((await member.req<{ unread: number }>('POST', `/api/w/${wid}/notifications/read`, { all: true })).data.unread).toBe(0);
		expect((await list(member, wid, '?filter=unread')).data.items).toHaveLength(0);
		expect((await member.req('POST', `/api/w/${wid}/notifications/read`, { ids: [] })).status).toBe(400);
		expect((await member.req('POST', `/api/w/${wid}/notifications/read`, { ids: ['x'] })).status).toBe(400);
		expect((await list(member, wid, '?filter=nope')).status).toBe(400);
		expect((await list(member, wid, '?before=-1')).status).toBe(400);
	});

	it('lire le salon marque ses notifications lues', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		await post(owner, wid, general.id, `<@${member.user.id}>`);
		expect((await list(member, wid)).data.unread).toBe(1);
		expect((await member.req('POST', `/api/w/${wid}/channels/${general.id}/read`)).status).toBe(200);
		expect((await list(member, wid)).data.unread).toBe(0);
	});

	it('pagine par curseur', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		for (let i = 0; i < 32; i++) {
			await post(owner, wid, general.id, `<@${member.user.id}> ${i}`);
		}
		const first = await list(member, wid);
		expect(first.data.items).toHaveLength(30);
		expect(first.data.next).toBe(first.data.items.at(-1)!.id);
		const second = await list(member, wid, `?before=${first.data.next}`);
		expect(second.data.items).toHaveLength(2);
		expect(second.data.next).toBeNull();
	});

	it('édition : seules les nouvelles mentions notifient ; suppression retire', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const third = await signup('Chloé');
		const msg = await post(owner, wid, general.id, `<@${member.user.id}>`);
		await owner.req('PATCH', `/api/w/${wid}/messages/${msg.data.id}`, { body: `<@${member.user.id}> <@${third.user.id}>` });
		expect((await list(member, wid)).data.items).toHaveLength(1);
		await owner.req('DELETE', `/api/w/${wid}/messages/${msg.data.id}`);
		expect((await list(member, wid)).data.items).toHaveLength(0);
	});

	it('salon invisible : notifications masquées et préférence refusée', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const secret = await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'secret' });
		await post(owner, wid, secret.data.id, `<@${member.user.id}>`);
		expect((await list(member, wid)).data.unread).toBe(1);
		await owner.req('PUT', `/api/w/${wid}/channels/${secret.data.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } });
		const page = await list(member, wid);
		expect(page.data.items).toHaveLength(0);
		expect(page.data.unread).toBe(0);
		expect((await member.req('PUT', `/api/w/${wid}/notifications/prefs/${secret.data.id}`, { level: 'all' })).status).toBe(404);
		expect((await member.req('POST', `/api/w/${wid}/notifications/read`, { all: true })).data.unread).toBe(0);
		await owner.req('PUT', `/api/w/${wid}/channels/${secret.data.id}/overrides`, { overrides: {} });
		expect((await list(member, wid)).data.unread).toBe(1);
	});

	it('préférences par salon : tout, mentions, rien', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		expect((await member.req('PUT', `/api/w/${wid}/notifications/prefs/${general.id}`, { level: 'bruyant' })).status).toBe(400);
		expect((await member.req('PUT', `/api/w/${wid}/notifications/prefs/${general.id}`, { level: 'all' })).status).toBe(200);
		expect((await member.req('GET', `/api/w/${wid}/notifications/prefs`)).data).toEqual({ [general.id]: 'all' });
		await post(owner, wid, general.id, 'bonjour');
		expect((await list(member, wid)).data.items.map((n) => n.kind)).toEqual(['message']);

		await member.req('PUT', `/api/w/${wid}/notifications/prefs/${general.id}`, { level: 'none' });
		await post(owner, wid, general.id, `<@${member.user.id}> rien`);
		expect((await list(member, wid)).data.items).toHaveLength(1);

		await member.req('PUT', `/api/w/${wid}/notifications/prefs/${general.id}`, { level: 'mentions' });
		expect((await member.req('GET', `/api/w/${wid}/notifications/prefs`)).data).toEqual({});
		await post(owner, wid, general.id, 'sans mention');
		await post(owner, wid, general.id, `<@${member.user.id}> avec`);
		expect((await list(member, wid)).data.items.map((n) => n.kind)).toEqual(['mention', 'message']);
	});

	it('pousse en temps réel et envoie le compteur à la connexion', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		await post(owner, wid, general.id, `<@${member.user.id}> avant`);
		const socket = await member.socket(wid);
		expect(await socket.next('notifications_unread')).toEqual({ t: 'notifications_unread', unread: 1 });
		await post(owner, wid, general.id, `<@${member.user.id}> pendant`);
		const event = (await socket.next('notification')) as Extract<ServerEvent, { t: 'notification' }>;
		expect(event.unread).toBe(2);
		expect(event.notification).toMatchObject({ kind: 'mention', body: `<@${member.user.id}> pendant` });
		await member.req('POST', `/api/w/${wid}/notifications/read`, { all: true });
		expect(await socket.next('notifications_unread')).toEqual({ t: 'notifications_unread', unread: 0 });
		socket.ws.close();
	});

	it('refuse les non-membres et purge au départ', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const stranger = await signup('Dan');
		expect((await list(stranger, wid)).status).toBe(404);
		await post(owner, wid, general.id, `<@${member.user.id}>`);
		expect((await owner.req('DELETE', `/api/w/${wid}/members/${member.user.id}`)).status).toBe(200);
		const invite = await owner.req<{ code: string }>('POST', `/api/w/${wid}/invites`);
		await member.req('POST', `/api/invites/${invite.data.code}/accept`);
		expect((await list(member, wid)).data.items).toHaveLength(0);
	});
});
