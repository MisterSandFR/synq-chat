import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CommandConfig, CommandPayload, CommandReply, SlashCommand } from '../shared/commands';
import { P } from '../shared/permissions';
import type { Grade, MessagePage, ServerEvent } from '../shared/types';
import { isPublicHttpsUrl, signBody } from '../worker/commands';
import { workspaceWithMember } from './helpers';

const HOOK = 'https://hooks.example.com/synq';
const SECRET = 'un-secret-de-test-assez-long';

type Call = { url: string; body: string; headers: Headers };

async function setup(extra: Record<string, unknown> = {}) {
	const ctx = await workspaceWithMember();
	const created = await ctx.owner.req<CommandConfig>('POST', `/api/w/${ctx.wid}/commands`, {
		name: '/Ping',
		description: 'Répond pong',
		usage: '[texte]',
		url: HOOK,
		secret: SECRET,
		...extra,
	});
	expect(created.status).toBe(200);
	return { ...ctx, command: created.data };
}

function mockHook(reply: () => Response | Promise<Response>): Call[] {
	const calls: Call[] = [];
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const request = new Request(input, init);
		calls.push({ url: request.url, body: await request.text(), headers: request.headers });
		return reply();
	});
	return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('commandes : gestion', () => {
	it('réserve la gestion à MANAGE_COMMANDS et ne renvoie jamais le secret', async () => {
		const { owner, member, wid, command } = await setup();
		expect(command).toMatchObject({ name: 'ping', url: HOOK, ephemeral: false });
		expect(JSON.stringify(command)).not.toContain(SECRET);

		expect((await member.req('POST', `/api/w/${wid}/commands`, { name: 'x', url: HOOK, secret: SECRET })).status).toBe(403);
		expect((await member.req('GET', `/api/w/${wid}/commands/config`)).status).toBe(403);
		expect((await member.req('PATCH', `/api/w/${wid}/commands/${command.id}`, { description: 'x' })).status).toBe(403);
		expect((await member.req('DELETE', `/api/w/${wid}/commands/${command.id}`)).status).toBe(403);

		const visible = await member.req<SlashCommand[]>('GET', `/api/w/${wid}/commands`);
		expect(visible.data).toEqual([{ name: 'ping', description: 'Répond pong', usage: '[texte]' }]);
		const config = await owner.req<CommandConfig[]>('GET', `/api/w/${wid}/commands/config`);
		expect(config.data.map((c) => c.url)).toEqual([HOOK]);
		expect(JSON.stringify(config.data)).not.toContain(SECRET);

		const grade = await owner.req<Grade>('POST', `/api/w/${wid}/grades`, { name: 'Bots', permissions: P.MANAGE_COMMANDS });
		expect((await owner.req('PUT', `/api/w/${wid}/members/${member.user.id}/grades`, { gradeIds: [grade.data.id] })).status).toBe(200);
		expect((await member.req('POST', `/api/w/${wid}/commands`, { name: 'deploy', url: HOOK, secret: SECRET })).status).toBe(200);
	});

	it('valide nom, URL et secret', async () => {
		const { owner, wid } = await setup();
		const create = (body: Record<string, unknown>) => owner.req('POST', `/api/w/${wid}/commands`, { name: 'ok', url: HOOK, secret: SECRET, ...body });
		for (const url of ['http://hooks.example.com/x', 'https://127.0.0.1/x', 'https://10.1.2.3/', 'https://[::1]/', 'https://localhost/', 'https://169.254.169.254/', 'pas une url']) {
			expect((await create({ url })).status, url).toBe(400);
		}
		expect((await create({ name: 'Pas valide' })).status).toBe(400);
		expect((await create({ name: 'me' })).status).toBe(400);
		expect((await create({ secret: 'court' })).status).toBe(400);
		expect((await create({ name: 'ping' })).status).toBe(409);
	});

	it('refuse les adresses privées sous toutes leurs formes', () => {
		for (const url of ['https://2130706433/', 'https://0x7f.1/', 'https://192.168.0.10/', 'https://172.20.1.1/', 'https://100.64.0.1/', 'https://[fd00::1]/', 'https://[::ffff:127.0.0.1]/', 'https://a.local/', 'https://svc.internal/', 'https://user:pw@example.com/', 'https://intranet/']) {
			expect(isPublicHttpsUrl(url), url).toBe(false);
		}
		for (const url of ['https://example.com/hook', 'https://8.8.8.8/x', 'https://[2606:4700::1111]/', 'https://hooks.example.com:8443/a?b=1']) {
			expect(isPublicHttpsUrl(url), url).toBe(true);
		}
	});

	it('diffuse les changements, garde le secret à l’édition et supprime', async () => {
		const { owner, member, wid, general, command } = await setup();
		const socket = await member.socket(wid);
		await socket.next('hello');
		const edited = await owner.req<CommandConfig>('PATCH', `/api/w/${wid}/commands/${command.id}`, { description: 'Nouveau', ephemeral: true, secret: '' });
		expect(edited.data).toMatchObject({ name: 'ping', description: 'Nouveau', ephemeral: true });
		expect(await socket.next('commands_changed')).toEqual({ t: 'commands_changed' } satisfies ServerEvent);

		const calls = mockHook(() => Response.json({ text: 'ok' }));
		expect((await member.req('POST', `/api/w/${wid}/channels/${general.id}/commands`, { name: 'ping' })).status).toBe(200);
		const ts = Number(calls[0]!.headers.get('X-Synq-Timestamp'));
		expect(calls[0]!.headers.get('X-Synq-Signature')).toBe(await signBody(SECRET, ts, calls[0]!.body));

		expect((await owner.req('DELETE', `/api/w/${wid}/commands/${command.id}`)).status).toBe(200);
		await socket.next('commands_changed');
		expect((await member.req('GET', `/api/w/${wid}/commands`)).data).toEqual([]);
		expect((await owner.req('DELETE', `/api/w/${wid}/commands/${command.id}`)).status).toBe(404);
		socket.ws.close(1000);
	});
});

