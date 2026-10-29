import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { CardLink, ListDetail, ListItem, ListItemDetail, ListSavedView } from '../shared/lists';
import type { NotificationPage } from '../shared/notifications';
import { P } from '../shared/permissions';
import type { Channel } from '../shared/types';
import { parisInstant, sendCardReminders } from '../worker/lists-cards';
import { workspaceWithMember } from './helpers';

const workerEnv = env as unknown as Env;

async function base(template = 'project') {
	const ctx = await workspaceWithMember();
	const list = await ctx.owner.req<ListDetail>('POST', `/api/w/${ctx.wid}/lists`, { template });
	return { ...ctx, list: list.data, url: `/api/w/${ctx.wid}/lists/${list.data.id}` };
}

const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;

describe('cartes riches', () => {
	it('valide la bannière : couleur, dégradé, image recadrée, type et taille', async () => {
		const { owner, list, url } = await base();
		const item = await owner.req<ListItem>('POST', `${url}/items`, { title: 'Lancement', cover: 'grad:lagon' });
		expect(item.status).toBe(201);
		expect(item.data).toMatchObject({ cover: 'grad:lagon', coverMode: 'top', coverY: 50 });
		const path = `${url}/items/${item.data.id}`;
		expect((await owner.req('PATCH', path, { cover: 'grad:inconnu' })).status).toBe(400);
		expect((await owner.req('PATCH', path, { coverMode: 'side' })).status).toBe(400);

		const image = await owner.req<{ id: string }>('POST', `${path}/files`, png(), { 'Content-Type': 'image/png', 'X-File-Name': 'visuel.png' });
		const full = await owner.req<ListItem>('PATCH', path, { cover: `file:${image.data.id}`, coverMode: 'full', coverY: 150 });
		expect(full.data).toMatchObject({ cover: `file:${image.data.id}`, coverMode: 'full', coverY: 100 });

		const text = await owner.req<{ id: string }>('POST', `${path}/files`, new TextEncoder().encode('notes').buffer, { 'Content-Type': 'text/plain', 'X-File-Name': 'notes.txt' });
		expect((await owner.req('PATCH', path, { cover: `file:${text.data.id}` })).status).toBe(400);
		const heavy = await owner.req<{ id: string }>('POST', `${path}/files`, new Uint8Array(10 * 1024 * 1024 + 1).buffer, { 'Content-Type': 'image/jpeg', 'X-File-Name': 'lourde.jpg' });
		expect(heavy.status).toBe(201);
		expect((await owner.req('PATCH', path, { cover: `file:${heavy.data.id}` })).status).toBe(413);

		const view = list.views.find((v) => v.kind === 'board')!;
		const face = await owner.req<ListSavedView>('PATCH', `${url}/views/${view.id}`, { config: { card: { cover: false, props: ['priority'] } } });
		expect(face.data.config.card).toMatchObject({ cover: false, labels: true, props: ['priority'] });
		expect((await owner.req('PATCH', `${url}/views/${view.id}`, { config: { card: { cover: 'non' } } })).status).toBe(400);
	});

	it('ajoute des propriétés et des champs natifs depuis le détail', async () => {
		const { owner, member, wid, list, url } = await base();
		const item = await owner.req<ListItem>('POST', `${url}/items`, { title: 'Maquette' });
		const path = `${url}/items/${item.data.id}`;
		expect((await owner.req('PATCH', url, { columns: [...list.columns, { id: 'pts', name: 'Points', type: 'number' }] })).status).toBe(200);
		expect((await owner.req<ListItem>('PATCH', path, { values: { pts: 3 } })).data.values.pts).toBe(3);

		const rich = await owner.req<ListItem>('PATCH', path, { icon: '🚀', members: [member.user!.id], dueDate: '2026-11-20', dueTime: '14:30', reminder: '1h', estimate: 5, estimateUnit: 'h' });
		expect(rich.status).toBe(200);
		expect(rich.data).toMatchObject({ icon: '🚀', members: [member.user!.id], dueDate: '2026-11-20', dueTime: '14:30', reminder: '1h', estimate: 5, estimateUnit: 'h' });
		expect((await owner.req('PATCH', path, { members: ['00000000-0000-0000-0000-000000000000'] })).status).toBe(400);
		expect((await owner.req('PATCH', path, { dueTime: '25:00' })).status).toBe(400);
		expect((await owner.req('PATCH', path, { estimate: -1 })).status).toBe(400);
		expect((await owner.req('PATCH', path, { icon: 'deux mots' })).status).toBe(400);
		const cleared = await owner.req<ListItem>('PATCH', path, { dueDate: null });
		expect(cleared.data).toMatchObject({ dueDate: null, dueTime: null, reminder: null });
		expect((await owner.req('PATCH', path, { reminder: '1d' })).status).toBe(400);

		const page = await member.req<NotificationPage>('GET', `/api/w/${wid}/notifications`);
		expect(page.data.items.some((n) => n.kind === 'list' && n.title.includes('attribué'))).toBe(true);
	});

	it('convertit un élément de checklist en carte', async () => {
		const { owner, member, url } = await base();
		const item = await owner.req<ListItem>('POST', `${url}/items`, { title: 'Refonte', values: { status: 's2' } });
		const path = `${url}/items/${item.data.id}`;
		const checklist = await owner.req<{ id: string }>('POST', `${path}/checklists`, { title: 'Étapes' });
		const check = await owner.req<{ id: string }>('POST', `${path}/checklists/${checklist.data.id}/checks`, { text: 'Écrire la spec', assignee: member.user!.id, due: '2026-11-12' });
		const card = await owner.req<ListItem>('POST', `${path}/checks/${check.data.id}/convert`);
		expect(card.status).toBe(201);
		expect(card.data).toMatchObject({ title: 'Écrire la spec', members: [member.user!.id], dueDate: '2026-11-12', values: { status: 's2' } });
		const detail = await owner.req<ListItemDetail>('GET', path);
		expect(detail.data.checklists[0]!.items).toHaveLength(0);
		expect(detail.data.activity[0]!.action).toBe('a converti « Écrire la spec » en carte');
		expect((await owner.req('POST', `${path}/checks/${check.data.id}/convert`)).status).toBe(404);
	});

	it('déplace une carte vers une autre base avec les droits des deux bases', async () => {
		const { owner, member, wid, url } = await base();
		const other = await owner.req<ListDetail>('POST', `/api/w/${wid}/lists`, { template: 'project', title: 'Sprint 2' });
		const secret = await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'direction' });
		await owner.req('PUT', `/api/w/${wid}/channels/${secret.data.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } });
		const hidden = await owner.req<ListDetail>('POST', `/api/w/${wid}/lists`, { title: 'Budget', channelId: secret.data.id });
		await owner.req('PUT', `/api/w/${wid}/access/base/${hidden.data.id}`, { restricted: true, rules: [] });

		const item = await member.req<ListItem>('POST', `${url}/items`, { title: 'Bannière', labels: ['l1'], values: { status: 's3' } });
		const path = `${url}/items/${item.data.id}`;
		const file = await member.req<{ id: string }>('POST', `${path}/files`, png(), { 'Content-Type': 'image/png', 'X-File-Name': 'a.png' });
		expect((await member.req('POST', `${path}/move`, { listId: hidden.data.id })).status).toBe(404);
		expect((await member.req('POST', `${path}/move`, { listId: 'inconnue' })).status).toBe(404);

		const moved = await member.req<ListItem>('POST', `${path}/move`, { listId: other.data.id });
		expect(moved.status).toBe(200);
		expect(moved.data).toMatchObject({ listId: other.data.id, labels: ['l1'], values: { status: 's3' }, attachments: 1 });
		const target = `/api/w/${wid}/lists/${other.data.id}`;
		expect((await member.req('GET', `${target}/files/${file.data.id}`)).status).toBe(200);
		expect((await member.req('GET', `${url}/files/${file.data.id}`)).status).toBe(404);
		expect((await member.req('GET', path)).status).toBe(404);
		const detail = await member.req<ListItemDetail>('GET', `${target}/items/${item.data.id}`);
		expect(detail.data.activity[0]!.changes).toEqual([{ field: 'Base', from: 'Suivi de projet', to: 'Sprint 2' }]);
	});

	it('archive, restaure et journalise ancienne et nouvelle valeur', async () => {
		const { owner, member, url } = await base();
		const item = await owner.req<ListItem>('POST', `${url}/items`, { title: 'Brouillon', values: { status: 's1' } });
		const path = `${url}/items/${item.data.id}`;
		await owner.req('PATCH', path, { title: 'Version finale', values: { status: 's2' }, members: [member.user!.id] });
		const changes = (await owner.req<ListItemDetail>('GET', path)).data.activity[0]!.changes;
		expect(changes).toEqual(
			expect.arrayContaining([
				{ field: 'Titre', from: 'Brouillon', to: 'Version finale' },
				{ field: 'Statut', from: 'À faire', to: 'En cours' },
				{ field: 'Membres', from: null, to: member.user!.id, kind: 'people' },
			]),
		);

		expect((await owner.req<ListItem>('PATCH', path, { archived: true })).data.archivedAt).toEqual(expect.any(Number));
		expect((await owner.req<ListDetail>('GET', url)).data.items.some((i) => i.id === item.data.id)).toBe(false);
		expect((await owner.req<ListItem[]>('GET', `${url}/archived`)).data.map((i) => i.id)).toEqual([item.data.id]);
		expect((await owner.req<ListItemDetail>('GET', path)).data.activity[0]!.action).toBe('a archivé la carte');
		await owner.req('PATCH', path, { archived: false });
		expect((await owner.req<ListDetail>('GET', url)).data.items.some((i) => i.id === item.data.id)).toBe(true);
		expect((await owner.req<ListItem[]>('GET', `${url}/archived`)).data).toHaveLength(0);
	});

	it('duplique, crée depuis un modèle, suit, lie, mentionne et réagit', async () => {
		const { owner, member, wid, url } = await base();
		const item = await owner.req<ListItem>('POST', `${url}/items`, { title: 'Onboarding' });
		const path = `${url}/items/${item.data.id}`;
		const checklist = await owner.req<{ id: string }>('POST', `${path}/checklists`, { title: 'Accueil' });
		const check = await owner.req<{ id: string }>('POST', `${path}/checklists/${checklist.data.id}/checks`, { text: 'Badge' });
		await owner.req('PATCH', `${path}/checks/${check.data.id}`, { done: true });

		const copy = await owner.req<ListItem>('POST', `${path}/duplicate`);
		expect(copy.data).toMatchObject({ title: 'Onboarding (copie)', checks: { done: 1, total: 1 }, template: false });
		await owner.req('PATCH', path, { template: true });
		const fromTemplate = await owner.req<ListItem>('POST', `${path}/duplicate`, { values: { status: 's2' } });
		expect(fromTemplate.data).toMatchObject({ title: 'Onboarding', template: false, checks: { done: 0, total: 1 }, values: { status: 's2' } });

		expect((await member.req('PUT', `${path}/follow`, { on: true })).status).toBe(200);
		expect((await member.req<ListItemDetail>('GET', path)).data.following).toBe(true);
		const comment = await owner.req<{ id: string }>('POST', `${path}/comments`, { body: '@Bob tu valides ?', mentions: [member.user!.id] });
		await owner.req('POST', `${path}/comments`, { body: 'Relance' });
		const notes = (await member.req<NotificationPage>('GET', `/api/w/${wid}/notifications`)).data.items.map((n) => n.title);
		expect(notes).toContain('Alice t’a mentionné dans un commentaire');
		expect(notes.filter((t) => t === 'Nouveau commentaire de Alice')).toHaveLength(1);

		expect((await member.req('POST', `${path}/comments/${comment.data.id}/reactions`, { emoji: '👍' })).status).toBe(200);
		expect((await owner.req<ListItemDetail>('GET', path)).data.comments[0]!.reactions).toEqual([{ emoji: '👍', users: [member.user!.id] }]);
		await member.req('POST', `${path}/comments/${comment.data.id}/reactions`, { emoji: '👍' });
		expect((await owner.req<ListItemDetail>('GET', path)).data.comments[0]!.reactions).toEqual([]);
		expect((await member.req('POST', `${path}/comments/${comment.data.id}/reactions`, { emoji: 'deux mots' })).status).toBe(400);

		const secret = await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'direction' });
		await owner.req('PUT', `/api/w/${wid}/channels/${secret.data.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } });
		const hidden = await owner.req<ListDetail>('POST', `/api/w/${wid}/lists`, { title: 'Budget', channelId: secret.data.id });
		await owner.req('PUT', `/api/w/${wid}/access/base/${hidden.data.id}`, { restricted: true, rules: [] });
		const salary = await owner.req<ListItem>('POST', `/api/w/${wid}/lists/${hidden.data.id}/items`, { title: 'Salaires' });
		expect((await member.req('POST', `${path}/links`, { kind: 'card', id: salary.data.id })).status).toBe(404);
		expect((await member.req('POST', `${path}/links`, { kind: 'card', id: item.data.id })).status).toBe(400);
		const linked = await member.req<CardLink[]>('POST', `${path}/links`, { kind: 'card', id: copy.data.id });
		expect(linked.status).toBe(201);
		expect(linked.data).toEqual([expect.objectContaining({ kind: 'card', id: copy.data.id, title: 'Onboarding (copie)', listId: item.data.listId })]);
		await owner.req('POST', `${path}/links`, { kind: 'card', id: salary.data.id });
		expect((await member.req<ListItemDetail>('GET', path)).data.links.map((l) => l.id)).toEqual([copy.data.id]);
		expect((await owner.req<ListItemDetail>('GET', path)).data.links).toHaveLength(2);
		const targets = await member.req<CardLink[]>('GET', `${path}/link-targets?q=sal`);
		expect(targets.data).toHaveLength(0);
	});

	it('envoie le rappel une heure avant l’échéance, une seule fois', async () => {
		const { owner, member, wid, url } = await base();
		const item = await owner.req<ListItem>('POST', `${url}/items`, { title: 'Démo client' });
		const path = `${url}/items/${item.data.id}`;
		const day = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now() + 86_400_000);
		await owner.req('PATCH', path, { members: [member.user!.id], dueDate: day, dueTime: '15:00', reminder: '1h' });
		const due = parisInstant(day, '15:00');
		expect(await sendCardReminders(workerEnv, due - 2 * 3_600_000)).toBe(0);
		expect(await sendCardReminders(workerEnv, due - 30 * 60_000)).toBeGreaterThanOrEqual(1);
		expect(await sendCardReminders(workerEnv, due - 20 * 60_000)).toBe(0);
		const page = await member.req<NotificationPage>('GET', `/api/w/${wid}/notifications`);
		expect(page.data.items.filter((n) => n.title === 'Rappel : échéance dans 1 heure')).toHaveLength(1);
	});
});
