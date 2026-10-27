import { describe, expect, it } from 'vitest';

import type { DirectConversation, FollowedThread, ThreadView } from '../shared/dm-threads';
import { P } from '../shared/permissions';
import type { Channel, Message, MessagePage, ServerEvent } from '../shared/types';
import { signup, workspaceWithMember, type Client } from './helpers';

async function trio() {
	const base = await workspaceWithMember();
	const carol = await signup('Carol');
	const invite = await base.owner.req<{ code: string }>('POST', `/api/w/${base.wid}/invites`);
	expect((await carol.req('POST', `/api/invites/${invite.data.code}/accept`)).status).toBe(200);
	return { ...base, carol };
}

describe('messages directs', () => {
	it('ouvre un DM visible des seuls participants, propriétaire compris', async () => {
		const { owner, member, carol, wid } = await trio();
		const opened = await member.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [carol.user.id] });
		expect(opened.status).toBe(200);
		expect([...opened.data.memberIds].sort()).toEqual([member.user.id, carol.user.id].sort());
		const again = await carol.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [member.user.id] });
		expect(again.data.id).toBe(opened.data.id);

		const dm = opened.data.id;
		expect((await member.req('POST', `/api/w/${wid}/channels/${dm}/messages`, { body: 'salut' })).status).toBe(200);
		expect((await carol.req<MessagePage>('GET', `/api/w/${wid}/channels/${dm}/messages`)).data.messages[0]?.body).toBe('salut');
		expect((await owner.req('GET', `/api/w/${wid}/channels/${dm}/messages`)).status).toBe(404);
		expect((await owner.req('POST', `/api/w/${wid}/channels/${dm}/messages`, { body: 'x' })).status).toBe(404);
		expect((await owner.req('PATCH', `/api/w/${wid}/channels/${dm}`, { name: 'pirate' })).status).toBe(404);
		expect((await owner.req('DELETE', `/api/w/${wid}/channels/${dm}`)).status).toBe(404);
		expect((await owner.req('GET', `/api/w/${wid}/channels/${dm}/overrides`)).status).toBe(404);
		expect((await owner.req<Channel[]>('GET', `/api/w/${wid}/channels`)).data.some((c) => c.id === dm)).toBe(false);
		expect((await carol.req<Channel[]>('GET', `/api/w/${wid}/channels`)).data.find((c) => c.id === dm)?.kind).toBe('dm');

		const list = await carol.req<DirectConversation[]>('GET', `/api/w/${wid}/dms`);
		expect(list.data).toHaveLength(1);
		expect(list.data[0]!.last).toMatchObject({ body: 'salut', userId: member.user.id });
		expect((await owner.req<DirectConversation[]>('GET', `/api/w/${wid}/dms`)).data).toHaveLength(0);

		const group = await owner.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [member.user.id, carol.user.id] });
		expect(group.data.memberIds).toHaveLength(3);
		expect(group.data.id).not.toBe(dm);
	});

	it('refuse les non-membres, soi seul et plus de 9 participants', async () => {
		const { member, wid } = await workspaceWithMember();
		const outsider = await signup('Eve');
		expect((await member.req('POST', `/api/w/${wid}/dms`, { userIds: [outsider.user.id] })).status).toBe(400);
		expect((await member.req('POST', `/api/w/${wid}/dms`, { userIds: [] })).status).toBe(400);
		expect((await member.req('POST', `/api/w/${wid}/dms`, { userIds: [member.user.id] })).status).toBe(400);
		expect((await member.req('POST', `/api/w/${wid}/dms`, { userIds: 'x' })).status).toBe(400);
		expect((await member.req('POST', `/api/w/${wid}/dms`, { userIds: Array.from({ length: 9 }, () => crypto.randomUUID()) })).status).toBe(400);
		expect((await outsider.req('POST', `/api/w/${wid}/dms`, { userIds: [member.user.id] })).status).toBe(404);
	});

	it('prévient les participants en temps réel et compte les non-lus', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const live = await member.socket(wid);
		await live.next('hello');
		const opened = await owner.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [member.user.id] });
		expect(await live.next('channel_upsert')).toMatchObject({ channel: { id: opened.data.id, kind: 'dm' } });
		expect(await live.next('dm')).toMatchObject({ conversation: { id: opened.data.id } });
		await owner.req('POST', `/api/w/${wid}/channels/${opened.data.id}/messages`, { body: 'coucou' });
		expect(await live.next('message')).toMatchObject({ message: { channelId: opened.data.id, body: 'coucou' } });
		live.ws.close();

		const again = await member.socket(wid);
		const hello = (await again.next('hello')) as Extract<ServerEvent, { t: 'hello' }>;
		expect(hello.unread[opened.data.id]).toBe(1);
		again.ws.close();
	});
});