describe('commandes : exécution', () => {
	it('envoie un POST signé et publie la réponse comme message d’app', async () => {
		const { owner, member, wid, general } = await setup();
		const calls = mockHook(() => Response.json({ text: 'pong' }));
		const before = Math.floor(Date.now() / 1000);
		const res = await member.req<CommandReply>('POST', `/api/w/${wid}/channels/${general.id}/commands`, { name: 'PING', text: 'salut tout le monde' });
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ ephemeral: false, text: 'pong' });

		expect(calls).toHaveLength(1);
		const call = calls[0]!;
		expect(call.url).toBe(HOOK);
		const payload = JSON.parse(call.body) as CommandPayload;
		expect(payload).toEqual({
			command: '/ping',
			text: 'salut tout le monde',
			user: { id: member.user.id, name: 'Bob' },
			channel: { id: general.id, name: 'général' },
			workspace: { id: wid, name: 'Équipe' },
		});
		const ts = Number(call.headers.get('X-Synq-Timestamp'));
		expect(ts).toBeGreaterThanOrEqual(before);
		expect(call.headers.get('X-Synq-Signature')).toBe(await signBody(SECRET, ts, call.body));

		const page = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.at(-1)).toMatchObject({ userId: 'app:ping', body: 'pong' });
	});

	it('garde la réponse éphémère côté client', async () => {
		const { owner, member, wid, general, command } = await setup();
		mockHook(() => Response.json({ text: 'rien que pour toi', ephemeral: true }));
		const res = await member.req<CommandReply>('POST', `/api/w/${wid}/channels/${general.id}/commands`, { name: 'ping' });
		expect(res.data).toEqual({ ephemeral: true, text: 'rien que pour toi' });

		await owner.req('PATCH', `/api/w/${wid}/commands/${command.id}`, { ephemeral: true });
		vi.restoreAllMocks();
		mockHook(() => Response.json({ text: 'publique ?' }));
		const forced = await member.req<CommandReply>('POST', `/api/w/${wid}/channels/${general.id}/commands`, { name: 'ping' });
		expect(forced.data).toEqual({ ephemeral: true, text: 'publique ?' });

		const page = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.some((m) => m.userId.startsWith('app:'))).toBe(false);
	});

	it('remonte les échecs du service en 502', async () => {
		const { owner, member, wid, general } = await setup();
		const run = () => member.req<{ error: string }>('POST', `/api/w/${wid}/channels/${general.id}/commands`, { name: 'ping' });
		const cases: Array<[() => Response | Promise<Response>, string]> = [
			[() => new Response('boom', { status: 500 }), 'a répondu 500'],
			[() => new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/' } }), 'a répondu 302'],
			[() => new Response('pas du json'), 'invalide'],
			[() => Response.json({ text: 42 }), 'invalide'],
			[() => new Response(`{"text":"${'x'.repeat(17_000)}"}`), 'trop volumineuse'],
			[
				() => {
					throw new DOMException('timeout', 'TimeoutError');
				},
				'injoignable',
			],
		];
		for (const [reply, expected] of cases) {
			vi.restoreAllMocks();
			mockHook(reply);
			const res = await run();
			expect(res.status, expected).toBe(502);
			expect(res.data.error).toContain(expected);
		}
		const page = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.some((m) => m.userId.startsWith('app:'))).toBe(false);
	});

	it('refuse commande inconnue, salon fermé ou requête invalide sans appel sortant', async () => {
		const { member, wid, general, announcements } = await setup();
		const calls = mockHook(() => Response.json({ text: 'x' }));
		expect((await member.req('POST', `/api/w/${wid}/channels/${general.id}/commands`, { name: 'inconnue' })).status).toBe(404);
		expect((await member.req('POST', `/api/w/${wid}/channels/${announcements.id}/commands`, { name: 'ping' })).status).toBe(403);
		expect((await member.req('POST', `/api/w/${wid}/channels/nope/commands`, { name: 'ping' })).status).toBe(404);
		expect((await member.req('POST', `/api/w/${wid}/channels/${general.id}/commands`, { name: 3 })).status).toBe(400);
		expect(calls).toHaveLength(0);
	});
});
