import { describe, expect, it } from 'vitest';

import type { Category } from '../shared/categories';
import { P } from '../shared/permissions';
import type { Channel } from '../shared/types';
import { workspaceWithMember, type Client } from './helpers';

const sees = async (client: Client, wid: string, id: string) => (await client.req<Channel[]>('GET', `/api/w/${wid}/channels`)).data.some((c) => c.id === id);

const categoriesOf = async (client: Client, wid: string) => (await client.req<Category[]>('GET', `/api/w/${wid}/categories`)).data;

describe('catégories', () => {
	it('range les salons de départ dans deux catégories', async () => {
		const { owner, wid, general, announcements } = await workspaceWithMember();
		const categories = await categoriesOf(owner, wid);
		expect(categories.map((c) => c.name)).toEqual(['Salons textuels', 'Salons vocaux']);
		expect(general).toMatchObject({ categoryId: categories[0]!.id, category: 'Salons textuels', synced: true });
		expect(announcements.synced).toBe(false);
	});

	it('réserve la gestion à MANAGE_CHANNELS', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const [text] = await categoriesOf(owner, wid);
		expect((await member.req('POST', `/api/w/${wid}/categories`, { name: 'Projets' })).status).toBe(403);
		expect((await member.req('PATCH', `/api/w/${wid}/categories/${text!.id}`, { name: 'x' })).status).toBe(403);
		expect((await member.req('DELETE', `/api/w/${wid}/categories/${text!.id}`)).status).toBe(403);
		expect((await member.req('GET', `/api/w/${wid}/categories/${text!.id}/overrides`)).status).toBe(403);
		expect((await member.req('PUT', `/api/w/${wid}/layout`, { categories: [], channels: [] })).status).toBe(403);
	});

	it('mélange texte et vocal et persiste l’ordre', async () => {
		const { owner, wid, general, announcements } = await workspaceWithMember();
		const initial = await categoriesOf(owner, wid);
		const project = await owner.req<Category>('POST', `/api/w/${wid}/categories`, { name: '  Projets ' });
		expect(project.status).toBe(201);
		expect(project.data.name).toBe('Projets');
		const voice = (await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'Réunion', kind: 'voice', categoryId: project.data.id })).data;
		expect(voice.categoryId).toBe(project.data.id);
		const layout = await owner.req('PUT', `/api/w/${wid}/layout`, {
			categories: [project.data.id, ...initial.map((c) => c.id)],
			channels: [
				{ id: voice.id, categoryId: project.data.id },
				{ id: announcements.id, categoryId: project.data.id },
				{ id: general.id, categoryId: null },
			],
		});
		expect(layout.status).toBe(200);
		const channels = (await owner.req<Channel[]>('GET', `/api/w/${wid}/channels`)).data;
		expect(channels[0]!.id).toBe(general.id);
		expect(channels.filter((c) => c.categoryId === project.data.id).map((c) => c.id)).toEqual([voice.id, announcements.id]);
		expect((await categoriesOf(owner, wid))[0]!.id).toBe(project.data.id);
	});

	it('refuse un ordre invalide et une catégorie inconnue', async () => {
		const { owner, wid, general } = await workspaceWithMember();
		const ids = (await categoriesOf(owner, wid)).map((c) => c.id);
		expect((await owner.req('PUT', `/api/w/${wid}/layout`, { categories: [ids[0]], channels: [] })).status).toBe(400);
		expect((await owner.req('PUT', `/api/w/${wid}/layout`, { categories: ids, channels: [{ id: general.id, categoryId: 'inconnue' }] })).status).toBe(400);
		expect((await owner.req('PUT', `/api/w/${wid}/layout`, { categories: ids, channels: [{ id: 'inconnu', categoryId: null }] })).status).toBe(400);
		expect((await owner.req('POST', `/api/w/${wid}/channels`, { name: 'perdu', categoryId: 'inconnue' })).status).toBe(404);
		expect((await owner.req('POST', `/api/w/${wid}/categories`, { name: '   ' })).status).toBe(400);
	});

	it('propage les permissions de catégorie aux salons synchronisés', async () => {
		const { owner, member, wid, general, announcements } = await workspaceWithMember();
		const [text] = await categoriesOf(owner, wid);
		const set = await owner.req('PUT', `/api/w/${wid}/categories/${text!.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } });
		expect(set.status).toBe(200);
		expect(await sees(member, wid, general.id)).toBe(false);
		expect(await sees(member, wid, announcements.id)).toBe(true);

		await owner.req('PUT', `/api/w/${wid}/channels/${general.id}/overrides`, { overrides: {} });
		expect(await sees(member, wid, general.id)).toBe(true);
		const synced = await owner.req<Channel>('POST', `/api/w/${wid}/channels/${general.id}/sync`);
		expect(synced.data.synced).toBe(true);
		expect(await sees(member, wid, general.id)).toBe(false);

		const created = await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'privé', categoryId: text!.id });
		expect(created.data.synced).toBe(true);
		expect(await sees(member, wid, created.data.id)).toBe(false);
	});

	it('applique une surcharge par membre après les grades', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const key = `@${member.user.id}`;
		await owner.req('PUT', `/api/w/${wid}/channels/${general.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL }, [key]: { allow: P.VIEW_CHANNEL, deny: 0 } } });
		expect(await sees(member, wid, general.id)).toBe(true);
		await owner.req('PUT', `/api/w/${wid}/channels/${general.id}/overrides`, { overrides: { [key]: { allow: 0, deny: P.SEND_MESSAGES } } });
		expect((await member.req('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'salut' })).status).toBe(403);
		const unknown = await owner.req('PUT', `/api/w/${wid}/channels/${general.id}/overrides`, { overrides: { [`@${crypto.randomUUID()}`]: { allow: 0, deny: 0 } } });
		expect(unknown.status).toBe(400);
	});

	it('renomme et supprime une catégorie sans toucher à ses salons', async () => {
		const { owner, wid, general } = await workspaceWithMember();
		const [text] = await categoriesOf(owner, wid);
		expect((await owner.req<Category>('PATCH', `/api/w/${wid}/categories/${text!.id}`, { name: 'Discussions' })).data.name).toBe('Discussions');
		expect((await owner.req<Channel[]>('GET', `/api/w/${wid}/channels`)).data.find((c) => c.id === general.id)?.category).toBe('Discussions');
		expect((await owner.req('DELETE', `/api/w/${wid}/categories/${text!.id}`)).status).toBe(200);
		const after = (await owner.req<Channel[]>('GET', `/api/w/${wid}/channels`)).data.find((c) => c.id === general.id);
		expect(after).toMatchObject({ categoryId: null, category: '' });
		expect((await owner.req('DELETE', `/api/w/${wid}/categories/${text!.id}`)).status).toBe(404);
	});
});