async function joinAs(owner: Client, wid: string, name: string): Promise<Client> {
	const client = await signup(name);
	const invite = await owner.req<{ code: string }>('POST', `/api/w/${wid}/invites`);
	expect((await client.req('POST', `/api/invites/${invite.data.code}/accept`)).status).toBe(200);
	return client;
}

describe('groupes et appels', () => {
	it('renomme, ajoute, retire et quitte un groupe', async () => {
		const { owner, member, carol, wid } = await trio();
		const dave = await joinAs(owner, wid, 'Dave');
		const group = await member.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [carol.user.id, owner.user.id], name: 'Projet' });
		expect(group.data).toMatchObject({ group: true, name: 'Projet' });
		const gid = group.data.id;
		const pair = await member.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [carol.user.id] });
		expect(pair.data.group).toBe(false);
		expect((await member.req('PATCH', `/api/w/${wid}/dms/${pair.data.id}`, { name: 'x' })).status).toBe(400);
		expect((await dave.req('POST', `/api/w/${wid}/dms/${gid}/members`, { userIds: [dave.user.id] })).status).toBe(404);

		const added = await carol.req<DirectConversation>('POST', `/api/w/${wid}/dms/${gid}/members`, { userIds: [dave.user.id] });
		expect(added.data.memberIds).toContain(dave.user.id);
		expect((await dave.req('GET', `/api/w/${wid}/channels/${gid}/messages`)).status).toBe(200);

		const removed = await member.req<DirectConversation>('DELETE', `/api/w/${wid}/dms/${gid}/members/${dave.user.id}`);
		expect(removed.data.memberIds).not.toContain(dave.user.id);
		expect((await dave.req('GET', `/api/w/${wid}/channels/${gid}/messages`)).status).toBe(404);

		expect((await carol.req<DirectConversation>('PATCH', `/api/w/${wid}/dms/${gid}`, { name: 'Lancement' })).data.name).toBe('Lancement');
		const left = await carol.req('DELETE', `/api/w/${wid}/dms/${gid}/members/${carol.user.id}`);
		expect(left.status).toBe(200);
		expect(left.data).toBeNull();
		expect((await carol.req<DirectConversation[]>('GET', `/api/w/${wid}/dms`)).data.some((d) => d.id === gid)).toBe(false);
	});

	it('réserve l’appel aux participants et fait sonner les autres', async () => {
		const { owner, member, carol, wid } = await trio();
		const dm = await member.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [carol.user.id] });
		const ownerLive = await owner.socket(wid);
		const ownerHello = (await ownerLive.next('hello')) as Extract<ServerEvent, { t: 'hello' }>;
		expect((await owner.req('POST', `/api/w/${wid}/voice/join`, { channelId: dm.data.id, connId: ownerHello.connId })).status).toBe(404);

		const carolLive = await carol.socket(wid);
		await carolLive.next('hello');
		const memberLive = await member.socket(wid);
		const memberHello = (await memberLive.next('hello')) as Extract<ServerEvent, { t: 'hello' }>;
		expect((await member.req('POST', `/api/w/${wid}/voice/join`, { channelId: dm.data.id, connId: memberHello.connId })).status).toBe(200);
		expect(await carolLive.next('call_ring')).toMatchObject({ channelId: dm.data.id, by: member.user.id });
		for (const live of [ownerLive, carolLive, memberLive]) {
			live.ws.close();
		}
	});
});

