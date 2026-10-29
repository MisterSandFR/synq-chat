import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { AccessInfo, PageCategory } from '../shared/access';
import type { CanvasMeta } from '../shared/canvas';
import type { Favorite } from '../shared/favorites';
import type { ListDetail, ListSummary } from '../shared/lists';
import { ADMIN_GRADE, DEFAULT_GRADE, P } from '../shared/permissions';
import type { Actor, Grade } from '../shared/types';
import { baseLevel, categoryLevel, pageLevel, spaceLevel, type AccessData, type CategoryRow, type PageNode } from '../worker/access';
import { federatedSearch } from '../worker/ai-hub';
import { BASE, signup, workspaceWithMember, type Client } from './helpers';

async function setup() {
	const { owner, member, wid } = await workspaceWithMember();
	const carol = await signup('Carol');
	const code = await owner.req<{ code: string }>('POST', `/api/w/${wid}/invites`);
	expect((await carol.req('POST', `/api/invites/${code.data.code}/accept`)).status).toBe(200);
	const team = await owner.req<Grade>('POST', `/api/w/${wid}/grades`, { name: 'Équipe', color: '#2563eb', permissions: 0 });
	expect((await owner.req('PUT', `/api/w/${wid}/members/${member.user.id}/grades`, { gradeIds: [team.data.id] })).status).toBe(200);
	const page = async (client: Client, body: Record<string, unknown> = {}) => (await client.req<CanvasMeta>('POST', `/api/w/${wid}/canvases`, { title: 'Page', ...body })).data;
	const share = (client: Client, kind: string, id: string, body: unknown) => client.req<AccessInfo>('PUT', `/api/w/${wid}/access/${kind}/${id}`, body);
	const meta = (client: Client, id: string) => client.req<CanvasMeta>('GET', `/api/w/${wid}/canvases/${id}`);
	return { owner, member, carol, wid, team: team.data, page, share, meta };
}

const at = (who: Client) => `@${who.user.id}`;

async function closeCode(client: Client, wid: string, id: string, act: () => Promise<unknown>): Promise<number> {
	const res = await exports.default.fetch(new Request(`${BASE}/api/w/${wid}/canvases/${id}/ws`, { headers: { Upgrade: 'websocket', cookie: client.cookie } }));
	const ws = res.webSocket!;
	ws.accept();
	const closed = new Promise<number>((resolve) => ws.addEventListener('close', (event) => resolve(event.code)));
	await act();
	return Promise.race([closed, new Promise<number>((resolve) => setTimeout(() => resolve(0), 2000))]);
}

