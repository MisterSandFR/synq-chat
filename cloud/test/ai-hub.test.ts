import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AiConversation, AiConversationDetail, AiDone, AiTurnReply } from '../shared/ai-hub';
import type { CanvasMeta } from '../shared/canvas';
import type { ListDetail, ListSummary } from '../shared/lists';
import { P } from '../shared/permissions';
import type { Channel, Message } from '../shared/types';
import { aiRunner, type AiTask } from '../worker/ai';
import { pageUpdate, parseAbsence, parseCards, parsePage } from '../worker/ai-hub';
import { fold } from '../worker/mail/search';
import { Client, workspaceWithMember } from './helpers';

// Prompts gardés pour vérifier qu'aucune donnée hors droits ne part vers le modèle.
function mockAi(answer: (task: AiTask) => string) {
	const prompts: string[] = [];
	vi.spyOn(aiRunner, 'run').mockImplementation(async (_env, task) => {
		prompts.push(task.prompt);
		return answer(task);
	});
	return prompts;
}

afterEach(() => vi.restoreAllMocks());

const CARDS = '{"cards":[{"title":"Préparer la démo","description":"Alice, vendredi"},{"title":"Relancer le client","description":""}]}';

const reply = (task: AiTask) => (task.prompt.includes('"cards"') ? CARDS : 'Réponse [1].');

const turn = (client: Client, body: Record<string, unknown>) => client.req<AiTurnReply>('POST', '/api/ai/hub/turns', { timezone: 'Europe/Paris', ...body });

