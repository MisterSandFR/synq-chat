import { describe, expect, it } from 'vitest';

import type { FollowedThread } from '../shared/dm-threads';
import type { Favorite } from '../shared/favorites';
import type { Channel, Message } from '../shared/types';
import { signup, workspaceWithMember } from './helpers';

const refs = (list: Favorite[]) => list.map((f) => `${f.kind}:${f.refId}`);

async function setup() {
	const base = await workspaceWithMember();
	const general = (await base.owner.req<Channel[]>('GET', `/api/w/${base.wid}/channels`)).data.find((c) => c.kind === 'text')!;
	return { ...base, general };
}

describe('favoris', () => {
	it('ajoute, ordonne, retire et synchronise par personne', async () => {
		const { owner, member, wid, general } = await setup();
		const fav = (kind: string, refId: string, favorite = true) => owner.req('PUT', `/api/w/${wid}/favorites`, { kind, refId, favorite });
		const list = async () => (await owner.req<Favorite[]>('GET', `/api/w/${wid}/favorites`)).data;
		const other = (await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'projets', kind: 'text' })).data;
		const canvas = (await owner.req<{ id: string }>('POST', `/api/w/${wid}/canvases`, { title: 'Notes' })).data;
		const lst = (await owner.req<{ id: string }>('POST', `/api/w/${wid}/lists`, { title: 'Suivi' })).data;
		const socket = await owner.socket(wid);

		expect((await fav('channel', general.id)).status).toBe(200);
		expect((await socket.next('favorites')).t).toBe('favorites');
		await fav('canvas', canvas.id);
		await fav('list', lst.id);
		await fav('channel', other.id);
		expect((await fav('channel', general.id)).status).toBe(200);
		let got = await list();
		expect(refs(got)).toEqual([`channel:${general.id}`, `canvas:${canvas.id}`, `list:${lst.id}`, `channel:${other.id}`]);
		expect(got.find((f) => f.kind === 'canvas')?.title).toBe('Notes');
		expect(got.find((f) => f.kind === 'list')?.title).toBe('Suivi');

		const order = await owner.req('PUT', `/api/w/${wid}/favorites/order`, {
			items: [
				{ kind: 'channel', refId: other.id },
				{ kind: 'list', refId: lst.id },
			],
		});
		expect(order.status).toBe(200);
		expect(refs(await list())).toEqual([`channel:${other.id}`, `list:${lst.id}`, `channel:${general.id}`, `canvas:${canvas.id}`]);

		await fav('list', lst.id, false);
		expect(refs(await list())).toEqual([`channel:${other.id}`, `channel:${general.id}`, `canvas:${canvas.id}`]);
		expect((await member.req<Favorite[]>('GET', `/api/w/${wid}/favorites`)).data).toEqual([]);

		// Salon et canevas supprimés : absents de la section.
		expect((await owner.req('DELETE', `/api/w/${wid}/channels/${other.id}`)).status).toBe(200);
		expect((await owner.req('DELETE', `/api/w/${wid}/canvases/${canvas.id}`)).status).toBe(200);
		got = await list();
		expect(refs(got)).toEqual([`channel:${general.id}`]);
		socket.ws.close();
	});

	it('refuse ce que la personne ne voit pas', async () => {
		const { owner, member, wid } = await setup();
		const carol = await signup('Carol');
		const invite = await owner.req<{ code: string }>('POST', `/api/w/${wid}/invites`);
		expect((await carol.req('POST', `/api/invites/${invite.data.code}/accept`)).status).toBe(200);
		const dm = (await owner.req<{ id: string }>('POST', `/api/w/${wid}/dms`, { userIds: [member.user.id] })).data;

		expect((await member.req('PUT', `/api/w/${wid}/favorites`, { kind: 'channel', refId: dm.id, favorite: true })).status).toBe(200);
		expect((await carol.req('PUT', `/api/w/${wid}/favorites`, { kind: 'channel', refId: dm.id, favorite: true })).status).toBe(404);
		expect((await carol.req('PUT', `/api/w/${wid}/favorites`, { kind: 'canvas', refId: 'inconnu', favorite: true })).status).toBe(404);
		expect((await carol.req('PUT', `/api/w/${wid}/favorites`, { kind: 'list', refId: 'inconnu', favorite: true })).status).toBe(404);
		expect((await carol.req('PUT', `/api/w/${wid}/favorites`, { kind: 'mail', refId: dm.id, favorite: true })).status).toBe(400);
		expect((await carol.req('PUT', `/api/w/${wid}/favorites/order`, { items: [{ kind: 'channel' }] })).status).toBe(400);
		expect(refs((await member.req<Favorite[]>('GET', `/api/w/${wid}/favorites`)).data)).toEqual([`channel:${dm.id}`]);
	});
});

describe('fils façon Slack', () => {
	it('renvoie les 3 dernières réponses, le total et le compte non lu', async () => {
		const { owner, member, wid, general } = await setup();
		const unread = async (who: typeof owner) => (await who.req<{ count: number }>('GET', `/api/w/${wid}/threads/unread`)).data.count;
		const root = (await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'racine' })).data;
		const socket = await owner.socket(wid);
		for (const body of ['un', 'deux', 'trois', 'quatre']) {
			expect((await member.req('POST', `/api/w/${wid}/messages/${root.id}/thread`, { body })).status).toBe(200);
		}
		expect(await socket.next('threads_unread')).toMatchObject({ count: 1 });

		const [thread] = (await owner.req<FollowedThread[]>('GET', `/api/w/${wid}/threads`)).data;
		expect(thread!.total).toBe(4);
		expect(thread!.unread).toBe(4);
		expect(thread!.replies.map((m) => m.body)).toEqual(['deux', 'trois', 'quatre']);
		expect(await unread(owner)).toBe(1);
		expect(await unread(member)).toBe(0);

		expect((await owner.req('POST', `/api/w/${wid}/messages/${root.id}/thread/read`)).status).toBe(200);
		expect(await unread(owner)).toBe(0);

		await member.req('POST', `/api/w/${wid}/messages/${root.id}/thread`, { body: 'cinq' });
		expect(await unread(owner)).toBe(1);
		expect((await owner.req('PUT', `/api/w/${wid}/messages/${root.id}/follow`, { following: false })).status).toBe(200);
		expect(await unread(owner)).toBe(0);
		expect((await owner.req<FollowedThread[]>('GET', `/api/w/${wid}/threads`)).data).toHaveLength(0);
		socket.ws.close();
	});
});