describe('évaluation des accès', () => {
	const actor = (over: Partial<Actor> = {}): Actor => ({ id: 'u1', name: 'U', owner: false, grades: [DEFAULT_GRADE], perms: 0, top: 0, ...over });
	const data = (rules: Array<[string, string, string]>, categories: CategoryRow[] = []): AccessData => {
		const map = new Map<string, AccessData['rules'] extends Map<string, infer R> ? R : never>();
		for (const [k, subject, level] of rules) {
			const [kind, id] = k.split(':') as ['page', string];
			map.set(k, [...(map.get(k) ?? []), { resource_kind: kind, resource_id: id, subject_id: subject, level: level as 'view' }]);
		}
		return { rules: map, categories: new Map(categories.map((c) => [c.id, c])) };
	};
	const node = (over: Partial<PageNode> = {}): PageNode => ({ id: 'p1', channel_id: null, created_by: 'other', parent_id: null, title: 'P', restricted: 0, ...over });

	it('sans règle : membre modifie, gestionnaire des salons gère, invité exclu', () => {
		expect(pageLevel(actor(), node(), new Map(), data([]))).toBe('edit');
		expect(pageLevel(actor({ perms: P.MANAGE_CHANNELS }), node(), new Map(), data([]))).toBe('manage');
		expect(spaceLevel(actor({ guest: true }))).toBeNull();
		expect(baseLevel(actor(), node(), data([]))).toBe('edit');
	});

	it('propriétaire, administrateur et créateur gèrent toujours', () => {
		const locked = node({ restricted: 1 });
		expect(pageLevel(actor({ owner: true }), locked, new Map(), data([]))).toBe('manage');
		expect(pageLevel(actor({ perms: P.ADMINISTRATOR }), locked, new Map(), data([]))).toBe('manage');
		expect(pageLevel(actor({ id: 'other' }), locked, new Map(), data([]))).toBe('manage');
		expect(pageLevel(actor(), locked, new Map(), data([]))).toBeNull();
	});

	it('niveau effectif = maximum des sujets portés', () => {
		const d = data([
			['page:p1', DEFAULT_GRADE, 'view'],
			['page:p1', 'team', 'comment'],
			['page:p1', '@u1', 'edit'],
		]);
		expect(pageLevel(actor({ grades: [DEFAULT_GRADE, 'team'] }), node(), new Map(), d)).toBe('edit');
		expect(pageLevel(actor({ id: 'u2', grades: [DEFAULT_GRADE, 'team'] }), node(), new Map(), d)).toBe('comment');
		expect(pageLevel(actor({ id: 'u3' }), node(), new Map(), d)).toBe('view');
		// Restreint : l'accès général ne compte plus.
		expect(pageLevel(actor({ id: 'u3' }), node({ restricted: 1 }), new Map(), d)).toBeNull();
	});

	it('invité : seulement par règle personne', () => {
		const guest = actor({ id: 'g', guest: true, grades: [DEFAULT_GRADE] });
		expect(pageLevel(guest, node(), new Map(), data([['page:p1', DEFAULT_GRADE, 'edit']]))).toBeNull();
		expect(pageLevel(guest, node(), new Map(), data([['page:p1', '@g', 'view']]))).toBe('view');
	});

	it('hérite de la parente, puis de la catégorie, puis de l’espace', () => {
		const category: CategoryRow = { id: 'c1', workspace_id: 'w', name: 'Équipe', icon: null, position: 1, restricted: 1, created_by: 'other', created_at: 0 };
		const root = node({ id: 'root', category_id: 'c1' });
		const child = node({ id: 'child', parent_id: 'root' });
		const byId = new Map([root, child].map((n) => [n.id, n]));
		expect(pageLevel(actor(), child, byId, data([], [category]))).toBeNull();
		expect(pageLevel(actor(), child, byId, data([['page_category:c1', '@u1', 'comment']], [category]))).toBe('comment');
		expect(pageLevel(actor(), child, byId, data([['page:root', '@u1', 'view']], [category]))).toBe('view');
		expect(pageLevel(actor(), child, byId, data([['page:child', DEFAULT_GRADE, 'edit']], [category]))).toBe('edit');
		expect(categoryLevel(actor(), { ...category, restricted: 0 }, data([]))).toBe('edit');
	});

	it('rattachement de salon pas encore repris : fermé sauf aux administrateurs', () => {
		const inChannel = node({ channel_id: 'c' });
		const d = data([['page:p1', DEFAULT_GRADE, 'edit']]);
		expect(pageLevel(actor(), inChannel, new Map(), d)).toBeNull();
		expect(pageLevel(actor({ id: 'other' }), inChannel, new Map(), d)).toBeNull();
		expect(baseLevel(actor(), inChannel, d)).toBeNull();
		expect(pageLevel(actor({ perms: P.ADMINISTRATOR }), inChannel, new Map(), d)).toBe('manage');
	});
});

