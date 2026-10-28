import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { NotificationPage } from '../shared/notifications';
import { P } from '../shared/permissions';
import type { Poll, PollInput } from '../shared/polls';
import type { Message, MessagePage } from '../shared/types';
import type { ThreadView } from '../shared/dm-threads';
import { signup, workspaceWithMember, type Client } from './helpers';

const HOUR = 3_600_000;

const input = (extra: Partial<PollInput> = {}): PollInput => ({
	question: 'Où déjeuner ?',
	options: [{ text: 'Pizza', emoji: '🍕' }, { text: 'Sushi' }, { text: 'Salade' }],
	...extra,
});

const create = (client: Client, wid: string, cid: string, extra: Partial<PollInput> = {}) => client.req<Message>('POST', `/api/w/${wid}/channels/${cid}/polls`, input(extra));

const vote = (client: Client, wid: string, mid: number, optionIds: string[]) => client.req<Poll>('PUT', `/api/w/${wid}/polls/${mid}/votes`, { optionIds });

const ids = (poll: Poll) => poll.options.map((o) => o.id);

describe('sondages', () => {
	it('crée un sondage et compte un vote unique, modifiable et retirable', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const created = await create(owner, wid, general.id);
		expect(created.status).toBe(201);
		const poll = created.data.poll!;
		expect(poll).toMatchObject({ question: 'Où déjeuner ?', multiple: false, anonymous: false, closesAt: null, closedAt: null, voters: 0, mine: [] });
		expect(poll.options.map((o) => [o.text, o.emoji])).toEqual([['Pizza', '🍕'], ['Sushi', ''], ['Salade', '']]);
		const [pizza, sushi] = ids(poll);

		const { ws, next } = await owner.socket(wid);
		const voted = await vote(member, wid, created.data.id, [pizza!]);
		expect(voted.data).toMatchObject({ voters: 1, mine: [pizza] });
		expect(voted.data.options[0]).toMatchObject({ count: 1, voters: [member.user.id] });
		// Évènement propre au lecteur : l'auteur n'a pas voté.
		expect(await next('poll')).toMatchObject({ t: 'poll', messageId: created.data.id, poll: { voters: 1, mine: [] } });
		ws.close();

		expect((await vote(member, wid, created.data.id, [pizza!, sushi!])).status).toBe(400);
		const changed = await vote(member, wid, created.data.id, [sushi!]);
		expect(changed.data.options.map((o) => o.count)).toEqual([0, 1, 0]);

		const page = await member.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.find((m) => m.id === created.data.id)?.poll).toMatchObject({ mine: [sushi], voters: 1 });

		const removed = await member.req<Poll>('DELETE', `/api/w/${wid}/polls/${created.data.id}/votes`);
		expect(removed.data).toMatchObject({ voters: 0, mine: [] });
		// Un sondage ne se modifie pas.
		expect((await owner.req('PATCH', `/api/w/${wid}/messages/${created.data.id}`, { body: 'autre' })).status).toBe(400);
	});

	it('accepte le choix multiple', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const created = await create(owner, wid, general.id, { multiple: true });
		const [a, b, c] = ids(created.data.poll!);
		expect((await vote(member, wid, created.data.id, [a!, c!])).data).toMatchObject({ voters: 1, mine: [a, c] });
		expect((await vote(owner, wid, created.data.id, [a!, b!])).data.options.map((o) => o.count)).toEqual([2, 1, 1]);
		expect((await vote(owner, wid, created.data.id, ['inconnu'])).status).toBe(400);
	});

	it('ne renvoie jamais d’identité pour un sondage anonyme', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const created = await create(owner, wid, general.id, { anonymous: true });
		const [a] = ids(created.data.poll!);
		const { ws, next } = await owner.socket(wid);
		await vote(member, wid, created.data.id, [a!]);
		const event = await next('poll');
		ws.close();
		const seen = await owner.req<Poll>('GET', `/api/w/${wid}/polls/${created.data.id}`);
		const page = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		for (const payload of [event, seen.data, page.data]) {
			expect(JSON.stringify(payload)).not.toContain(member.user.id);
		}
		expect(seen.data).toMatchObject({ anonymous: true, voters: 1, mine: [] });
		expect(seen.data.options[0]).toEqual({ id: a, text: 'Pizza', emoji: '🍕', count: 1 });
		expect((await member.req<Poll>('GET', `/api/w/${wid}/polls/${created.data.id}`)).data.mine).toEqual([a]);
	});

	it('se clôt à la main par l’auteur ou un modérateur, puis refuse les votes', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const created = await create(member, wid, general.id);
		const [a] = ids(created.data.poll!);
		const stranger = await signup('Eve');
		expect((await stranger.req('POST', `/api/w/${wid}/polls/${created.data.id}/close`)).status).toBe(404);
		await vote(owner, wid, created.data.id, [a!]);
		const closed = await owner.req<Poll>('POST', `/api/w/${wid}/polls/${created.data.id}/close`);
		expect(closed.status).toBe(200);
		expect(closed.data.closedAt).toEqual(expect.any(Number));
		expect((await vote(member, wid, created.data.id, [a!])).status).toBe(409);
		expect((await member.req('POST', `/api/w/${wid}/polls/${created.data.id}/close`)).status).toBe(409);
		// Clos par un autre : l'auteur est prévenu.
		const page = await member.req<NotificationPage>('GET', `/api/w/${wid}/notifications?filter=all`);
		expect(page.data.items.find((n) => n.kind === 'poll')).toMatchObject({ title: 'Sondage terminé', messageId: created.data.id, body: 'Où déjeuner ? Gagnant : Pizza (1 vote).' });

		const other = await create(owner, wid, general.id);
		expect((await member.req('POST', `/api/w/${wid}/polls/${other.data.id}/close`)).status).toBe(403);
	});

	it('se clôt à l’échéance par l’alarme et prévient l’auteur', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const created = await create(owner, wid, general.id, { duration: HOUR });
		expect(created.data.poll!.closesAt).toBeGreaterThan(Date.now());
		const [, b] = ids(created.data.poll!);
		await vote(member, wid, created.data.id, [b!]);
		const stub = env.WORKSPACE.getByName(wid);
		await runInDurableObject(stub, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBe(created.data.poll!.closesAt);
			state.storage.sql.exec('UPDATE polls SET closes_at = ?', Date.now() - 1);
		});
		expect((await vote(member, wid, created.data.id, [b!])).status).toBe(409);
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		const seen = await owner.req<Poll>('GET', `/api/w/${wid}/polls/${created.data.id}`);
		expect(seen.data.closedAt).toEqual(expect.any(Number));
		const page = await owner.req<NotificationPage>('GET', `/api/w/${wid}/notifications?filter=all`);
		expect(page.data.items.find((n) => n.kind === 'poll')?.body).toBe('Où déjeuner ? Gagnant : Sushi (1 vote).');
		await runInDurableObject(stub, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBeNull();
		});
	});

	it('refuse le vote sans droit et valide la création', async () => {
		const { owner, member, wid, general, announcements } = await workspaceWithMember();
		const created = await create(owner, wid, announcements.id);
		expect(created.status).toBe(201);
		const [a] = ids(created.data.poll!);
		// Annonces : réagir suffit pour voter.
		expect((await vote(member, wid, created.data.id, [a!])).status).toBe(200);
		expect((await create(member, wid, announcements.id)).status).toBe(403);
		await owner.req('PUT', `/api/w/${wid}/channels/${announcements.id}/overrides`, { overrides: { default: { allow: 0, deny: P.SEND_MESSAGES | P.ADD_REACTIONS } } });
		expect((await vote(member, wid, created.data.id, [a!])).status).toBe(403);
		const stranger = await signup('Eve');
		expect((await vote(stranger, wid, created.data.id, [a!])).status).toBe(404);
		expect((await create(owner, wid, general.id, { question: ' ' })).status).toBe(400);
		expect((await create(owner, wid, general.id, { options: [{ text: 'Seule' }] })).status).toBe(400);
		expect((await create(owner, wid, general.id, { options: [{ text: 'A' }, { text: 'a' }] })).status).toBe(409);
		expect((await create(owner, wid, general.id, { duration: 1234 })).status).toBe(400);
		expect((await create(owner, wid, general.id, { options: [{ text: 'A', emoji: 'x' }, { text: 'B' }] })).status).toBe(400);
	});

	it('ajoute une option si l’auteur l’autorise', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const locked = await create(owner, wid, general.id);
		expect((await member.req('POST', `/api/w/${wid}/polls/${locked.data.id}/options`, { text: 'Burger' })).status).toBe(403);
		expect((await owner.req('POST', `/api/w/${wid}/polls/${locked.data.id}/options`, { text: 'Burger' })).status).toBe(200);

		const open = await create(owner, wid, general.id, { allowAdd: true });
		const added = await member.req<Poll>('POST', `/api/w/${wid}/polls/${open.data.id}/options`, { text: 'Tacos', emoji: '🌮' });
		expect(added.data.options.map((o) => o.text)).toEqual(['Pizza', 'Sushi', 'Salade', 'Tacos']);
		expect((await member.req('POST', `/api/w/${wid}/polls/${open.data.id}/options`, { text: 'tacos' })).status).toBe(409);
		expect((await vote(member, wid, open.data.id, [added.data.options[3]!.id])).data.mine).toEqual([added.data.options[3]!.id]);
	});

	it('fonctionne dans un fil et une conversation privée', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const root = await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'On vote ?' });
		const inThread = await create(member, wid, general.id, { threadRoot: root.data.id });
		expect(inThread.status).toBe(201);
		expect(inThread.data.threadRoot).toBe(root.data.id);
		const view = await owner.req<ThreadView>('GET', `/api/w/${wid}/messages/${root.data.id}/thread`);
		expect(view.data.replies[0]?.poll?.question).toBe('Où déjeuner ?');

		const dm = await owner.req<{ id: string }>('POST', `/api/w/${wid}/dms`, { userIds: [member.user.id] });
		const inDm = await create(owner, wid, dm.data.id);
		expect(inDm.status).toBe(201);
		expect((await vote(member, wid, inDm.data.id, [ids(inDm.data.poll!)[0]!])).status).toBe(200);
		const outsider = (await workspaceWithMember()).owner;
		expect((await vote(outsider, wid, inDm.data.id, [ids(inDm.data.poll!)[0]!])).status).toBe(404);
	});
});
