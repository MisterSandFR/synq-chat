import { describe, expect, it } from 'vitest';

import type { ListDetail, ListItem, ListItemDetail, ListSummary } from '../shared/lists';
import type { NotificationPage } from '../shared/notifications';
import { P } from '../shared/permissions';
import type { Channel } from '../shared/types';
import { signup, workspaceWithMember } from './helpers';

const create = async (client: Awaited<ReturnType<typeof signup>>, wid: string, body: Record<string, unknown>) => client.req<ListDetail>('POST', `/api/w/${wid}/lists`, body);

describe('listes', () => {
	it('crée depuis un modèle, valide les valeurs typées et garde l’ordre', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const list = await create(owner, wid, { template: 'project' });
		expect(list.status).toBe(201);
		expect(list.data.title).toBe('Suivi de projet');
		expect(list.data.columns.map((c) => c.type)).toEqual(['status', 'person', 'date', 'priority']);
		const base = `/api/w/${wid}/lists/${list.data.id}`;

		const a = await member.req<ListItem>('POST', `${base}/items`, { title: 'Maquette', values: { status: 's2', due: '2026-11-05', priority: 'high' } });
		expect(a.status).toBe(201);
		expect(a.data.values).toEqual({ status: 's2', due: '2026-11-05', priority: 'high' });
		for (const values of [{ status: 'nope' }, { due: '05/11/2026' }, { priority: 'max' }, { owner: crypto.randomUUID() }, { unknown: 'x' }]) {
			expect((await member.req('POST', `${base}/items`, { title: 'Faux', values })).status).toBe(400);
		}
		const outsider = await signup('Chloé');
		expect((await member.req('PATCH', `${base}/items/${a.data.id}`, { values: { owner: outsider.user.id } })).status).toBe(400);

		// Colonnes ajoutées : case à cocher, nombre et lien validés par type.
		const columns = [...list.data.columns, { id: 'done', name: 'Fait', type: 'checkbox' }, { id: 'cost', name: 'Coût', type: 'number' }, { id: 'url', name: 'Lien', type: 'link' }];
		expect((await owner.req('PATCH', base, { columns })).status).toBe(200);
		expect((await member.req('PATCH', `${base}/items/${a.data.id}`, { values: { done: 'oui' } })).status).toBe(400);
		expect((await member.req('PATCH', `${base}/items/${a.data.id}`, { values: { cost: '12' } })).status).toBe(400);
		expect((await member.req('PATCH', `${base}/items/${a.data.id}`, { values: { url: 'javascript:alert(1)' } })).status).toBe(400);
		const ok = await member.req<ListItem>('PATCH', `${base}/items/${a.data.id}`, { values: { done: true, cost: 12.5, url: 'https://synq.test/a', priority: null } });
		expect(ok.status).toBe(200);
		expect(ok.data.values).toEqual({ status: 's2', due: '2026-11-05', done: true, cost: 12.5, url: 'https://synq.test/a' });
		expect((await owner.req('PATCH', base, { columns: [{ id: 'x', name: '', type: 'text' }] })).status).toBe(400);
		expect((await owner.req('PATCH', base, { columns: [{ id: 'x', name: 'X', type: 'formula' }] })).status).toBe(400);

		const b = await member.req<ListItem>('POST', `${base}/items`, { title: 'Recette' });
		const c = await member.req<ListItem>('POST', `${base}/items`, { title: 'Lancement' });
		expect(c.data.position).toBeGreaterThan(b.data.position);
		expect((await member.req('PATCH', `${base}/items/${c.data.id}`, { position: (a.data.position + b.data.position) / 2 })).status).toBe(200);
		const after = await member.req<ListDetail>('GET', base);
		expect(after.data.items.map((i) => i.title)).toEqual(['Maquette', 'Lancement', 'Recette']);
	});

	it('commente un élément et garde un historique simple', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const list = await create(owner, wid, { template: 'bugs', title: 'Bugs web' });
		const base = `/api/w/${wid}/lists/${list.data.id}`;
		const item = await owner.req<ListItem>('POST', `${base}/items`, { title: 'Crash au login' });
		expect((await member.req('POST', `${base}/items/${item.data.id}/comments`, { body: '  ' })).status).toBe(400);
		expect((await member.req('POST', `${base}/items/${item.data.id}/comments`, { body: 'Je regarde.' })).status).toBe(201);
		await owner.req('PATCH', `${base}/items/${item.data.id}`, { values: { status: 's3' } });
		const view = await owner.req<ListItemDetail>('GET', `${base}/items/${item.data.id}`);
		expect(view.data.comments).toEqual([expect.objectContaining({ userId: member.user.id, body: 'Je regarde.' })]);
		expect(view.data.activity.map((a) => a.action)).toEqual(['a modifié Statut', 'a commenté', 'a créé l’élément']);
		expect(view.data.item.comments).toBe(1);

		const csv = await owner.req<string>('GET', `${base}/export`);
		expect(csv.status).toBe(200);
		expect(csv.data).toContain('Titre,Statut,Priorité,Assigné à,Lien,Signalé le,Description');
		expect(csv.data).toContain('Crash au login,En cours');
	});

	it('limite la suppression au créateur ou à MANAGE_CHANNELS', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const mine = await create(member, wid, { title: 'Mes tâches' });
		const theirs = await create(owner, wid, { title: 'Équipe' });
		expect(theirs.data.canDelete).toBe(true);
		const seen = await member.req<ListDetail>('GET', `/api/w/${wid}/lists/${theirs.data.id}`);
		expect(seen.data).toMatchObject({ canEdit: true, canDelete: false });
		expect((await member.req('DELETE', `/api/w/${wid}/lists/${theirs.data.id}`)).status).toBe(403);
		expect((await owner.req('DELETE', `/api/w/${wid}/lists/${mine.data.id}`)).status).toBe(200);
		expect((await member.req('DELETE', `/api/w/${wid}/lists/${theirs.data.id}`)).status).toBe(403);
		expect((await owner.req('DELETE', `/api/w/${wid}/lists/${theirs.data.id}`)).status).toBe(200);
		expect((await owner.req<ListSummary[]>('GET', `/api/w/${wid}/lists`)).data).toEqual([]);
	});

	it('cache la liste d’un salon privé aux autres membres', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const secret = await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'direction' });
		expect((await owner.req('PUT', `/api/w/${wid}/channels/${secret.data.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } })).status).toBe(200);
		const hidden = await create(owner, wid, { title: 'Budget', channelId: secret.data.id });
		expect(hidden.status).toBe(201);
		await owner.req('PUT', `/api/w/${wid}/access/base/${hidden.data.id}`, { restricted: true, rules: [] });
		const open = await create(member, wid, { title: 'Général', channelId: general.id });
		expect(open.status).toBe(201);

		const listed = await member.req<ListSummary[]>('GET', `/api/w/${wid}/lists`);
		expect(listed.data.map((l) => l.title)).toEqual(['Général']);
		expect((await member.req<ListSummary[]>('GET', `/api/w/${wid}/lists?channel=${general.id}`)).data).toHaveLength(1);
		expect((await member.req('GET', `/api/w/${wid}/lists/${hidden.data.id}`)).status).toBe(404);
		expect((await member.req('POST', `/api/w/${wid}/lists/${hidden.data.id}/items`, { title: 'x' })).status).toBe(404);
		expect((await member.req('GET', `/api/w/${wid}/lists/${hidden.data.id}/export`)).status).toBe(404);
		expect((await create(member, wid, { title: 'Intrus', channelId: secret.data.id })).status).toBe(404);
		expect((await owner.req<ListSummary[]>('GET', `/api/w/${wid}/lists`)).data).toHaveLength(2);
		const outsider = await signup('Dan');
		expect((await outsider.req('GET', `/api/w/${wid}/lists`)).status).toBe(404);
	});

	it('notifie l’attribution et diffuse list_changed', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const list = await create(owner, wid, { template: 'requests' });
		const base = `/api/w/${wid}/lists/${list.data.id}`;
		const { ws, next } = await member.socket(wid);
		const item = await owner.req<ListItem>('POST', `${base}/items`, { title: 'Accès VPN', values: { owner: member.user.id } });
		expect(item.status).toBe(201);
		expect(await next('list_changed')).toEqual({ t: 'list_changed', listId: list.data.id, channelId: null });
		ws.close();

		const page = await member.req<NotificationPage>('GET', `/api/w/${wid}/notifications`);
		const hit = page.data.items.find((n) => n.kind === 'list');
		expect(hit).toMatchObject({ actorId: owner.user.id, body: 'Accès VPN · Demandes', link: `/w/${wid}/listes/${list.data.id}?element=${item.data.id}` });
		// Même personne réattribuée : pas de nouvelle notification.
		await owner.req('PATCH', `${base}/items/${item.data.id}`, { values: { owner: member.user.id, due: '2026-12-01' } });
		const again = await member.req<NotificationPage>('GET', `/api/w/${wid}/notifications`);
		expect(again.data.items.filter((n) => n.kind === 'list')).toHaveLength(1);
	});
});