describe('partage des pages', () => {
	it('sans règle : comportement d’avant, aperçu de l’héritage', async () => {
		const { owner, member, carol, wid, page, meta } = await setup();
		const p = await page(owner);
		expect((await meta(member, p.id)).data.level).toBe('edit');
		const info = await member.req<AccessInfo>('GET', `/api/w/${wid}/access/page/${p.id}`);
		expect(info.data).toMatchObject({ own: false, inherited: { kind: 'space' }, count: 3 });
		expect((await meta(carol, p.id)).status).toBe(200);
	});

	it('restreint sans règle : propriétaire et admins seulement', async () => {
		const { owner, member, carol, wid, page, share, meta } = await setup();
		const p = await page(owner);
		expect((await share(member, 'page', p.id, { restricted: true, rules: [] })).status).toBe(403);
		const res = await share(owner, 'page', p.id, { restricted: true, rules: [] });
		expect(res.data).toMatchObject({ own: true, restricted: true, count: 1 });
		expect((await meta(member, p.id)).status).toBe(404);
		expect((await member.req<CanvasMeta[]>('GET', `/api/w/${wid}/canvases`)).data.map((m) => m.id)).not.toContain(p.id);
		expect((await owner.req('PUT', `/api/w/${wid}/members/${carol.user.id}/grades`, { gradeIds: [ADMIN_GRADE] })).status).toBe(200);
		expect((await meta(carol, p.id)).data.level).toBe('manage');
	});

	it('grade et personne, niveaux appliqués aux routes', async () => {
		const { owner, member, carol, wid, team, page, share, meta } = await setup();
		const p = await page(owner);
		expect((await share(owner, 'page', p.id, { restricted: true, rules: [{ subjectId: team.id, level: 'view' }, { subjectId: at(member), level: 'comment' }] })).status).toBe(200);
		expect((await meta(member, p.id)).data).toMatchObject({ level: 'comment', access: 'read' });
		expect((await meta(carol, p.id)).status).toBe(404);
		expect((await member.req('PATCH', `/api/w/${wid}/canvases/${p.id}`, { title: 'Non' })).status).toBe(403);
		expect((await member.req('DELETE', `/api/w/${wid}/canvases/${p.id}`)).status).toBe(403);
		expect((await share(owner, 'page', p.id, { restricted: true, rules: [{ subjectId: team.id, level: 'view' }] })).status).toBe(200);
		expect((await member.req('POST', `/api/w/${wid}/canvases/${p.id}/comments`, { threadId: 't1', body: 'Salut' })).status).toBe(403);
		expect((await share(owner, 'page', p.id, { restricted: true, rules: [{ subjectId: 'inconnu', level: 'view' }] })).status).toBe(400);
		expect((await share(owner, 'page', p.id, { restricted: true, rules: [{ subjectId: at(member), level: 'tout' }] })).status).toBe(400);
		await share(owner, 'page', p.id, { restricted: false, rules: [{ subjectId: at(member), level: 'manage' }] });
		expect((await member.req('DELETE', `/api/w/${wid}/canvases/${p.id}`)).status).toBe(200);
	});

	it('héritage de la parente, rupture et retour', async () => {
		const { owner, member, carol, wid, page, share, meta } = await setup();
		const parent = await page(owner);
		const child = await page(owner, { parentId: parent.id });
		await share(owner, 'page', parent.id, { restricted: true, rules: [{ subjectId: at(member), level: 'view' }] });
		expect((await meta(member, child.id)).data.level).toBe('view');
		expect((await meta(carol, child.id)).status).toBe(404);
		const inherited = await owner.req<AccessInfo>('GET', `/api/w/${wid}/access/page/${child.id}`);
		expect(inherited.data).toMatchObject({ own: false, inherited: { kind: 'page', id: parent.id }, restricted: true, rules: [{ subjectId: at(member), level: 'view' }] });
		await share(owner, 'page', child.id, { restricted: false, rules: [{ subjectId: DEFAULT_GRADE, level: 'edit' }] });
		expect((await meta(carol, child.id)).data.level).toBe('edit');
		expect((await meta(carol, parent.id)).status).toBe(404);
		await share(owner, 'page', child.id, { inherit: true });
		expect((await meta(carol, child.id)).status).toBe(404);
	});

	it('révocation par changement de grade, de membre ou de grade supprimé', async () => {
		const { owner, member, wid, team, page, share } = await setup();
		const p = await page(owner);
		await share(owner, 'page', p.id, { restricted: true, rules: [{ subjectId: team.id, level: 'edit' }] });
		// Grade retiré : plus aucun accès.
		expect(await closeCode(member, wid, p.id, () => owner.req('PUT', `/api/w/${wid}/members/${member.user.id}/grades`, { gradeIds: [] }))).toBe(4403);
		// Grade rendu puis supprimé.
		await owner.req('PUT', `/api/w/${wid}/members/${member.user.id}/grades`, { gradeIds: [team.id] });
		expect(await closeCode(member, wid, p.id, () => owner.req('DELETE', `/api/w/${wid}/grades/${team.id}`))).toBe(4403);
	});

	it('révocation par grade : passage en lecture', async () => {
		const { owner, member, wid, team, page, share } = await setup();
		const p = await page(owner);
		const readers = (await owner.req<Grade>('POST', `/api/w/${wid}/grades`, { name: 'Lecteurs', color: '#16a34a', permissions: 0 })).data;
		await share(owner, 'page', p.id, { restricted: true, rules: [{ subjectId: team.id, level: 'edit' }, { subjectId: readers.id, level: 'view' }] });
		expect(await closeCode(member, wid, p.id, () => owner.req('PUT', `/api/w/${wid}/members/${member.user.id}/grades`, { gradeIds: [readers.id] }))).toBe(4409);
	});

	it('révocation par grade : document d’une carte', async () => {
		const { owner, member, wid, team, share } = await setup();
		const base = (await owner.req<ListDetail>('POST', `/api/w/${wid}/lists`, { title: 'Projet' })).data;
		const item = (await owner.req<{ id: string }>('POST', `/api/w/${wid}/lists/${base.id}/items`, { title: 'Carte' })).data;
		expect((await owner.req('POST', `/api/w/${wid}/lists/${base.id}/items/${item.id}/page`)).status).toBe(200);
		await share(owner, 'base', base.id, { restricted: true, rules: [{ subjectId: team.id, level: 'edit' }] });
		const res = await exports.default.fetch(new Request(`${BASE}/api/w/${wid}/lists/${base.id}/items/${item.id}/page/ws`, { headers: { Upgrade: 'websocket', cookie: member.cookie } }));
		const ws = res.webSocket!;
		ws.accept();
		const closed = new Promise<number>((resolve) => ws.addEventListener('close', (event) => resolve(event.code)));
		await owner.req('PUT', `/api/w/${wid}/members/${member.user.id}/grades`, { gradeIds: [] });
		expect(await Promise.race([closed, new Promise<number>((resolve) => setTimeout(() => resolve(0), 2000))])).toBe(4403);
	});

	it('révocation : socket fermé, ou relu en lecture', async () => {
		const { owner, member, carol, wid, page, share } = await setup();
		const p = await page(owner);
		expect(await closeCode(member, wid, p.id, () => share(owner, 'page', p.id, { restricted: true, rules: [{ subjectId: at(carol), level: 'edit' }] }))).toBe(4403);
		expect(await closeCode(carol, wid, p.id, () => share(owner, 'page', p.id, { restricted: true, rules: [{ subjectId: at(carol), level: 'view' }] }))).toBe(4409);
	});

	it('favoris et Synq IA filtrés', async () => {
		const { owner, member, wid, page, share } = await setup();
		const p = await page(owner, { title: 'Budget confidentiel' });
		expect((await member.req('PUT', `/api/w/${wid}/favorites`, { kind: 'canvas', refId: p.id, favorite: true })).status).toBe(200);
		expect((await federatedSearch(env as never, member.user.id, 'confidentiel', ['confidentiel'], null)).some((s) => s.id === p.id)).toBe(true);
		await share(owner, 'page', p.id, { restricted: true, rules: [] });
		expect((await member.req<Favorite[]>('GET', `/api/w/${wid}/favorites`)).data.some((f) => f.refId === p.id)).toBe(false);
		expect((await federatedSearch(env as never, member.user.id, 'confidentiel', ['confidentiel'], null)).some((s) => s.id === p.id)).toBe(false);
		expect((await member.req('PUT', `/api/w/${wid}/favorites`, { kind: 'canvas', refId: p.id, favorite: true })).status).toBe(404);
	});
});

