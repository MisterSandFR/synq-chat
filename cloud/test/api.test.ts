import { exports } from 'cloudflare:workers';
import { sign } from 'hono/jwt';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Attachment, Channel, Me, Message, MessagePage, ServerEvent, User, WorkspaceDetail } from '../shared/types';

const BASE = 'https://synq.test';

type Reply<T> = { status: number; data: T };

class Client {
	jar = new Map<string, string>();
	// IP distincte par client : le rate limit est par IP.
	ip = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
	user!: User;

	get cookie(): string {
		return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
	}

	async req<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply<T>> {
		const res = await this.raw(method, path, body, headers);
		const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
		return { status: res.status, data: data as T };
	}

	async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
		// exports.default.fetch suit les redirections par défaut.
		const init: RequestInit = { method, redirect: 'manual', headers: { 'cf-connecting-ip': this.ip, ...headers } };
		const h = init.headers as Record<string, string>;
		if (this.jar.size) {
			h.cookie = this.cookie;
		}
		if (body instanceof ArrayBuffer || typeof body === 'string') {
			init.body = body;
		} else if (body !== undefined) {
			h['content-type'] = 'application/json';
			init.body = JSON.stringify(body);
		}
		const res = await exports.default.fetch(new Request(BASE + path, init));
		for (const line of res.headers.getSetCookie()) {
			const [pair = ''] = line.split(';');
			const [name = '', value = ''] = pair.split('=');
			if (/max-age=0/i.test(line) || !value) {
				this.jar.delete(name);
			} else {
				this.jar.set(name, value);
			}
		}
		return res;
	}

	async socket(workspaceId: string): Promise<{ ws: WebSocket; next: (t: ServerEvent['t']) => Promise<ServerEvent> }> {
		const res = await exports.default.fetch(new Request(`${BASE}/api/w/${workspaceId}/ws`, { headers: { Upgrade: 'websocket', cookie: this.cookie } }));
		const ws = res.webSocket;
		if (!ws) {
			throw new Error(`no websocket, status ${res.status}`);
		}
		ws.accept();
		const queue: ServerEvent[] = [];
		const waiters: Array<() => void> = [];
		ws.addEventListener('message', (event) => {
			queue.push(JSON.parse(event.data as string) as ServerEvent);
			waiters.splice(0).forEach((wake) => wake());
		});
		const next = async (t: ServerEvent['t']): Promise<ServerEvent> => {
			for (;;) {
				const index = queue.findIndex((event) => event.t === t);
				if (index >= 0) {
					return queue.splice(index, 1)[0]!;
				}
				await new Promise<void>((resolve, reject) => {
					waiters.push(resolve);
					setTimeout(() => reject(new Error(`timeout waiting ${t}`)), 2000);
				});
			}
		};
		return { ws, next };
	}
}

async function signup(name: string): Promise<Client> {
	const client = new Client();
	const res = await client.req<User>('POST', '/api/auth/signup', { email: `${name.toLowerCase()}-${crypto.randomUUID()}@test.dev`, name, password: 'motdepasse123' });
	expect(res.status).toBe(201);
	client.user = res.data;
	return client;
}

async function workspaceWithMember() {
	const owner = await signup('Alice');
	const member = await signup('Bob');
	const created = await owner.req<{ id: string; channels: Channel[] }>('POST', '/api/workspaces', { name: 'Équipe' });
	expect(created.status).toBe(201);
	const invite = await owner.req<{ code: string }>('POST', `/api/w/${created.data.id}/invites`);
	expect((await member.req('POST', `/api/invites/${invite.data.code}/accept`)).status).toBe(200);
	const general = created.data.channels.find((c) => c.name === 'général')!;
	const announcements = created.data.channels.find((c) => c.name === 'annonces')!;
	return { owner, member, wid: created.data.id, general, announcements };
}

