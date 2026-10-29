import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { AccessInfo } from '../shared/access';
import type { CanvasMeta } from '../shared/canvas';
import { memberKey } from '../shared/categories';
import type { ChannelResources } from '../shared/channel-resources';
import type { DirectConversation } from '../shared/dm-threads';
import type { GuestInviteCreated } from '../shared/guests';
import type { ListDetail } from '../shared/lists';
import { P } from '../shared/permissions';
import type { Channel, Me } from '../shared/types';
import { decoupleWorkspace } from '../worker/channel-resources';
import { Client, signup, workspaceWithMember } from './helpers';

const page = async (client: Client, wid: string, title = '') => (await client.req<CanvasMeta>('POST', `/api/w/${wid}/canvases`, { title })).data;

// Ancien rattachement posé directement en D1, comme avant la migration.
async function attach(wid: string, table: 'canvases' | 'lists', id: string, channelId: string) {
	await env.DB.batch([
		env.DB.prepare(`UPDATE ${table} SET channel_id = ? WHERE id = ?`).bind(channelId, id),
		env.DB.prepare('UPDATE workspaces SET decoupled_at = NULL WHERE id = ?').bind(wid),
	]);
}

const rules = async (id: string) =>
	(await env.DB.prepare('SELECT subject_id, level FROM access_rules WHERE resource_id = ? ORDER BY subject_id').bind(id).all<{ subject_id: string; level: string }>()).results;

const row = (table: 'canvases' | 'lists', id: string) =>
	env.DB.prepare(`SELECT channel_id, restricted, title, created_by FROM ${table} WHERE id = ?`).bind(id).first<{ channel_id: string | null; restricted: number; title: string; created_by: string }>();

async function privateChannel(owner: Client, wid: string, allowed: string[]) {
	const secret = (await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'direction' })).data;
	const overrides = Object.fromEntries([['default', { allow: 0, deny: P.VIEW_CHANNEL }], ...allowed.map((id) => [memberKey(id), { allow: P.VIEW_CHANNEL, deny: 0 }])]);
	expect((await owner.req('PUT', `/api/w/${wid}/channels/${secret.id}/overrides`, { overrides })).status).toBe(200);
	return secret;
}

