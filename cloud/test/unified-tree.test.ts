import { describe, expect, it } from 'vitest';

import type { AccessInfo, PageCategory } from '../shared/access';
import { channelPageTitle, type CanvasMeta } from '../shared/canvas';
import type { ListDetail, ListSummary } from '../shared/lists';
import { DEFAULT_GRADE, P } from '../shared/permissions';
import type { Actor } from '../shared/types';
import { baseLevel, type AccessData, type PageNode } from '../worker/access';
import { workspaceWithMember, type Client } from './helpers';

async function setup() {
	const ctx = await workspaceWithMember();
	const { wid } = ctx;
	const page = async (client: Client, body: Record<string, unknown> = {}) => (await client.req<CanvasMeta>('POST', `/api/w/${wid}/canvases`, { title: 'Page', ...body })).data;
	const tracker = (client: Client, body: Record<string, unknown> = {}) => client.req<ListDetail>('POST', `/api/w/${wid}/lists`, { template: 'project', title: 'Suivi', ...body });
	const trackers = async (client: Client) => (await client.req<ListSummary[]>('GET', `/api/w/${wid}/lists`)).data;
	const share = (client: Client, kind: string, id: string, body: unknown) => client.req<AccessInfo>('PUT', `/api/w/${wid}/access/${kind}/${id}`, body);
	return { ...ctx, page, tracker, trackers, share };
}

