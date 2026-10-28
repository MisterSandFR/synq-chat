import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { Draft, ScheduledMessage, SentPage } from '../shared/drafts';
import type { NotificationPage } from '../shared/notifications';
import { P } from '../shared/permissions';
import type { Message, MessagePage, ServerEvent } from '../shared/types';
import { workspaceWithMember, type Client } from './helpers';

const post = (client: Client, wid: string, cid: string, body: string) => client.req<Message>('POST', `/api/w/${wid}/channels/${cid}/messages`, { body });

const saveDraft = (client: Client, wid: string, channelId: string, body: string, threadRoot = 0) =>
	client.req<Draft | null>('PUT', `/api/w/${wid}/drafts`, { channelId, threadRoot, body });

const drafts = async (client: Client, wid: string) => (await client.req<Draft[]>('GET', `/api/w/${wid}/drafts`)).data;

const schedule = (client: Client, wid: string, channelId: string, body: string, sendAt: number) =>
	client.req<ScheduledMessage>('POST', `/api/w/${wid}/scheduled`, { channelId, body, sendAt });

const scheduled = async (client: Client, wid: string) => (await client.req<ScheduledMessage[]>('GET', `/api/w/${wid}/scheduled`)).data;

const TOMORROW = () => Date.now() + 24 * 3600 * 1000;

// Rend tous les messages programmés échus puis déclenche l'alarme.
async function fireAlarm(wid: string): Promise<void> {
	const stub = env.WORKSPACE.getByName(wid);
	await runInDurableObject(stub, (_instance, state) => {
		state.storage.sql.exec("UPDATE scheduled_messages SET send_at = ? WHERE status = 'pending'", Date.now() - 1);
	});
	expect(await runDurableObjectAlarm(stub)).toBe(true);
}

