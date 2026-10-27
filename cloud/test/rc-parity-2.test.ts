import { describe, expect, it } from 'vitest';

import type { Webhook, WebhookWithUrl } from '../shared/rc';
import type { Message, MessagePage } from '../shared/types';
import { Client, signup, workspaceWithMember } from './helpers';

const post = (client: Client, wid: string, cid: string, body: string) => client.req<Message>('POST', `/api/w/${wid}/channels/${cid}/messages`, { body });

const hookPath = (url: string) => new URL(url).pathname;

describe('transfert de message', () => {
	it('transfère avec un aperçu figé de l’original', async () => {
		const { owner, member, wid, general, announcements } = await workspaceWithMember();
		const sent = await post(member, wid, general.id, 'Livraison vendredi');
		const res = await owner.req<Message>('POST', `/api/w/${wid}/messages/${sent.data.id}/forward`, { channelId: announcements.id, comment: 'À noter' });
		expect(res.status).toBe(200);
		expect(res.data).toMatchObject({ channelId: announcements.id, userId: owner.user.id, body: 'À noter' });
		expect(res.data.forward).toMatchObject({ id: sent.data.id, channelId: general.id, userId: member.user.id, body: 'Livraison vendredi', files: 0 });
		const page = await member.req<MessagePage>('GET', `/api/w/${wid}/channels/${announcements.id}/messages`);
		expect(page.data.messages.at(-1)?.forward?.id).toBe(sent.data.id);
	});

	it('cite l’original quand on transfère un transfert sans ajout', async () => {
		const { owner, wid, general, announcements } = await workspaceWithMember();
		const sent = await post(owner, wid, general.id, 'Source');
		const first = await owner.req<Message>('POST', `/api/w/${wid}/messages/${sent.data.id}/forward`, { channelId: announcements.id });
		const second = await owner.req<Message>('POST', `/api/w/${wid}/messages/${first.data.id}/forward`, { channelId: general.id });
		expect(second.data.forward?.id).toBe(sent.data.id);
	});

	it('refuse sans droit d’écriture, hors espace ou message inconnu', async () => {
		const { owner, member, wid, general, announcements } = await workspaceWithMember();
		const sent = await post(owner, wid, general.id, 'Interne');
		expect((await member.req('POST', `/api/w/${wid}/messages/${sent.data.id}/forward`, { channelId: announcements.id })).status).toBe(403);
		expect((await member.req('POST', `/api/w/${wid}/messages/999999/forward`, { channelId: general.id })).status).toBe(404);
		expect((await member.req('POST', `/api/w/${wid}/messages/${sent.data.id}/forward`, { channelId: 'nope' })).status).toBe(404);
		expect((await member.req('POST', `/api/w/${wid}/messages/${sent.data.id}/forward`, {})).status).toBe(400);
		const outsider = await signup('Eve');
		expect((await outsider.req('POST', `/api/w/${wid}/messages/${sent.data.id}/forward`, { channelId: general.id })).status).toBe(404);
	});
});

describe('webhooks entrants', () => {
	it('crée, publie un message d’app et ne réexpose jamais le secret', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const created = await owner.req<WebhookWithUrl>('POST', `/api/w/${wid}/channels/${general.id}/webhooks`, { name: 'CI' });
		expect(created.status).toBe(201);
		expect(created.data.url).toMatch(new RegExp(`/api/hooks/${wid}/${created.data.id}/[\\w-]{20,}$`));
		const anon = new Client();
		const hit = await anon.req<{ ok: boolean; id: number }>('POST', hookPath(created.data.url), { text: 'Build vert', username: 'GitHub' });
		expect(hit.status).toBe(200);
		const page = await member.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.at(-1)).toMatchObject({ id: hit.data.id, userId: 'app:GitHub', body: 'Build vert' });
		const list = await owner.req<Webhook[]>('GET', `/api/w/${wid}/channels/${general.id}/webhooks`);
		expect(list.data).toHaveLength(1);
		expect(list.data[0]).not.toHaveProperty('url');
		expect(list.data[0]!.lastUsedAt).not.toBeNull();
		const defaulted = await anon.req('POST', hookPath(created.data.url), { text: 'Sans nom' });
		expect(defaulted.status).toBe(200);
		expect((await member.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`)).data.messages.at(-1)?.userId).toBe('app:CI');
	});

	it('rejette secret faux, charge invalide, rotation et suppression', async () => {
		const { owner, wid, general } = await workspaceWithMember();
		const created = await owner.req<WebhookWithUrl>('POST', `/api/w/${wid}/channels/${general.id}/webhooks`, { name: 'Alertes' });
		const anon = new Client();
		const path = hookPath(created.data.url);
		expect((await anon.req('POST', path.replace(/[^/]+$/, 'faux'), { text: 'x' })).status).toBe(404);
		expect((await anon.req('POST', path, { text: '  ' })).status).toBe(400);
		expect((await anon.req('POST', path, { message: 'x' })).status).toBe(400);
		expect((await anon.req('POST', path.replace(wid, 'inconnu'), { text: 'x' })).status).toBe(404);
		const rotated = await owner.req<WebhookWithUrl>('POST', `/api/w/${wid}/webhooks/${created.data.id}/rotate`);
		expect(rotated.status).toBe(200);
		expect((await anon.req('POST', path, { text: 'x' })).status).toBe(404);
		expect((await anon.req('POST', hookPath(rotated.data.url), { text: 'x' })).status).toBe(200);
		expect((await owner.req('DELETE', `/api/w/${wid}/webhooks/${created.data.id}`)).status).toBe(200);
		expect((await anon.req('POST', hookPath(rotated.data.url), { text: 'x' })).status).toBe(404);
	});

	it('réserve la gestion à MANAGE_COMMANDS', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		expect((await member.req('POST', `/api/w/${wid}/channels/${general.id}/webhooks`, { name: 'Pirate' })).status).toBe(403);
		expect((await member.req('GET', `/api/w/${wid}/channels/${general.id}/webhooks`)).status).toBe(403);
		const created = await owner.req<WebhookWithUrl>('POST', `/api/w/${wid}/channels/${general.id}/webhooks`, { name: 'CI' });
		expect((await member.req('POST', `/api/w/${wid}/webhooks/${created.data.id}/rotate`)).status).toBe(403);
		expect((await member.req('DELETE', `/api/w/${wid}/webhooks/${created.data.id}`)).status).toBe(403);
		expect((await owner.req('POST', `/api/w/${wid}/channels/${general.id}/webhooks`, { name: '  ' })).status).toBe(400);
		const outsider = await signup('Eve');
		expect((await outsider.req('GET', `/api/w/${wid}/channels/${general.id}/webhooks`)).status).toBe(404);
	});
});