async function scene() {
	const ctx = await workspaceWithMember();
	const { owner, wid, general } = ctx;
	const secret = (await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'direction' })).data;
	expect((await owner.req('PUT', `/api/w/${wid}/channels/${secret.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } })).status).toBe(200);
	expect((await owner.req<Message>('POST', `/api/w/${wid}/channels/${secret.id}/messages`, { body: 'Budget licornes confidentiel' })).status).toBe(200);
	expect((await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'Livraison des licornes publiques lundi' })).status).toBe(200);
	const page = (await owner.req<CanvasMeta>('POST', `/api/w/${wid}/channels/${secret.id}/canvas`)).data;
	await env.DB.prepare("UPDATE canvases SET title = 'Stratégie', excerpt = 'Plan licornes secret' WHERE id = ?").bind(page.id).run();
	const now = Date.now();
	const text = 'Facture licornes privée';
	const k = crypto.randomUUID().slice(0, 8);
	const [box, thread, mid] = [`b${k}`, `t${k}`, `m${k}`];
	await env.DB.batch([
		env.DB.prepare("INSERT INTO mailboxes (id, owner_id, name, address, imap_host, smtp_host, username, secret, created_at) VALUES (?, ?, 'Perso', 'a@exemple.fr', 'imap.exemple.fr', 'smtp.exemple.fr', 'a', 'x', ?)").bind(box, owner.user.id, now),
		env.DB.prepare("INSERT INTO mail_threads (id, mailbox_id, subject, last_at, created_at) VALUES (?, ?, 'Facture', ?, ?)").bind(thread, box, now, now),
		env.DB.prepare("INSERT INTO mail_messages (id, mailbox_id, thread_id, message_id, direction, date, created_at) VALUES (?, ?, ?, ?, 'in', ?, ?)").bind(mid, box, thread, `<${mid}@exemple.fr>`, now, now),
		env.DB.prepare("INSERT INTO mail_search (mid, mailbox_id, text, norm) VALUES (?, ?, ?, ?)").bind(mid, box, text, fold(text)),
	]);
	return { ...ctx, secret, page, thread };
}

describe('Synq IA : recherche fédérée', () => {
	it('exclut salon privé, boîte non partagée et page d’un salon invisible', async () => {
		const prompts = mockAi(reply);
		const { member, owner, wid, thread } = await scene();
		const seen = await turn(member, { intent: 'ask', text: 'Que sait-on des licornes ?', context: { workspaceId: wid } });
		expect(seen.status).toBe(200);
		const sources = seen.data.turns[1]!.sources;
		expect(sources.map((s) => s.kind)).toEqual(['message']);
		expect(sources[0]!.snippet).toContain('publiques');
		expect(prompts.join('\n')).not.toMatch(/confidentiel|secret|Facture/);

		const all = await turn(owner, { intent: 'ask', text: 'Que sait-on des licornes ?', context: { workspaceId: wid } });
		const kinds = all.data.turns[1]!.sources.map((s) => s.kind);
		expect(kinds).toEqual(expect.arrayContaining(['message', 'page', 'mail']));
		expect(all.data.turns[1]!.sources.find((s) => s.kind === 'mail')!.href).toBe(`/mail?thread=${thread}`);
	});

	it('contexte invisible refusé, invité exclu', async () => {
		mockAi(reply);
		const { member, wid, secret, page, thread } = await scene();
		expect((await turn(member, { intent: 'summarize', context: { workspaceId: wid, channelId: secret.id } })).status).toBe(404);
		expect((await turn(member, { intent: 'summarize', context: { workspaceId: wid, pageId: page.id } })).status).toBe(404);
		expect((await turn(member, { intent: 'mail_reply', context: { mailThreadId: thread } })).status).toBe(404);
		expect((await new Client().req('POST', '/api/ai/hub/turns', { intent: 'ask', text: 'licornes' })).status).toBe(401);
	});
});

describe('Synq IA : actions', () => {
	it('cartes depuis un salon : aperçu, confirmation, base créée par la route existante', async () => {
		mockAi(reply);
		const { member, owner, wid, general } = await scene();
		const list = (await owner.req<ListSummary>('POST', `/api/w/${wid}/lists`, { title: 'Projet' })).data;
		const preview = await turn(member, { intent: 'cards', context: { workspaceId: wid, channelId: general.id }, listId: list.id });
		expect(preview.status).toBe(200);
		const assistant = preview.data.turns[1]!;
		expect(assistant.action).toMatchObject({ kind: 'cards', listId: list.id, cards: [{ title: 'Préparer la démo' }, { title: 'Relancer le client' }] });
		const done = await member.req<AiDone>('POST', '/api/ai/hub/execute', { conversationId: preview.data.conversation.id, turnId: assistant.id, action: assistant.action });
		expect(done.status).toBe(200);
		expect(done.data.href).toBe(`/w/${wid}/listes/${list.id}`);
		const detail = (await owner.req<ListDetail>('GET', `/api/w/${wid}/lists/${list.id}`)).data;
		expect(detail.items.map((i) => i.title).sort()).toEqual(['Préparer la démo', 'Relancer le client']);
		expect(detail.items.find((i) => i.title === 'Préparer la démo')!.description).toBe('Alice, vendredi');
		expect((await member.req('POST', '/api/ai/hub/execute', { conversationId: preview.data.conversation.id, turnId: assistant.id })).status).toBe(409);
	});

	it('actions refusées sans droit', async () => {
		mockAi(reply);
		const { member, owner, wid, general, secret } = await scene();
		const hidden = (await owner.req<ListSummary>('POST', `/api/w/${wid}/lists`, { title: 'Secrète', channelId: secret.id })).data;
		const open = (await owner.req<ListSummary>('POST', `/api/w/${wid}/lists`, { title: 'Ouverte' })).data;
		expect((await turn(member, { intent: 'cards', context: { workspaceId: wid, channelId: general.id }, listId: hidden.id })).status).toBe(404);
		// Aperçu légitime puis cible falsifiée : la route des bases refuse.
		const preview = await turn(member, { intent: 'cards', context: { workspaceId: wid, channelId: general.id }, listId: open.id });
		const assistant = preview.data.turns[1]!;
		const forged = { ...assistant.action, listId: hidden.id };
		expect((await member.req('POST', '/api/ai/hub/execute', { conversationId: preview.data.conversation.id, turnId: assistant.id, action: forged })).status).toBe(404);
		expect((await owner.req<ListDetail>('GET', `/api/w/${wid}/lists/${hidden.id}`)).data.items).toHaveLength(0);
		// Action d'une autre personne.
		expect((await owner.req('POST', '/api/ai/hub/execute', { conversationId: preview.data.conversation.id, turnId: assistant.id })).status).toBe(404);
	});

	it('absence posée pour soi seulement', async () => {
		mockAi(() => '{"kind":"remote","startDay":"2027-03-01","startHalf":"am","endDay":"2027-03-02","endHalf":"pm","note":"Chantier"}');
		const { member, owner } = await workspaceWithMember();
		const preview = await turn(member, { intent: 'absence', text: 'Télétravail lundi et mardi', context: {} });
		const assistant = preview.data.turns[1]!;
		expect(assistant.action).toMatchObject({ kind: 'absence', absence: { kind: 'remote', startDay: '2027-03-01', endDay: '2027-03-02' } });
		const forged = { kind: 'absence', absence: { ...(assistant.action as { absence: object }).absence, userId: owner.user.id } };
		expect((await member.req('POST', '/api/ai/hub/execute', { conversationId: preview.data.conversation.id, turnId: assistant.id, action: forged })).status).toBe(200);
		const { results } = await env.DB.prepare('SELECT user_id FROM absences WHERE note = ?').bind('Chantier').all<{ user_id: string }>();
		expect(results.map((r) => r.user_id)).toEqual([member.user.id]);
	});
});

describe('Synq IA : historique', () => {
	it('limité à soi : liste, reprise, suppression', async () => {
		mockAi(reply);
		const { member, owner, wid } = await scene();
		const first = await turn(member, { intent: 'ask', text: 'Où en sont les licornes ?', context: { workspaceId: wid } });
		const id = first.data.conversation.id;
		const again = await turn(member, { conversationId: id, intent: 'ask', text: 'Et la livraison ?', context: { workspaceId: wid } });
		expect(again.data.conversation.id).toBe(id);
		const detail = await member.req<AiConversationDetail>('GET', `/api/ai/hub/conversations/${id}`);
		expect(detail.data.turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
		expect((await member.req<AiConversation[]>('GET', '/api/ai/hub/conversations')).data.map((c) => c.id)).toEqual([id]);
		expect((await owner.req<AiConversation[]>('GET', '/api/ai/hub/conversations')).data).toEqual([]);
		expect((await owner.req('GET', `/api/ai/hub/conversations/${id}`)).status).toBe(404);
		expect((await turn(owner, { conversationId: id, intent: 'ask', text: 'Et alors ?', context: {} })).status).toBe(404);
		expect((await owner.req('DELETE', `/api/ai/hub/conversations/${id}`)).status).toBe(404);
		expect((await member.req('DELETE', `/api/ai/hub/conversations/${id}`)).status).toBe(200);
		expect((await member.req('GET', `/api/ai/hub/conversations/${id}`)).status).toBe(404);
	});
});

describe('Synq IA : analyse des réponses', () => {
	it('cartes, absence, page', () => {
		expect(parseCards(`Voici : ${CARDS}`)).toHaveLength(2);
		expect(parseCards('rien')).toEqual([]);
		expect(parseAbsence('{"kind":"x","startDay":"2027-01-04"}', 'u1')).toMatchObject({ kind: 'leave', startDay: '2027-01-04', endDay: '2027-01-04', userId: 'u1' });
		expect(parsePage('# Réunion\n## Décisions\n- Livrer')).toEqual({ title: 'Réunion', body: '## Décisions\n- Livrer' });
		expect(pageUpdate('## Décisions\n- Livrer\nFin').byteLength).toBeGreaterThan(10);
	});
});