describe('auth', () => {
	it('inscrit, connecte et déconnecte', async () => {
		const alice = await signup('Alice');
		expect((await alice.req('GET', '/api/me')).data).toMatchObject({ user: { name: 'Alice' }, workspaces: [] });

		const again = await new Client().req('POST', '/api/auth/signup', { email: alice.user.email, name: 'X', password: 'motdepasse123' });
		expect(again.status).toBe(409);

		const wrong = await new Client().req('POST', '/api/auth/login', { email: alice.user.email, password: 'mauvais-mdp' });
		expect(wrong.status).toBe(401);

		const other = new Client();
		expect((await other.req('POST', '/api/auth/login', { email: alice.user.email.toUpperCase(), password: 'motdepasse123' })).status).toBe(200);
		const stale = new Client();
		stale.jar = new Map(other.jar);
		expect((await other.req('POST', '/api/auth/logout')).status).toBe(200);
		expect((await stale.req('GET', '/api/me')).status).toBe(401);
		expect((await alice.req('GET', '/api/me')).status).toBe(200);
	});

	it('refuse sans session et rejette les entrées invalides', async () => {
		expect((await new Client().req('GET', '/api/me')).status).toBe(401);
		expect((await new Client().req('POST', '/api/auth/signup', { email: 'pas-un-email', name: 'X', password: 'motdepasse123' })).status).toBe(400);
		expect((await new Client().req('POST', '/api/auth/signup', { email: 'a@b.fr', name: 'X', password: 'court' })).status).toBe(400);
	});

	it('refuse une mutation cross-origin', async () => {
		const alice = await signup('Alice');
		const res = await alice.req('POST', '/api/workspaces', { name: 'X' }, { Origin: 'https://evil.example' });
		expect(res.status).toBe(403);
	});
});

describe('espaces et membres', () => {
	it('crée les salons par défaut et isole les non-membres', async () => {
		const { owner, wid } = await workspaceWithMember();
		const info = await owner.req<WorkspaceDetail>('GET', `/api/w/${wid}/info`);
		expect(info.data.members.map((m) => [m.name, m.role])).toEqual([
			['Alice', 'owner'],
			['Bob', 'member'],
		]);
		const stranger = await signup('Eve');
		expect((await stranger.req('GET', `/api/w/${wid}/info`)).status).toBe(404);
		expect((await stranger.req('GET', `/api/w/${wid}/channels`)).status).toBe(404);
	});

	it('gère rôles et retrait', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		expect((await member.req('PATCH', `/api/w/${wid}/members/${owner.user.id}`, { role: 'member' })).status).toBe(403);
		expect((await owner.req('PATCH', `/api/w/${wid}/members/${member.user.id}`, { role: 'admin' })).status).toBe(200);
		expect((await member.req('POST', `/api/w/${wid}/channels`, { name: 'staff' })).status).toBe(200);
		expect((await member.req('DELETE', `/api/w/${wid}/members/${owner.user.id}`)).status).toBe(403);
		expect((await owner.req('DELETE', `/api/w/${wid}/members/${member.user.id}`)).status).toBe(200);
		expect((await member.req('GET', `/api/w/${wid}/info`)).status).toBe(404);
	});
});

describe('salons', () => {
	it('réserve la gestion aux admins et normalise les noms', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		expect((await member.req('POST', `/api/w/${wid}/channels`, { name: 'x' })).status).toBe(403);
		const created = await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: '  Projet X ', category: 'Projets' });
		expect(created.data).toMatchObject({ name: 'projet-x', category: 'Projets', readOnly: false });
		expect((await owner.req('POST', `/api/w/${wid}/channels`, { name: 'projet-x' })).status).toBe(409);
		const renamed = await owner.req<Channel>('PATCH', `/api/w/${wid}/channels/${created.data.id}`, { name: 'Projet Y', readOnly: true });
		expect(renamed.data).toMatchObject({ name: 'projet-y', readOnly: true });
	});

	it('garde au moins un salon', async () => {
		const { owner, wid, general, announcements } = await workspaceWithMember();
		expect((await owner.req('DELETE', `/api/w/${wid}/channels/${announcements.id}`)).status).toBe(200);
		expect((await owner.req('DELETE', `/api/w/${wid}/channels/${general.id}`)).status).toBe(400);
	});
});