describe('reprise des pages et suivis de salon', () => {
	it('salon public : ressource d’espace sans règle, titre du salon, lien gardé', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const p = await page(owner, wid);
		await attach(wid, 'canvases', p.id, general.id);
		// Pas encore repris : fermé plutôt qu'ouvert à tout l'espace.
		expect((await member.req('GET', `/api/w/${wid}/canvases/${p.id}`)).status).toBe(404);
		expect(await decoupleWorkspace(env as never, wid)).toBe(1);
		expect(await row('canvases', p.id)).toMatchObject({ channel_id: null, restricted: 0, title: 'général' });
		expect(await rules(p.id)).toEqual([]);
		expect((await member.req<CanvasMeta>('GET', `/api/w/${wid}/canvases/${p.id}`)).data).toMatchObject({ level: 'edit', channelId: null });
		expect((await member.req<AccessInfo>('GET', `/api/w/${wid}/access/page/${p.id}`)).data.inherited).toEqual({ kind: 'space' });
		const linked = (await member.req<ChannelResources>('GET', `/api/w/${wid}/channels/${general.id}/resources`)).data;
		expect(linked.items).toMatchObject([{ kind: 'page', id: p.id, title: 'général', missing: 0 }]);
	});

	it('salon privé : seulement les mêmes personnes, créateur sans accès écarté, idempotente', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const carol = await signup('Carol');
		const code = await owner.req<{ code: string }>('POST', `/api/w/${wid}/invites`);
		expect((await carol.req('POST', `/api/invites/${code.data.code}/accept`)).status).toBe(200);
		const secret = await privateChannel(owner, wid, [member.user.id]);
		const p = await page(owner, wid, 'Budget');
		const theirs = await page(carol, wid, 'Note de Carol');
		const list = (await owner.req<ListDetail>('POST', `/api/w/${wid}/lists`, { title: 'Embauches', template: 'blank' })).data;
		await attach(wid, 'canvases', p.id, secret.id);
		// Sous-page de Carol sous la page du salon privé.
		await env.DB.prepare('UPDATE canvases SET parent_id = ? WHERE id = ?').bind(p.id, theirs.id).run();
		await attach(wid, 'lists', list.id, secret.id);
		expect(await decoupleWorkspace(env as never, wid)).toBe(2);

		expect(await row('canvases', p.id)).toMatchObject({ channel_id: null, restricted: 1, title: 'Budget' });
		expect(await rules(p.id)).toEqual([{ subject_id: memberKey(member.user.id), level: 'edit' }]);
		expect((await member.req('GET', `/api/w/${wid}/canvases/${p.id}`)).status).toBe(200);
		expect((await carol.req('GET', `/api/w/${wid}/canvases/${p.id}`)).status).toBe(404);
		// Carol ne voyait pas le salon : plus de passe-droit de créatrice.
		expect((await carol.req('GET', `/api/w/${wid}/canvases/${theirs.id}`)).status).toBe(404);
		expect((await row('canvases', theirs.id))!.created_by).toBe(owner.user.id);
		expect((await member.req('GET', `/api/w/${wid}/lists/${list.id}`)).status).toBe(200);
		expect((await carol.req('GET', `/api/w/${wid}/lists/${list.id}`)).status).toBe(404);

		const before = await rules(p.id);
		expect(await decoupleWorkspace(env as never, wid)).toBe(0);
		expect(await rules(p.id)).toEqual(before);
		const links = await env.DB.prepare('SELECT COUNT(*) AS n FROM channel_resources WHERE channel_id = ?').bind(secret.id).first<{ n: number }>();
		expect(links!.n).toBe(2);
		expect((await member.req<ChannelResources>('GET', `/api/w/${wid}/channels/${secret.id}/resources`)).data.items.map((r) => r.id).sort()).toEqual([p.id, list.id].sort());
		expect((await carol.req('GET', `/api/w/${wid}/channels/${secret.id}/resources`)).status).toBe(404);
	});

	it('groupe avec invité : règle personne pour l’invité et les participants', async () => {
		const { owner: alice, member: bob, wid } = await workspaceWithMember();
		const carol = await signup('Carol');
		const code = await alice.req<{ code: string }>('POST', `/api/w/${wid}/invites`);
		expect((await carol.req('POST', `/api/invites/${code.data.code}/accept`)).status).toBe(200);
		const dm = (await alice.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [bob.user.id], name: 'Projet' })).data;
		const invite = (await alice.req<GuestInviteCreated>('POST', `/api/w/${wid}/dms/${dm.id}/guests`, { email: 'presta@externe.fr' })).data;
		const guest = new Client();
		expect((await guest.req('POST', `/api/guest/${invite.link.split('/invite/guest/')[1]}`, { name: 'Gina' })).status).toBe(200);
		const me = (await guest.req<Me>('GET', '/api/me')).data;
		const p = await page(alice, wid, 'Cahier des charges');
		await attach(wid, 'canvases', p.id, dm.id);
		await decoupleWorkspace(env as never, wid);
		expect(await rules(p.id)).toEqual(
			[memberKey(bob.user.id), memberKey(me.user.id)].sort().map((subject_id) => ({ subject_id, level: 'edit' })),
		);
		expect((await row('canvases', p.id))!.restricted).toBe(1);
		expect((await bob.req('GET', `/api/w/${wid}/canvases/${p.id}`)).status).toBe(200);
		expect((await carol.req('GET', `/api/w/${wid}/canvases/${p.id}`)).status).toBe(404);
		expect((await bob.req<ChannelResources>('GET', `/api/w/${wid}/channels/${dm.id}/resources`)).data.items.map((r) => r.id)).toEqual([p.id]);
	});

	it('conversation privée : titre d’après les participants, jamais dm-<id>', async () => {
		const { owner: alice, member: bob, wid } = await workspaceWithMember();
		const carol = await signup('Carol');
		const code = await alice.req<{ code: string }>('POST', `/api/w/${wid}/invites`);
		expect((await carol.req('POST', `/api/invites/${code.data.code}/accept`)).status).toBe(200);
		const direct = (await alice.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [bob.user.id] })).data;
		const group = (await alice.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [bob.user.id, carol.user.id] })).data;
		const named = (await alice.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [bob.user.id, carol.user.id], name: 'Projet' })).data;
		const pages = [await page(alice, wid), await page(alice, wid), await page(alice, wid)];
		for (const [i, dm] of [direct, group, named].entries()) {
			await attach(wid, 'canvases', pages[i]!.id, dm.id);
		}
		await decoupleWorkspace(env as never, wid);
		const titles = await Promise.all(pages.map(async (p) => (await row('canvases', p.id))!.title));
		expect(titles.join(' | ')).toBe('Conversation avec Bob | Bob et Carol | Projet');
		expect(await rules(pages[0]!.id)).toEqual([{ subject_id: memberKey(bob.user.id), level: 'edit' }]);
		expect((await carol.req('GET', `/api/w/${wid}/canvases/${pages[0]!.id}`)).status).toBe(404);
	});
});