describe('fils', () => {
	it('répond en fil hors du salon, sauf envoi aussi dans le salon', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const root = await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'question' });
		const reply = await member.req<Message>('POST', `/api/w/${wid}/messages/${root.data.id}/thread`, { body: 'réponse' });
		expect(reply.status).toBe(200);
		expect(reply.data.threadRoot).toBe(root.data.id);
		await member.req('POST', `/api/w/${wid}/messages/${root.data.id}/thread`, { body: 'aussi ici', broadcast: true });

		const page = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.map((m) => m.body)).toEqual(['question', 'aussi ici']);
		expect(page.data.messages[0]!.thread?.count).toBe(2);

		const view = await owner.req<ThreadView>('GET', `/api/w/${wid}/messages/${root.data.id}/thread`);
		expect(view.data.replies.map((m) => m.body)).toEqual(['réponse', 'aussi ici']);
		expect(view.data.following).toBe(true);

		expect((await member.req('POST', `/api/w/${wid}/messages/${reply.data.id}/thread`, { body: 'x' })).status).toBe(400);
		expect((await member.req('POST', `/api/w/${wid}/messages/${root.data.id}/thread`, { body: '  ' })).status).toBe(400);
		expect((await member.req('GET', `/api/w/${wid}/messages/999999/thread`)).status).toBe(404);
	});

	it('liste les fils suivis avec leurs non-lus', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const root = await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'sujet' });
		await member.req('POST', `/api/w/${wid}/messages/${root.data.id}/thread`, { body: 'avis' });

		const followed = await owner.req<FollowedThread[]>('GET', `/api/w/${wid}/threads`);
		expect(followed.data).toHaveLength(1);
		expect(followed.data[0]).toMatchObject({ root: { id: root.data.id }, unread: 1 });
		expect((await member.req<FollowedThread[]>('GET', `/api/w/${wid}/threads`)).data[0]?.unread).toBe(0);

		expect((await owner.req('POST', `/api/w/${wid}/messages/${root.data.id}/thread/read`)).status).toBe(200);
		expect((await owner.req<FollowedThread[]>('GET', `/api/w/${wid}/threads`)).data[0]?.unread).toBe(0);

		expect((await owner.req('PUT', `/api/w/${wid}/messages/${root.data.id}/follow`, { following: 'oui' })).status).toBe(400);
		expect((await owner.req('PUT', `/api/w/${wid}/messages/${root.data.id}/follow`, { following: false })).status).toBe(200);
		expect((await owner.req<FollowedThread[]>('GET', `/api/w/${wid}/threads`)).data).toHaveLength(0);
	});

	it('respecte la lecture et l’écriture du salon', async () => {
		const { owner, member, wid, general, announcements } = await workspaceWithMember();
		const notice = await owner.req<Message>('POST', `/api/w/${wid}/channels/${announcements.id}/messages`, { body: 'annonce' });
		expect((await member.req('POST', `/api/w/${wid}/messages/${notice.data.id}/thread`, { body: 'non' })).status).toBe(403);

		const root = await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'privé bientôt' });
		await member.req('POST', `/api/w/${wid}/messages/${root.data.id}/thread`, { body: 'vu' });
		const hidden = await owner.req('PUT', `/api/w/${wid}/channels/${general.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } });
		expect(hidden.status).toBe(200);
		expect((await member.req('GET', `/api/w/${wid}/messages/${root.data.id}/thread`)).status).toBe(404);
		expect((await member.req('POST', `/api/w/${wid}/messages/${root.data.id}/thread`, { body: 'x' })).status).toBe(404);
		expect((await member.req<FollowedThread[]>('GET', `/api/w/${wid}/threads`)).data).toHaveLength(0);
	});

	it('diffuse les réponses en temps réel', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const live = await member.socket(wid);
		await live.next('hello');
		const root = await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'racine' });
		await owner.req('POST', `/api/w/${wid}/messages/${root.data.id}/thread`, { body: 'suite' });
		expect(await live.next('thread')).toMatchObject({ rootId: root.data.id, message: { body: 'suite' }, root: { thread: { count: 1 } } });
		live.ws.close();
	});
});