describe('messages', () => {
	it('applique la lecture seule aux membres', async () => {
		const { owner, member, wid, announcements } = await workspaceWithMember();
		expect((await member.req('POST', `/api/w/${wid}/channels/${announcements.id}/messages`, { body: 'salut' })).status).toBe(403);
		expect((await owner.req('POST', `/api/w/${wid}/channels/${announcements.id}/messages`, { body: 'annonce' })).status).toBe(200);
	});

	it('pagine, modifie et supprime', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		for (let i = 1; i <= 55; i++) {
			await member.req('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: `m${i}` });
		}
		const page = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages).toHaveLength(50);
		expect(page.data.hasMore).toBe(true);
		expect(page.data.messages.at(-1)!.body).toBe('m55');
		const older = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages?before=${page.data.messages[0]!.id}`);
		expect(older.data.messages.map((m) => m.body)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
		expect(older.data.hasMore).toBe(false);

		const last = page.data.messages.at(-1)!;
		expect((await owner.req('PATCH', `/api/w/${wid}/messages/${last.id}`, { body: 'piraté' })).status).toBe(403);
		const edited = await member.req<Message>('PATCH', `/api/w/${wid}/messages/${last.id}`, { body: 'corrigé' });
		expect(edited.data.body).toBe('corrigé');
		expect(edited.data.editedAt).not.toBeNull();
		expect((await owner.req('DELETE', `/api/w/${wid}/messages/${last.id}`)).status).toBe(200);
		expect((await owner.req('DELETE', `/api/w/${wid}/messages/${last.id}`)).status).toBe(404);
	});

	it('rejette messages vides ou trop longs', async () => {
		const { owner, wid, general } = await workspaceWithMember();
		expect((await owner.req('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: '   ' })).status).toBe(400);
		expect((await owner.req('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'x'.repeat(4001) })).status).toBe(400);
	});
});

describe('temps réel', () => {
	it('diffuse messages, présence et non-lus', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		await owner.req('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'avant connexion' });

		const bob = await member.socket(wid);
		const hello = (await bob.next('hello')) as Extract<ServerEvent, { t: 'hello' }>;
		expect(hello.channels.map((c) => c.name)).toContain('général');
		expect(hello.unread[general.id]).toBe(1);

		const alice = await owner.socket(wid);
		await alice.next('hello');
		expect(await bob.next('presence')).toEqual({ t: 'presence', userId: owner.user.id, online: true });

		await owner.req('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'en direct' });
		const event = (await bob.next('message')) as Extract<ServerEvent, { t: 'message' }>;
		expect(event.message).toMatchObject({ body: 'en direct', userId: owner.user.id });

		alice.ws.send(JSON.stringify({ t: 'typing', channelId: general.id }));
		expect(await bob.next('typing')).toEqual({ t: 'typing', channelId: general.id, userId: owner.user.id });

		expect((await member.req('POST', `/api/w/${wid}/channels/${general.id}/read`)).status).toBe(200);
		const bobAgain = await member.socket(wid);
		const hello2 = (await bobAgain.next('hello')) as Extract<ServerEvent, { t: 'hello' }>;
		expect(hello2.unread[general.id]).toBeUndefined();

		alice.ws.close(1000);
		bob.ws.close(1000);
		bobAgain.ws.close(1000);
	});

	it('refuse le WebSocket aux non-membres', async () => {
		const { wid } = await workspaceWithMember();
		const eve = await signup('Eve');
		await expect(eve.socket(wid)).rejects.toThrow('status 404');
	});
});

describe('fichiers', () => {
	it('stocke, joint et sert sans exécution', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
		const upload = await owner.req<Attachment>('POST', `/api/w/${wid}/files`, svg, { 'content-type': 'image/svg+xml', 'x-file-name': encodeURIComponent('logo été.svg') });
		expect(upload.status).toBe(201);
		expect(upload.data.name).toBe('logo été.svg');

		const msg = await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: '', attachmentKey: upload.data.key });
		expect(msg.data.attachment).toMatchObject({ name: 'logo été.svg', type: 'image/svg+xml', size: svg.length });

		const fileId = upload.data.key.split('/').pop();
		const res = await exports.default.fetch(new Request(`${BASE}/api/w/${wid}/files/${fileId}`, { headers: { cookie: member.cookie } }));
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/octet-stream');
		expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
		expect(await res.text()).toBe(svg);

		const other = await workspaceWithMember();
		const forged = await other.owner.req('POST', `/api/w/${other.wid}/channels/${other.general.id}/messages`, { body: 'x', attachmentKey: upload.data.key });
		expect(forged.status).toBe(400);
	});
});

describe('SSO Recube', () => {
	const ISSUER = 'https://recube.gg';
	const CLIENT_ID = 'synq-test';
	const CLIENT_SECRET = 'secret-test';

	type Identity = { sub: string; email?: string; email_verified?: boolean; name?: string; preferred_username?: string; picture?: string };

	async function provider(identity: Identity, overrides: { nonce?: string; aud?: string } = {}) {
		const keys = (await crypto.subtle.generateKey(
			{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
			true,
			['sign', 'verify'],
		)) as CryptoKeyPair;
		const publicJwk = { ...((await crypto.subtle.exportKey('jwk', keys.publicKey)) as JsonWebKey), kid: 'k1', alg: 'RS256' };
		const privateJwk = { ...((await crypto.subtle.exportKey('jwk', keys.privateKey)) as JsonWebKey), kid: 'k1', alg: 'RS256' };
		const seen = { nonce: '', challenge: '' };
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			const json = (data: unknown, status = 200) => Response.json(data, { status });
			if (url.pathname === '/.well-known/openid-configuration') {
				return json({
					issuer: ISSUER,
					authorization_endpoint: `${ISSUER}/oauth/authorize`,
					token_endpoint: `${ISSUER}/oauth/token`,
					userinfo_endpoint: `${ISSUER}/oauth/userinfo`,
					jwks_uri: `${ISSUER}/.well-known/jwks.json`,
				});
			}
			if (url.pathname === '/.well-known/jwks.json') {
				return json({ keys: [publicJwk] });
			}
			if (url.pathname === '/oauth/token') {
				const headers = new Headers(init?.headers);
				if (headers.get('Authorization') !== `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`) {
					return json({ error: 'invalid_client' }, 401);
				}
				const form = new URLSearchParams(String(init?.body));
				const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(form.get('code_verifier') ?? '')));
				const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
				if (form.get('code') !== 'good-code' || challenge !== seen.challenge) {
					return json({ error: 'invalid_grant' }, 400);
				}
				const now = Math.floor(Date.now() / 1000);
				const idToken = await sign(
					{ iss: ISSUER, aud: overrides.aud ?? CLIENT_ID, sub: identity.sub, nonce: overrides.nonce ?? seen.nonce, iat: now, exp: now + 3600 },
					privateJwk as never,
				);
				return json({ id_token: idToken, access_token: 'at-1', token_type: 'Bearer' });
			}
			if (url.pathname === '/oauth/userinfo') {
				return json(identity);
			}
			return new Response('not mocked', { status: 599 });
		});
		return seen;
	}

	async function ssoLogin(client: Client, seen: { nonce: string; challenge: string }, link = false): Promise<string> {
		const start = await client.raw('GET', `/api/auth/recube/start${link ? '?link=1' : ''}`);
		expect(start.status).toBe(302);
		const authorize = new URL(start.headers.get('location')!);
		expect(authorize.origin + authorize.pathname).toBe(`${ISSUER}/oauth/authorize`);
		expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
		expect(authorize.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/recube/callback`);
		seen.nonce = authorize.searchParams.get('nonce')!;
		seen.challenge = authorize.searchParams.get('code_challenge')!;
		const state = authorize.searchParams.get('state')!;
		const callback = await client.raw('GET', `/api/auth/recube/callback?code=good-code&state=${state}`);
		expect(callback.status).toBe(302);
		return callback.headers.get('location')!;
	}

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('crée un compte puis reconnecte le même utilisateur', async () => {
		const seen = await provider({ sub: `sub-${crypto.randomUUID()}`, email: 'joueur@recube.gg', email_verified: true, preferred_username: 'Joueur42', picture: 'https://recube.gg/a.png' });
		const first = new Client();
		expect(await ssoLogin(first, seen)).toBe('/');
		const me = await first.req<Me>('GET', '/api/me');
		expect(me.data).toMatchObject({ user: { name: 'Joueur42', email: 'joueur@recube.gg', avatarUrl: 'https://recube.gg/a.png' }, identities: ['recube'], hasPassword: false });

		const second = new Client();
		expect(await ssoLogin(second, seen)).toBe('/');
		expect((await second.req<Me>('GET', '/api/me')).data.user.id).toBe(me.data.user.id);
		expect((await second.req('DELETE', '/api/me/identities/recube')).status).toBe(400);
	});

	it('ne fusionne jamais sur un email local existant', async () => {
		const local = await signup('Local');
		const seen = await provider({ sub: `sub-${crypto.randomUUID()}`, email: local.user.email, email_verified: true, name: 'Imposteur' });
		expect(await ssoLogin(new Client(), seen)).toBe('/?sso_error=email_exists');
	});

	it('lie un compte local connecté', async () => {
		const local = await signup('Local');
		const seen = await provider({ sub: `sub-${crypto.randomUUID()}`, email: local.user.email, email_verified: true, name: 'Pseudo' });
		expect(await ssoLogin(local, seen, true)).toBe('/?linked=recube');
		expect((await local.req<Me>('GET', '/api/me')).data.identities).toEqual(['recube']);

		const viaRecube = new Client();
		expect(await ssoLogin(viaRecube, seen)).toBe('/');
		expect((await viaRecube.req<Me>('GET', '/api/me')).data.user.id).toBe(local.user.id);
	});

	it('rejette state forgé, nonce invalide et mauvaise audience', async () => {
		const seen = await provider({ sub: 'sub-x' }, { nonce: 'autre-nonce' });
		const forged = new Client();
		await forged.raw('GET', '/api/auth/recube/start');
		const res = await forged.raw('GET', '/api/auth/recube/callback?code=good-code&state=forge');
		expect(res.headers.get('location')).toBe('/?sso_error=state');
		expect(await ssoLogin(new Client(), seen)).toBe('/?sso_error=provider');

		vi.restoreAllMocks();
		const seenAud = await provider({ sub: 'sub-y' }, { aud: 'autre-client' });
		expect(await ssoLogin(new Client(), seenAud)).toBe('/?sso_error=provider');
	});
});