describe('liens salon ↔ pages et suivis', () => {
	it('lier et retirer ne changent aucun droit ; bandeau des membres sans accès', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const p = await page(owner, wid, 'Direction');
		expect((await owner.req('PUT', `/api/w/${wid}/access/page/${p.id}`, { restricted: true, rules: [] })).status).toBe(200);
		const linked = await owner.req<ChannelResources>('POST', `/api/w/${wid}/channels/${general.id}/resources`, { kind: 'page', id: p.id });
		expect(linked.status).toBe(201);
		expect(linked.data.items).toMatchObject([{ id: p.id, missing: 1, missingIds: [member.user.id], canRemove: true }]);
		expect((await member.req('GET', `/api/w/${wid}/canvases/${p.id}`)).status).toBe(404);
		expect((await member.req<ChannelResources>('GET', `/api/w/${wid}/channels/${general.id}/resources`)).data.items).toEqual([]);
		// Ce qu'on ne voit pas ne se lie pas.
		expect((await member.req('POST', `/api/w/${wid}/channels/${general.id}/resources`, { kind: 'page', id: p.id })).status).toBe(404);
		expect((await member.req('DELETE', `/api/w/${wid}/channels/${general.id}/resources/page/${p.id}`)).status).toBe(403);
		expect((await owner.req('DELETE', `/api/w/${wid}/channels/${general.id}/resources/page/${p.id}`)).status).toBe(200);
		expect((await owner.req<AccessInfo>('GET', `/api/w/${wid}/access/page/${p.id}`)).data).toMatchObject({ restricted: true, own: true });
		expect((await member.req('GET', `/api/w/${wid}/canvases/${p.id}`)).status).toBe(404);
	});

	it('crée une page et un suivi liés dans l’arbre, retirés par qui les a liés', async () => {
		const { member, wid, general, announcements } = await workspaceWithMember();
		const created = await member.req<CanvasMeta>('POST', `/api/w/${wid}/channels/${general.id}/canvas`, { title: 'Compte rendu' });
		expect(created.status).toBe(201);
		expect(created.data).toMatchObject({ channelId: null, parentId: null, title: 'Compte rendu', level: 'manage' });
		const list = await member.req<ListDetail>('POST', `/api/w/${wid}/lists`, { title: 'Actions', template: 'blank', channelId: general.id });
		expect(list.status).toBe(201);
		expect(list.data.channelId).toBeNull();
		const items = (await member.req<ChannelResources>('GET', `/api/w/${wid}/channels/${general.id}/resources`)).data.items;
		expect(items.map((r) => [r.kind, r.id])).toEqual([
			['page', created.data.id],
			['list', list.data.id],
		]);
		expect((await member.req('DELETE', `/api/w/${wid}/channels/${general.id}/resources/list/${list.data.id}`)).status).toBe(200);
		// Lecture seule dans le salon : pas de création liée.
		expect((await member.req('POST', `/api/w/${wid}/channels/${announcements.id}/canvas`, { title: 'X' })).status).toBe(403);
	});
});