describe('catégories de pages', () => {
	it('arbre en direct : pages, catégories et accès diffusés à l’espace', async () => {
		const { owner, member, wid, page, share } = await setup();
		const live = await member.socket(wid);
		const created = await owner.req<PageCategory>('POST', `/api/w/${wid}/page-categories`, { name: 'Produit' });
		expect(created.status).toBe(201);
		expect(await live.next('pages_changed')).toEqual({ t: 'pages_changed' });
		const p = await page(owner);
		await live.next('pages_changed');
		await owner.req('PATCH', `/api/w/${wid}/canvases/${p.id}`, { categoryId: created.data.id });
		await live.next('pages_changed');
		await share(owner, 'page_category', created.data.id, { restricted: true, rules: [] });
		await live.next('pages_changed');
		live.ws.close();
	});

	it('crée, range, restreint, renomme et supprime', async () => {
		const { owner, member, carol, wid, page, share, meta } = await setup();
		const created = await member.req<PageCategory>('POST', `/api/w/${wid}/page-categories`, { name: '  Produit  ' });
		expect(created.status).toBe(201);
		expect(created.data).toMatchObject({ name: 'Produit', level: 'manage' });
		const cat = created.data.id;
		expect((await member.req('POST', `/api/w/${wid}/page-categories`, { name: ' ' })).status).toBe(400);
		const p = await page(owner);
		expect((await owner.req<CanvasMeta>('PATCH', `/api/w/${wid}/canvases/${p.id}`, { categoryId: cat })).data.categoryId).toBe(cat);
		expect((await owner.req('PATCH', `/api/w/${wid}/canvases/${p.id}`, { categoryId: 'nope' })).status).toBe(404);
		expect((await carol.req('PATCH', `/api/w/${wid}/page-categories/${cat}`, { name: 'X' })).status).toBe(403);
		await share(member, 'page_category', cat, { restricted: true, rules: [] });
		expect((await meta(carol, p.id)).status).toBe(404);
		expect((await carol.req<PageCategory[]>('GET', `/api/w/${wid}/page-categories`)).data.map((c) => c.id)).not.toContain(cat);
		expect((await member.req<PageCategory>('PATCH', `/api/w/${wid}/page-categories/${cat}`, { name: 'Design', position: 5 })).data).toMatchObject({ name: 'Design', position: 5 });
		expect((await member.req('DELETE', `/api/w/${wid}/page-categories/${cat}`)).status).toBe(200);
		expect((await meta(carol, p.id)).data.categoryId).toBeNull();
	});
});

describe('partage des bases', () => {
	it('restreint une base, relue par la liste et le détail', async () => {
		const { owner, member, carol, wid, share } = await setup();
		const base = await owner.req<ListDetail>('POST', `/api/w/${wid}/lists`, { title: 'Roadmap', template: 'blank', channelId: null });
		expect(base.status).toBe(201);
		expect(base.data.level).toBe('manage');
		await share(owner, 'base', base.data.id, { restricted: true, rules: [{ subjectId: at(member), level: 'view' }] });
		const seen = await member.req<ListDetail>('GET', `/api/w/${wid}/lists/${base.data.id}`);
		expect(seen.data).toMatchObject({ level: 'view', canEdit: false, canDelete: false });
		expect((await member.req('PATCH', `/api/w/${wid}/lists/${base.data.id}`, { title: 'Non' })).status).toBe(403);
		expect((await share(member, 'base', base.data.id, { inherit: true })).status).toBe(403);
		expect((await carol.req('GET', `/api/w/${wid}/lists/${base.data.id}`)).status).toBe(404);
		expect((await carol.req<ListSummary[]>('GET', `/api/w/${wid}/lists`)).data.map((l) => l.id)).not.toContain(base.data.id);
	});
});