describe('brouillons', () => {
	it('garde un brouillon par salon et par fil, propre à chacun', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const root = await post(owner, wid, general.id, 'question');
		expect((await saveDraft(member, wid, general.id, 'salon')).data).toMatchObject({ channelId: general.id, threadRoot: 0, body: 'salon' });
		expect((await saveDraft(member, wid, general.id, 'fil', root.data.id)).status).toBe(200);
		expect((await saveDraft(member, wid, general.id, 'salon v2')).data?.body).toBe('salon v2');

		const mine = await drafts(member, wid);
		expect(mine.map((d) => [d.threadRoot, d.body]).sort()).toEqual([
			[0, 'salon v2'],
			[root.data.id, 'fil'],
		]);
		expect(await drafts(owner, wid)).toEqual([]);

		expect((await saveDraft(member, wid, general.id, '   ')).data).toBeNull();
		expect((await drafts(member, wid)).map((d) => d.threadRoot)).toEqual([root.data.id]);
		expect((await saveDraft(member, wid, general.id, 'x', 999_999)).status).toBe(404);
	});

	it('supprime le brouillon à l’envoi, salon et fil séparément', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const root = await post(owner, wid, general.id, 'question');
		await saveDraft(member, wid, general.id, 'salon');
		await saveDraft(member, wid, general.id, 'fil', root.data.id);
		const socket = await member.socket(wid);
		await socket.next('hello');

		expect((await post(member, wid, general.id, 'salon')).status).toBe(200);
		const cleared = (await socket.next('draft')) as Extract<ServerEvent, { t: 'draft' }>;
		expect(cleared).toMatchObject({ channelId: general.id, threadRoot: 0, draft: null });
		expect((await drafts(member, wid)).map((d) => d.threadRoot)).toEqual([root.data.id]);

		expect((await member.req('POST', `/api/w/${wid}/messages/${root.data.id}/thread`, { body: 'réponse' })).status).toBe(200);
		expect(await drafts(member, wid)).toEqual([]);
		socket.ws.close(1000);
	});

	it('refuse un salon invisible', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const secret = await owner.req<{ id: string }>('POST', `/api/w/${wid}/channels`, { name: 'secret' });
		await owner.req('PUT', `/api/w/${wid}/channels/${secret.data.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } });
		expect((await saveDraft(member, wid, secret.data.id, 'x')).status).toBe(404);
		expect((await schedule(member, wid, secret.data.id, 'x', TOMORROW())).status).toBe(404);
	});
});

describe('messages programmés', () => {
	it('refuse une heure passée ou invalide', async () => {
		const { member, wid, general } = await workspaceWithMember();
		expect((await schedule(member, wid, general.id, 'trop tard', Date.now() - 1000)).status).toBe(400);
		expect((await member.req('POST', `/api/w/${wid}/scheduled`, { channelId: general.id, body: 'x', sendAt: 'demain' })).status).toBe(400);
		expect((await schedule(member, wid, general.id, 'loin', Date.now() + 200 * 24 * 3600 * 1000)).status).toBe(400);
		expect((await schedule(member, wid, general.id, '  ', TOMORROW())).status).toBe(400);
	});

	it('programme l’alarme et envoie à l’heure dite', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		await saveDraft(member, wid, general.id, 'plus tard');
		const sendAt = TOMORROW();
		const created = await schedule(member, wid, general.id, 'plus tard', sendAt);
		expect(created.status).toBe(200);
		expect(created.data).toMatchObject({ channelId: general.id, sendAt, status: 'pending' });
		expect(await drafts(member, wid)).toEqual([]);
		await runInDurableObject(env.WORKSPACE.getByName(wid), async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBe(sendAt);
		});
		expect((await owner.req('DELETE', `/api/w/${wid}/scheduled/${created.data.id}`)).status).toBe(404);

		await fireAlarm(wid);
		const page = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.at(-1)).toMatchObject({ userId: member.user.id, body: 'plus tard' });
		expect(await scheduled(member, wid)).toEqual([]);
		await runInDurableObject(env.WORKSPACE.getByName(wid), async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBeNull();
		});
	});

	it('droits retirés entre-temps : échec notifié, message gardé', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const created = await schedule(member, wid, general.id, 'interdit', TOMORROW());
		await owner.req('PUT', `/api/w/${wid}/channels/${general.id}/overrides`, { overrides: { default: { allow: 0, deny: P.SEND_MESSAGES } } });
		await fireAlarm(wid);

		const [row] = await scheduled(member, wid);
		expect(row).toMatchObject({ id: created.data.id, status: 'failed', error: 'Tu ne peux pas écrire dans ce salon' });
		const notes = await member.req<NotificationPage>('GET', `/api/w/${wid}/notifications`);
		expect(notes.data.items[0]).toMatchObject({ kind: 'scheduled', channelId: null, link: `/w/${wid}/brouillons` });
		const page = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.some((m) => m.body === 'interdit')).toBe(false);

		// Reprogrammé puis envoyé maintenant une fois les droits rendus.
		expect((await member.req<ScheduledMessage>('PATCH', `/api/w/${wid}/scheduled/${created.data.id}`, { sendAt: TOMORROW() })).data.status).toBe('pending');
		expect((await member.req('POST', `/api/w/${wid}/scheduled/${created.data.id}/send`)).status).toBe(403);
		await owner.req('PUT', `/api/w/${wid}/channels/${general.id}/overrides`, { overrides: {} });
		expect((await member.req<Message>('POST', `/api/w/${wid}/scheduled/${created.data.id}/send`)).data.body).toBe('interdit');
		expect(await scheduled(member, wid)).toEqual([]);
	});

	it('membre retiré : échec à l’envoi', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		await schedule(member, wid, general.id, 'parti', TOMORROW());
		expect((await owner.req('DELETE', `/api/w/${wid}/members/${member.user.id}`)).status).toBe(200);
		await fireAlarm(wid);
		const page = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.some((m) => m.body === 'parti')).toBe(false);
	});
});

describe('envoyés', () => {
	it('liste seulement mes messages, récents d’abord, paginés', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		for (let i = 0; i < 32; i++) {
			await post(member, wid, general.id, `m${i}`);
		}
		await post(owner, wid, general.id, 'pas à moi');
		const first = await member.req<SentPage>('GET', `/api/w/${wid}/sent`);
		expect(first.data.messages).toHaveLength(30);
		expect(first.data.messages[0]!.body).toBe('m31');
		expect(first.data.messages.every((m) => m.userId === member.user.id)).toBe(true);
		const second = await member.req<SentPage>('GET', `/api/w/${wid}/sent?before=${first.data.next}`);
		expect(second.data.messages.map((m) => m.body)).toEqual(['m1', 'm0']);
		expect(second.data.next).toBeNull();
		expect((await owner.req<SentPage>('GET', `/api/w/${wid}/sent`)).data.messages.map((m) => m.body)).toEqual(['pas à moi']);
	});
});
