import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AiAnswer, AiCatchup, AiParsedEvent } from '../shared/ai-chat';
import type { DirectConversation } from '../shared/dm-threads';
import type { GuestInviteCreated } from '../shared/guests';
import { P } from '../shared/permissions';
import type { Channel, Me, Message } from '../shared/types';
import { aiRunner, type AiTask } from '../worker/ai';
import { zonedTime } from '../worker/ai-chat';
import { Client, workspaceWithMember, type Reply } from './helpers';

// Chaque appel simulé renvoie `answer` ; les prompts reçus sont gardés pour vérifier ce qui part vers l'IA.
function mockAi(answer: string | ((task: AiTask) => string)) {
	const prompts: string[] = [];
	vi.spyOn(aiRunner, 'run').mockImplementation(async (_env, task) => {
		prompts.push(task.prompt);
		return typeof answer === 'string' ? answer : answer(task);
	});
	return prompts;
}

afterEach(() => vi.restoreAllMocks());

const post = (client: Client, wid: string, channelId: string, body: string) =>
	client.req<Message>('POST', `/api/w/${wid}/channels/${channelId}/messages`, { body }).then((r: Reply<Message>) => {
		expect(r.status).toBe(200);
		return r.data;
	});

async function withSecret() {
	const ctx = await workspaceWithMember();
	const { owner, wid } = ctx;
	const created = await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'direction' });
	expect(created.status).toBe(200);
	const secret = created.data;
	expect((await owner.req('PUT', `/api/w/${wid}/channels/${secret.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } })).status).toBe(200);
	const hidden = await post(owner, wid, secret.id, 'Budget confidentiel licornes 2027');
	return { ...ctx, secret, hidden };
}

async function withGuest() {
	const ctx = await withSecret();
	const { owner, member, wid } = ctx;
	const dm = await owner.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [member.user.id], name: 'Projet' });
	const created = await owner.req<GuestInviteCreated>('POST', `/api/w/${wid}/dms/${dm.data.id}/guests`, { email: 'presta@externe.fr' });
	const guest = new Client();
	expect((await guest.req('POST', `/api/guest/${created.data.link.split('/invite/guest/')[1]}`, { name: 'Gina' })).status).toBe(200);
	guest.user = (await guest.req<Me>('GET', '/api/me')).data.user;
	return { ...ctx, guest, dm: dm.data };
}

describe('IA dans le chat', () => {
	it('réécriture : session requise, texte borné', async () => {
		mockAi('Texte corrigé.');
		const { member } = await workspaceWithMember();
		expect((await new Client().req('POST', '/api/ai/rewrite', { action: 'corriger', text: 'tèxte' })).status).toBe(401);
		expect((await member.req('POST', '/api/ai/rewrite', { action: 'corriger', text: 'x'.repeat(8001) })).status).toBe(400);
		const done = await member.req<{ text: string }>('POST', '/api/ai/rewrite', { action: 'corriger', text: 'tèxte' });
		expect(done.status).toBe(200);
		expect(done.data.text).toBe('Texte corrigé.');
	});

	it('rattrapage : puces reliées aux messages non lus, références inconnues ignorées', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const first = await post(owner, wid, general.id, 'On livre vendredi');
		await post(owner, wid, general.id, `Qui relit la doc, <@${member.user.id}> ?`);
		const prompts = mockAi(`- Livraison vendredi [#${first.id}]\n- Point inventé [#999999]`);
		const res = await member.req<AiCatchup>('POST', `/api/w/${wid}/channels/${general.id}/ai/catchup`, { after: first.id - 1 });
		expect(res.status).toBe(200);
		expect(res.data.count).toBe(2);
		expect(res.data.items).toEqual([
			{ text: 'Livraison vendredi', messageId: first.id },
			{ text: 'Point inventé', messageId: null },
		]);
		expect(prompts[0]).toContain('@Bob');
		expect(prompts[0]).not.toContain('<@');
		const none = await member.req<AiCatchup>('POST', `/api/w/${wid}/channels/${general.id}/ai/catchup`, { after: 2 ** 40 });
		expect(none.data).toEqual({ items: [], count: 0 });
		expect(prompts).toHaveLength(1);
	});

	it('salon invisible : rattrapage, traduction, résumé et fil refusés', async () => {
		const prompts = mockAi('- fuite');
		const { member, wid, secret, hidden } = await withSecret();
		expect((await member.req('POST', `/api/w/${wid}/channels/${secret.id}/ai/catchup`, {})).status).toBe(404);
		for (const action of ['translate', 'summary', 'reply', 'thread-summary']) {
			expect((await member.req('POST', `/api/w/${wid}/messages/${hidden.id}/ai/${action}`, {})).status).toBe(404);
		}
		expect(prompts).toHaveLength(0);
	});

	it('demander à Synq : sources limitées aux salons visibles', async () => {
		const prompts = mockAi('Le budget est en cours [1].');
		const { owner, member, wid, general, hidden } = await withSecret();
		const visible = await post(owner, wid, general.id, 'Le budget licornes passe en revue lundi');
		const res = await member.req<AiAnswer>('POST', `/api/w/${wid}/ai/ask`, { question: 'Où en est le budget licornes ?' });
		expect(res.status).toBe(200);
		expect(res.data.sources.map((m) => m.id)).toEqual([visible.id]);
		expect(prompts[0]).not.toContain('confidentiel');
		const owners = await owner.req<AiAnswer>('POST', `/api/w/${wid}/ai/ask`, { question: 'budget licornes' });
		expect(owners.data.sources.map((m) => m.id).sort()).toEqual([hidden.id, visible.id].sort());
		const empty = await member.req<AiAnswer>('POST', `/api/w/${wid}/ai/ask`, { question: 'confidentiel 2027' });
		expect(empty.data.sources).toEqual([]);
		expect(prompts).toHaveLength(2);
	});

	it('invité : limité à ses groupes', async () => {
		const prompts = mockAi('- résumé');
		const { owner, guest, wid, general, dm } = await withGuest();
		const inGroup = await post(owner, wid, dm.id, 'Licornes : maquette validée');
		const outside = await post(owner, wid, general.id, 'Licornes : salaires de l’équipe');
		expect((await guest.req('POST', `/api/w/${wid}/channels/${dm.id}/ai/catchup`, { after: 0 })).status).toBe(200);
		expect((await guest.req('POST', `/api/w/${wid}/channels/${general.id}/ai/catchup`, { after: 0 })).status).toBe(404);
		expect((await guest.req('POST', `/api/w/${wid}/messages/${inGroup.id}/ai/translate`, {})).status).toBe(200);
		expect((await guest.req('POST', `/api/w/${wid}/messages/${outside.id}/ai/summary`, {})).status).toBe(404);
		const answer = await guest.req<AiAnswer>('POST', `/api/w/${wid}/ai/ask`, { question: 'licornes' });
		expect(answer.data.sources.map((m) => m.id)).toEqual([inGroup.id]);
		expect(prompts.join('\n')).not.toContain('salaires');
		expect((await guest.req('POST', '/api/ai/parse-event', { text: 'Réunion demain 10h', timezone: 'Europe/Paris', now: Date.now() })).status).toBe(403);
		expect((await guest.req('POST', '/api/ai/rewrite', { action: 'corriger', text: 'bonjour' })).status).toBe(200);
	});

	it('événement décrit : heure du fuseau, participants de l’espace seulement', async () => {
		mockAi('{"title": "Revue produit", "date": "2026-11-03", "time": "14:00", "durationMinutes": 90, "allDay": false, "location": "Salle Lune", "participants": ["bob", "Zoé"]}');
		const { owner, member, wid } = await workspaceWithMember();
		const now = Date.UTC(2026, 9, 27, 12);
		const res = await owner.req<AiParsedEvent>('POST', '/api/ai/parse-event', { text: 'Revue produit mardi prochain 14h avec Bob', timezone: 'Europe/Paris', now, workspaceId: wid });
		expect(res.status).toBe(200);
		expect(res.data).toMatchObject({ title: 'Revue produit', location: 'Salle Lune', allDay: false, timezone: 'Europe/Paris', attendees: [member.user.id] });
		expect(res.data.startsAt).toBe(Date.UTC(2026, 10, 3, 13));
		expect(res.data.endsAt).toBe(Date.UTC(2026, 10, 3, 14, 30));
		const stranger = await workspaceWithMember();
		expect((await stranger.owner.req('POST', '/api/ai/parse-event', { text: 'Réunion', timezone: 'Europe/Paris', now, workspaceId: wid })).status).toBe(404);
		expect(zonedTime('2026-07-01', '09:30', 'Europe/Paris')).toBe(Date.UTC(2026, 6, 1, 7, 30));
	});

	it('IA indisponible : 503', async () => {
		vi.spyOn(aiRunner, 'run').mockRejectedValue(new Error('panne'));
		const { owner, wid, general } = await workspaceWithMember();
		const message = await post(owner, wid, general.id, 'Bonjour à tous');
		expect((await owner.req('POST', `/api/w/${wid}/messages/${message.id}/ai/translate`, { lang: 'en' })).status).toBe(503);
	});
});