describe('arbre unique pages et suivis', () => {
	it('range un suivi sous une page, dans une catégorie, et le réordonne', async () => {
		const { owner, member, wid, page, tracker, trackers } = await setup();
		const parent = await page(owner);
		const cat = (await owner.req<PageCategory>('POST', `/api/w/${wid}/page-categories`, { name: 'Projets' })).data;
		const under = await tracker(owner, { parentId: parent.id });
		expect(under.status).toBe(201);
		expect(under.data).toMatchObject({ parentId: parent.id, categoryId: null, viewKind: 'board' });
		const inCat = await tracker(owner, { categoryId: cat.id });
		expect(inCat.data).toMatchObject({ parentId: null, categoryId: cat.id });
		const sibling = await page(owner, { parentId: parent.id });
		expect(sibling.parentId).toBe(parent.id);

		const listed = await trackers(member);
		expect(listed.find((b) => b.id === under.data.id)).toMatchObject({ parentId: parent.id, level: 'edit' });

		const moved = await member.req<ListDetail>('PATCH', `/api/w/${wid}/lists/${under.data.id}`, { parentId: null, categoryId: cat.id, position: 0.5 });
		expect(moved.status).toBe(200);
		expect(moved.data).toMatchObject({ parentId: null, categoryId: cat.id, position: 0.5 });
		expect((await owner.req<ListDetail>('PATCH', `/api/w/${wid}/lists/${inCat.data.id}`, { icon: '📋' })).data.icon).toBe('📋');

		// Catégorie supprimée : le suivi reste, sans catégorie.
		expect((await owner.req('DELETE', `/api/w/${wid}/page-categories/${cat.id}`)).status).toBe(200);
		expect((await trackers(owner)).find((b) => b.id === inCat.data.id)?.categoryId).toBeNull();
	});

	it('un suivi ne peut pas avoir d’enfant', async () => {
		const { owner, wid, page, tracker } = await setup();
		const base = (await tracker(owner)).data;
		expect((await owner.req('POST', `/api/w/${wid}/canvases`, { title: 'Sous', parentId: base.id })).status).toBe(404);
		const p = await page(owner);
		expect((await owner.req('PATCH', `/api/w/${wid}/canvases/${p.id}`, { parentId: base.id })).status).toBe(404);
		expect((await owner.req('PATCH', `/api/w/${wid}/lists/${base.id}`, { parentId: base.id })).status).toBe(404);
	});

	it('refuse une page parente inconnue ou en lecture seule', async () => {
		const { owner, member, wid, page, tracker, share } = await setup();
		const p = await page(owner);
		expect((await tracker(owner, { parentId: 'inconnue' })).status).toBe(404);
		expect((await share(owner, 'page', p.id, { restricted: false, rules: [{ subjectId: DEFAULT_GRADE, level: 'view' }] })).status).toBe(200);
		expect((await tracker(member, { parentId: p.id })).status).toBe(403);
		expect((await member.req('GET', `/api/w/${wid}/canvases/${p.id}`)).status).toBe(200);
	});

	it('hérite des accès de sa page parente puis de sa catégorie', async () => {
		const { owner, member, wid, page, tracker, trackers, share } = await setup();
		const p = await page(owner);
		const base = (await tracker(owner, { parentId: p.id })).data;
		expect((await member.req('GET', `/api/w/${wid}/lists/${base.id}`)).status).toBe(200);

		expect((await share(owner, 'page', p.id, { restricted: true, rules: [] })).status).toBe(200);
		expect((await member.req('GET', `/api/w/${wid}/lists/${base.id}`)).status).toBe(404);
		expect((await trackers(member)).some((b) => b.id === base.id)).toBe(false);
		const info = await owner.req<AccessInfo>('GET', `/api/w/${wid}/access/base/${base.id}`);
		expect(info.data).toMatchObject({ own: false, inherited: { kind: 'page', id: p.id }, restricted: true });

		// Accès propres : l'héritage est rompu.
		expect((await share(owner, 'base', base.id, { restricted: false, rules: [{ subjectId: `@${member.user.id}`, level: 'view' }] })).status).toBe(200);
		expect((await member.req<ListDetail>('GET', `/api/w/${wid}/lists/${base.id}`)).data).toMatchObject({ level: 'view', canEdit: false });

		const cat = (await owner.req<PageCategory>('POST', `/api/w/${wid}/page-categories`, { name: 'Direction' })).data;
		const inCat = (await tracker(owner, { categoryId: cat.id })).data;
		expect((await share(owner, 'page_category', cat.id, { restricted: true, rules: [] })).status).toBe(200);
		expect((await member.req('GET', `/api/w/${wid}/lists/${inCat.id}`)).status).toBe(404);
		expect((await owner.req<AccessInfo>('GET', `/api/w/${wid}/access/base/${inCat.id}`)).data.inherited).toMatchObject({ kind: 'page_category', id: cat.id });
	});

	it('un suivi de salon garde les droits du salon et reste dans son salon', async () => {
		const { owner, wid, general, page, tracker } = await setup();
		const p = await page(owner);
		const base = (await tracker(owner, { channelId: general.id, parentId: p.id })).data;
		expect(base).toMatchObject({ channelId: general.id, parentId: null });
		expect((await owner.req('PATCH', `/api/w/${wid}/lists/${base.id}`, { parentId: p.id })).status).toBe(400);
		expect((await owner.req<AccessInfo>('GET', `/api/w/${wid}/access/base/${base.id}`)).data.inherited).toMatchObject({ kind: 'channel', id: general.id });
	});

	it('évaluation : chaîne page parente, catégorie, espace', () => {
		const actor: Actor = { id: 'u1', name: 'U', owner: false, grades: [DEFAULT_GRADE], perms: 0, top: 0 };
		const data: AccessData = { rules: new Map(), categories: new Map(), grants: new Map() };
		const locked: PageNode = { id: 'p1', channel_id: null, created_by: 'other', parent_id: null, title: 'P', restricted: 1 };
		const pages = new Map([[locked.id, locked]]);
		const base = { id: 'b1', channel_id: null, created_by: 'other', restricted: 0, parent_id: 'p1', category_id: null };
		expect(baseLevel(actor, base, data, pages)).toBeNull();
		expect(baseLevel(actor, { ...base, parent_id: null }, data, pages)).toBe('edit');
		expect(baseLevel({ ...actor, perms: P.ADMINISTRATOR }, base, data, pages)).toBe('manage');
		expect(baseLevel({ ...actor, id: 'other' }, base, data, pages)).toBe('manage');
	});
});

describe('pages de salon', () => {
	it('sans titre propre, nommées d’après le salon', async () => {
		const { owner, wid, general } = await setup();
		const tab = await owner.req<CanvasMeta>('POST', `/api/w/${wid}/channels/${general.id}/canvas`);
		expect(tab.status).toBe(201);
		expect(tab.data.title).toBe('');
		expect(channelPageTitle(tab.data, general.name)).toBe('# général');
		expect(channelPageTitle({ ...tab.data, title: 'Canevas du salon' }, general.name)).toBe('# général');
		expect(channelPageTitle({ ...tab.data, title: 'Sans titre' }, general.name)).toBe('# général');
		expect(channelPageTitle({ ...tab.data, title: 'Notes' }, general.name)).toBe('Notes');
		expect(channelPageTitle({ title: '', channelId: null })).toBe('Sans titre');
	});
});
