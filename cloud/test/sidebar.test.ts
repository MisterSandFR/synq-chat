import { describe, expect, it } from 'vitest';

import { bannerUrl, cleanChannelIcon, type Category } from '../shared/categories';
import type { Channel } from '../shared/types';
import { signup, workspaceWithMember } from './helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).buffer;

const categoriesOf = async (client: Awaited<ReturnType<typeof signup>>, wid: string) => (await client.req<Category[]>('GET', `/api/w/${wid}/categories`)).data;

describe('bannière de catégorie', () => {
	it('envoie, sert, remplace et retire la bannière', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const [text] = await categoriesOf(owner, wid);
		const sent = await owner.req<{ bannerKey: string }>('POST', `/api/w/${wid}/categories/${text!.id}/banner`, PNG, { 'content-type': 'image/png' });
		expect(sent.status).toBe(201);
		const listed = (await categoriesOf(member, wid)).find((k) => k.id === text!.id)!;
		expect(listed.bannerKey).toBe(sent.data.bannerKey);
		const first = bannerUrl(wid, listed)!;

		const got = await member.raw('GET', first);
		expect(got.status).toBe(200);
		expect(got.headers.get('content-type')).toBe('image/png');
		expect(got.headers.get('content-security-policy')).toContain('sandbox');
		expect(got.headers.get('x-content-type-options')).toBe('nosniff');
		expect((await got.arrayBuffer()).byteLength).toBe(PNG.byteLength);

		const replaced = await owner.req<{ bannerKey: string }>('POST', `/api/w/${wid}/categories/${text!.id}/banner`, PNG, { 'content-type': 'image/webp' });
		expect(replaced.status).toBe(201);
		expect(replaced.data.bannerKey).not.toBe(sent.data.bannerKey);
		expect((await owner.req('GET', first)).status).toBe(404);
		const second = bannerUrl(wid, { id: text!.id, bannerKey: replaced.data.bannerKey })!;
		expect((await owner.raw('GET', second)).status).toBe(200);

		expect((await owner.req('DELETE', `/api/w/${wid}/categories/${text!.id}/banner`)).status).toBe(200);
		expect((await owner.req('GET', second)).status).toBe(404);
		expect((await categoriesOf(owner, wid)).find((k) => k.id === text!.id)!.bannerKey).toBeNull();
	});

	it('refuse sans permission, mauvais type, taille ou catégorie', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const [text] = await categoriesOf(owner, wid);
		const path = `/api/w/${wid}/categories/${text!.id}/banner`;
		expect((await member.req('POST', path, PNG, { 'content-type': 'image/png' })).status).toBe(403);
		expect((await member.req('DELETE', path)).status).toBe(403);
		expect((await owner.req('POST', path, PNG, { 'content-type': 'image/gif' })).status).toBe(400);
		expect((await owner.req('POST', path, '<svg></svg>', { 'content-type': 'image/svg+xml' })).status).toBe(400);
		expect((await owner.req('POST', path, new ArrayBuffer(2 * 1024 * 1024 + 1), { 'content-type': 'image/png' })).status).toBe(413);
		expect((await owner.req('POST', `/api/w/${wid}/categories/inconnue/banner`, PNG, { 'content-type': 'image/png' })).status).toBe(404);
		expect((await categoriesOf(owner, wid)).every((k) => k.bannerKey === null)).toBe(true);

		const outsider = await signup('Eve');
		expect((await outsider.req('POST', path, PNG, { 'content-type': 'image/png' })).status).toBe(404);
	});

	it('supprime la bannière avec la catégorie', async () => {
		const { owner, wid } = await workspaceWithMember();
		const project = (await owner.req<Category>('POST', `/api/w/${wid}/categories`, { name: 'Projets' })).data;
		expect(project.bannerKey).toBeNull();
		const sent = await owner.req<{ bannerKey: string }>('POST', `/api/w/${wid}/categories/${project.id}/banner`, PNG, { 'content-type': 'image/jpeg' });
		const url = bannerUrl(wid, { id: project.id, bannerKey: sent.data.bannerKey })!;
		expect((await owner.raw('GET', url)).status).toBe(200);
		expect((await owner.req('DELETE', `/api/w/${wid}/categories/${project.id}`)).status).toBe(200);
		expect((await owner.req('GET', url)).status).toBe(404);
	});
});

describe('icône de salon', () => {
	it('valide le format', () => {
		expect(cleanChannelIcon('🎮')).toBe('🎮');
		expect(cleanChannelIcon(' 👨‍👩‍👧 ')).toBe('👨‍👩‍👧');
		expect(cleanChannelIcon('🇫🇷')).toBe('🇫🇷');
		expect(cleanChannelIcon('❤️')).toBe('❤️');
		expect(cleanChannelIcon(':party_parrot:')).toBe(':party_parrot:');
		expect(cleanChannelIcon('')).toBe('');
		for (const bad of ['a', 'ab', '😀😀', '🎮x', ':A:', ':a:', ':trop-long:', ':nom', 42, null]) {
			expect(cleanChannelIcon(bad)).toBeNull();
		}
	});

	it('change l’icône par l’édition du salon', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		expect(general.icon).toBe('');
		const path = `/api/w/${wid}/channels/${general.id}`;
		const set = await owner.req<Channel>('PATCH', path, { icon: '🎮' });
		expect(set.status).toBe(200);
		expect(set.data).toMatchObject({ icon: '🎮', name: general.name });
		expect((await member.req<Channel[]>('GET', `/api/w/${wid}/channels`)).data.find((c) => c.id === general.id)?.icon).toBe('🎮');
		expect((await owner.req<Channel>('PATCH', path, { icon: ':fete:' })).data.icon).toBe(':fete:');
		expect((await owner.req('PATCH', path, { icon: 'salut' })).status).toBe(400);
		expect((await owner.req('PATCH', path, { icon: '😀😀' })).status).toBe(400);
		expect((await owner.req<Channel>('PATCH', path, { topic: 'Sans toucher l’icône' })).data.icon).toBe(':fete:');
		expect((await owner.req<Channel>('PATCH', path, { icon: '' })).data.icon).toBe('');
		expect((await member.req('PATCH', path, { icon: '🎮' })).status).toBe(403);
	});
});
