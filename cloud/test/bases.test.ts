import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { CanvasMeta } from '../shared/canvas';
import type { CheckItem, Checklist, ListDetail, ListItem, ListItemDetail, ListRule, ListSavedView } from '../shared/lists';
import type { NotificationPage } from '../shared/notifications';
import { P } from '../shared/permissions';
import type { Channel } from '../shared/types';
import { sendDueSoon } from '../worker/lists-bases';
import { signup, workspaceWithMember } from './helpers';

const workerEnv = env as unknown as Env;

const parisDay = (at: number) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

async function base(template = 'project') {
	const ctx = await workspaceWithMember();
	const list = await ctx.owner.req<ListDetail>('POST', `/api/w/${ctx.wid}/lists`, { template });
	return { ...ctx, list: list.data, url: `/api/w/${ctx.wid}/lists/${list.data.id}` };
}

describe('bases', () => {
	it('crée les vues du modèle et enregistre filtres, tris et colonnes masquées', async () => {
		const { owner, member, list, url } = await base('roadmap');
		expect(list.views.map((v) => v.kind)).toEqual(['timeline', 'table']);
		expect(list.labels.map((l) => l.name)).toEqual(['Produit', 'Technique', 'Marketing']);

		const board = await member.req<ListSavedView>('POST', `${url}/views`, { kind: 'board', name: 'Par statut', config: { boardBy: 'status', filters: [{ field: 'labels', op: 'is', value: 'l1' }] } });
		expect(board.status).toBe(201);
		expect(board.data.config).toMatchObject({ boardBy: 'status', filters: [{ field: 'labels', op: 'is', value: 'l1' }], hidden: [], dateField: 'due' });
		expect((await member.req('POST', `${url}/views`, { kind: 'map' })).status).toBe(400);
		expect((await member.req('PATCH', `${url}/views/${board.data.id}`, { config: { filters: [{ field: 'x', op: 'like' }] } })).status).toBe(400);
		const saved = await member.req<ListSavedView>('PATCH', `${url}/views/${board.data.id}`, { config: { sort: { id: 'title', dir: -1 }, hidden: ['owner'] } });
		expect(saved.data.config).toMatchObject({ sort: { id: 'title', dir: -1 }, hidden: ['owner'], boardBy: 'status' });

		const views = (await owner.req<ListDetail>('GET', url)).data.views;
		expect(views.map((v) => v.name)).toEqual(['Chronologie', 'Tableau', 'Par statut']);
		for (const v of views.slice(1)) {
			expect((await owner.req('DELETE', `${url}/views/${v.id}`)).status).toBe(200);
		}
		expect((await owner.req('DELETE', `${url}/views/${views[0]!.id}`)).status).toBe(409);
	});

	it('valide dates, étiquettes, couverture et terminé', async () => {
		const { member, list, url } = await base();
		const item = await member.req<ListItem>('POST', `${url}/items`, { title: 'Maquette', labels: ['l1'], startDate: '2026-11-02', dueDate: '2026-11-06', cover: '#2563EB' });
		expect(item.status).toBe(201);
		expect(item.data).toMatchObject({ labels: ['l1'], startDate: '2026-11-02', dueDate: '2026-11-06', cover: '#2563eb', done: false, checks: { done: 0, total: 0 } });
		const path = `${url}/items/${item.data.id}`;
		expect((await member.req('PATCH', path, { startDate: '2026-11-09' })).status).toBe(400);
		expect((await member.req('PATCH', path, { labels: ['nope'] })).status).toBe(400);
		expect((await member.req('PATCH', path, { cover: 'file:inconnu' })).status).toBe(400);
		expect((await member.req('PATCH', path, { done: 'oui' })).status).toBe(400);
		const done = await member.req<ListItem>('PATCH', path, { done: true, dueDate: null, labels: [] });
		expect(done.data).toMatchObject({ done: true, dueDate: null, labels: [] });
		expect((await member.req('PATCH', url, { labels: [...list.labels, { id: 'l9', name: 'Urgent', color: '#c93636' }] })).status).toBe(200);
		expect((await member.req('PATCH', path, { labels: ['l9'] })).status).toBe(200);
		const detail = await member.req<ListItemDetail>('GET', path);
		expect(detail.data.activity[0]!.action).toBe('a modifié Étiquettes');
	});

	it('gère les checklists, la progression et l’attribution', async () => {
		const { owner, member, url, wid } = await base();
		const item = await owner.req<ListItem>('POST', `${url}/items`, { title: 'Lancement' });
		const path = `${url}/items/${item.data.id}`;
		const checklist = await owner.req<Checklist>('POST', `${path}/checklists`, { title: 'Avant la mise en ligne' });
		expect(checklist.status).toBe(201);
		const a = await owner.req<CheckItem>('POST', `${path}/checklists/${checklist.data.id}/checks`, { text: 'Relire les textes' });
		const b = await owner.req<CheckItem>('POST', `${path}/checklists/${checklist.data.id}/checks`, { text: 'Prévenir le support', assignee: member.user.id, due: '2026-11-04' });
		expect(b.data).toMatchObject({ assignee: member.user.id, due: '2026-11-04', done: false });
		const outsider = await signup('Zoé');
		expect((await owner.req('PATCH', `${path}/checks/${a.data.id}`, { assignee: outsider.user.id })).status).toBe(400);
		expect((await owner.req('POST', `${path}/checklists/${checklist.data.id}/checks`, { text: '  ' })).status).toBe(400);
		expect((await owner.req('PATCH', `${path}/checks/${a.data.id}`, { done: true })).status).toBe(200);

		const detail = await member.req<ListItemDetail>('GET', path);
		expect(detail.data.item.checks).toEqual({ done: 1, total: 2 });
		expect(detail.data.checklists[0]!.items.map((c) => c.text)).toEqual(['Relire les textes', 'Prévenir le support']);
		const page = await member.req<NotificationPage>('GET', `/api/w/${wid}/notifications`);
		expect(page.data.items.filter((n) => n.kind === 'list')).toHaveLength(1);

		expect((await owner.req('DELETE', `${path}/checklists/${checklist.data.id}`)).status).toBe(200);
		expect((await member.req<ListItemDetail>('GET', path)).data.item.checks).toEqual({ done: 0, total: 0 });
	});

	it('déclenche les automatisations une seule fois, sans boucle', async () => {
		const { owner, member, url, wid } = await base();
		const rules = await owner.req<ListRule[]>('GET', `${url}/rules`);
		expect(rules.data).toEqual([expect.objectContaining({ trigger: { kind: 'status', column: 'status', option: 's4' }, action: { kind: 'done' } })]);
		// s2 renvoie en s3, s3 renvoie en s2 : une passe, pas de ping-pong.
		await owner.req('POST', `${url}/rules`, { trigger: { kind: 'status', column: 'status', option: 's2' }, action: { kind: 'move', column: 'status', option: 's3' } });
		await owner.req('POST', `${url}/rules`, { trigger: { kind: 'status', column: 'status', option: 's3' }, action: { kind: 'move', column: 'status', option: 's2' } });
		await owner.req('POST', `${url}/rules`, { trigger: { kind: 'status', column: 'status', option: 's2' }, action: { kind: 'label', label: 'l2' } });
		await owner.req('POST', `${url}/rules`, { trigger: { kind: 'status', column: 'status', option: 's4' }, action: { kind: 'notify', user: null } });
		expect((await owner.req('POST', `${url}/rules`, { trigger: { kind: 'status', column: 'status', option: 'zz' }, action: { kind: 'done' } })).status).toBe(400);
		expect((await owner.req('POST', `${url}/rules`, { trigger: { kind: 'due_soon' }, action: { kind: 'done' } })).status).toBe(400);

		const item = await member.req<ListItem>('POST', `${url}/items`, { title: 'Recette', values: { owner: member.user.id } });
		const moved = await member.req<ListItem>('PATCH', `${url}/items/${item.data.id}`, { values: { status: 's2' } });
		expect(moved.data.values.status).toBe('s3');
		expect(moved.data.labels).toEqual(['l2']);
		const finished = await owner.req<ListItem>('PATCH', `${url}/items/${item.data.id}`, { values: { status: 's4' } });
		expect(finished.data.done).toBe(true);
		// Même statut renvoyé : rien ne se redéclenche.
		await owner.req('PATCH', `${url}/items/${item.data.id}`, { done: false, values: { status: 's4' } });
		expect((await owner.req<ListItemDetail>('GET', `${url}/items/${item.data.id}`)).data.item.done).toBe(false);

		const page = await member.req<NotificationPage>('GET', `/api/w/${wid}/notifications`);
		expect(page.data.items.filter((n) => n.title.startsWith('Automatisation'))).toHaveLength(1);
		const rule = rules.data[0]!;
		expect((await owner.req('PATCH', `${url}/rules/${rule.id}`, { enabled: false })).status).toBe(200);
		expect((await member.req('DELETE', `${url}/rules/${rule.id}`)).status).toBe(200);
	});

	it('notifie la veille de l’échéance, une seule fois', async () => {
		const { owner, member, url, wid } = await base('blank');
		expect((await owner.req('POST', `${url}/rules`, { trigger: { kind: 'due_soon' }, action: { kind: 'notify', user: member.user.id } })).status).toBe(201);
		const now = Date.now();
		await owner.req('POST', `${url}/items`, { title: 'Envoyer le devis', dueDate: parisDay(now + 86_400_000) });
		await owner.req('POST', `${url}/items`, { title: 'Plus tard', dueDate: parisDay(now + 5 * 86_400_000) });
		await owner.req('POST', `${url}/items`, { title: 'Déjà fait', dueDate: parisDay(now + 86_400_000), done: true });
		expect(await sendDueSoon(workerEnv, now)).toBe(1);
		expect(await sendDueSoon(workerEnv, now)).toBe(0);
		const page = await member.req<NotificationPage>('GET', `/api/w/${wid}/notifications`);
		expect(page.data.items.filter((n) => n.title === 'Échéance demain').map((n) => n.body)).toEqual(['Envoyer le devis · Nouveau suivi']);
	});

	it('ouvre le document d’un élément avec les droits de la base', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const secret = await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'direction' });
		await owner.req('PUT', `/api/w/${wid}/channels/${secret.data.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } });
		const hidden = await owner.req<ListDetail>('POST', `/api/w/${wid}/lists`, { title: 'Budget', channelId: secret.data.id });
		const open = await owner.req<ListDetail>('POST', `/api/w/${wid}/lists`, { title: 'Général', channelId: general.id });
		const a = await owner.req<ListItem>('POST', `/api/w/${wid}/lists/${hidden.data.id}/items`, { title: 'Salaires' });
		const b = await owner.req<ListItem>('POST', `/api/w/${wid}/lists/${open.data.id}/items`, { title: 'Offsite' });

		const doc = await owner.req<CanvasMeta>('POST', `/api/w/${wid}/lists/${hidden.data.id}/items/${a.data.id}/page`);
		expect(doc.status).toBe(200);
		expect(doc.data).toMatchObject({ title: 'Salaires', channelId: secret.data.id, access: 'write' });
		const again = await owner.req<CanvasMeta>('POST', `/api/w/${wid}/lists/${hidden.data.id}/items/${a.data.id}/page`);
		expect(again.data.id).toBe(doc.data.id);
		expect((await owner.req<ListItem[]>('GET', `/api/w/${wid}/lists/${hidden.data.id}`)).data).toMatchObject({ items: [expect.objectContaining({ pageId: doc.data.id })] });
		expect((await member.req('POST', `/api/w/${wid}/lists/${hidden.data.id}/items/${a.data.id}/page`)).status).toBe(404);
		expect((await member.req('GET', `/api/w/${wid}/lists/${hidden.data.id}/items/${a.data.id}/page/ws`)).status).toBe(404);
		// Hors de la liste des canevas : pas de fuite par la page « Canevas ».
		expect((await member.req<CanvasMeta[]>('GET', `/api/w/${wid}/canvases`)).data.map((c) => c.id)).not.toContain(doc.data.id);

		expect((await member.req<CanvasMeta>('POST', `/api/w/${wid}/lists/${open.data.id}/items/${b.data.id}/page`)).data.access).toBe('write');
		expect((await member.req('POST', `/api/w/${wid}/lists/${hidden.data.id}/views`, { kind: 'board' })).status).toBe(404);
		expect((await member.req('POST', `/api/w/${wid}/lists/${hidden.data.id}/items/${a.data.id}/checklists`, { title: 'x' })).status).toBe(404);
		expect((await member.req('GET', `/api/w/${wid}/lists/${hidden.data.id}/rules`)).status).toBe(404);
	});

	it('stocke les pièces jointes et en fait une couverture', async () => {
		const { owner, member, url } = await base();
		const item = await owner.req<ListItem>('POST', `${url}/items`, { title: 'Visuel' });
		const path = `${url}/items/${item.data.id}`;
		const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
		const up = await owner.req<{ id: string; url: string; name: string }>('POST', `${path}/files`, png.buffer, { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('maquette.png') });
		expect(up.status).toBe(201);
		expect(up.data.name).toBe('maquette.png');
		expect((await member.req<ListItem>('PATCH', path, { cover: `file:${up.data.id}` })).data).toMatchObject({ cover: `file:${up.data.id}`, attachments: 1 });
		const got = await member.req<string>('GET', up.data.url.replace(/^\/api/, '/api'));
		expect(got.status).toBe(200);
		expect((await owner.req('DELETE', `${path}/files/${up.data.id}`)).status).toBe(200);
		expect((await owner.req<ListItemDetail>('GET', path)).data.item).toMatchObject({ cover: null, attachments: 0 });
	});
});
