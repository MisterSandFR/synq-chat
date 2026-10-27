import { runInDurableObject } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { sign } from 'hono/jwt';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Attachment, Channel, DriveFile, DriveFolder, DriveListing, Grade, Me, Message, MessagePage, SearchHit, ServerEvent, User, WorkspaceDetail } from '../shared/types';

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
			h['content-length'] = String(typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.byteLength);
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

	async socket(workspaceId: string): Promise<{ ws: WebSocket; next: (t: ServerEvent['t']) => Promise<ServerEvent>; drain: () => void }> {
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
		return { ws, next, drain: () => void queue.splice(0) };
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
		expect(info.data.members.map((m) => [m.name, m.owner])).toEqual([
			['Alice', true],
			['Bob', false],
		]);
		expect(info.data.grades.map((g) => g.id)).toEqual(['admin', 'default']);
		const stranger = await signup('Eve');
		expect((await stranger.req('GET', `/api/w/${wid}/info`)).status).toBe(404);
		expect((await stranger.req('GET', `/api/w/${wid}/channels`)).status).toBe(404);
	});

	it('gère rôles et retrait', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		expect((await member.req('PUT', `/api/w/${wid}/members/${owner.user.id}/grades`, { gradeIds: [] })).status).toBe(403);
		expect((await owner.req('PUT', `/api/w/${wid}/members/${member.user.id}/grades`, { gradeIds: ['admin'] })).status).toBe(200);
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

describe('mentions, réponses et navigation', () => {
	it('compte les mentions non lues et rattache les réponses', async () => {
		const { owner, member, wid, general, announcements } = await workspaceWithMember();
		const first = await member.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'question ?' });
		const reply = await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, {
			body: `<@${member.user.id}> réponse`,
			replyTo: first.data.id,
		});
		expect(reply.data.replyTo).toEqual({ id: first.data.id, userId: member.user.id, body: 'question ?' });
		const crossChannel = await owner.req('POST', `/api/w/${wid}/channels/${announcements.id}/messages`, { body: 'x', replyTo: first.data.id });
		expect(crossChannel.status).toBe(400);

		const bob = await member.socket(wid);
		const hello = (await bob.next('hello')) as Extract<ServerEvent, { t: 'hello' }>;
		expect(hello.unread[general.id]).toBe(1);
		expect(hello.mentions[general.id]).toBe(1);
		bob.ws.close(1000);
	});

	it('charge une fenêtre autour d’un message puis la suite', async () => {
		const { owner, wid, general } = await workspaceWithMember();
		const ids: number[] = [];
		for (let i = 1; i <= 60; i++) {
			ids.push((await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: `n${i}` })).data.id);
		}
		const around = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages?around=${ids[29]}`);
		expect(around.data.messages.map((m) => m.body)[0]).toBe('n5');
		expect(around.data.messages).toHaveLength(50);
		expect(around.data).toMatchObject({ hasMore: true, hasNewer: true });
		const after = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages?after=${around.data.messages.at(-1)!.id}`);
		expect(after.data.messages.map((m) => m.body)).toEqual(['n55', 'n56', 'n57', 'n58', 'n59', 'n60']);
		expect(after.data.hasNewer).toBe(false);
	});

	it('cherche en plein texte, sans accents ni casse', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		await owner.req('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'Mise en production du launcher ce soir' });
		await owner.req('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'Réunion générale demain' });
		const hits = await member.req<SearchHit[]>('GET', `/api/w/${wid}/search?q=${encodeURIComponent('produc')}`);
		expect(hits.data).toHaveLength(1);
		expect(hits.data[0]!.snippet).toContain('[[production]]');
		const folded = await member.req<SearchHit[]>('GET', `/api/w/${wid}/search?q=${encodeURIComponent('GENERALE')}`);
		expect(folded.data.map((h) => h.message.body)).toEqual(['Réunion générale demain']);
		const syntax = await member.req<SearchHit[]>('GET', `/api/w/${wid}/search?q=${encodeURIComponent('"AND (')}`);
		expect(syntax.status).toBe(200);
	});

	it('change la couleur d’accent de l’espace', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		expect((await member.req('PATCH', `/api/w/${wid}/info`, { accent: '#2563eb' })).status).toBe(403);
		expect((await owner.req('PATCH', `/api/w/${wid}/info`, { accent: 'rouge' })).status).toBe(400);
		expect((await owner.req('PATCH', `/api/w/${wid}/info`, { accent: '#2563eb' })).status).toBe(200);
		expect((await member.req<WorkspaceDetail>('GET', `/api/w/${wid}/info`)).data.accent).toBe('#2563EB');
	});
});

describe('drive par salon', () => {
	const upload = (client: Client, wid: string, cid: string, name: string, folder?: string) =>
		client.req<DriveFile>('POST', `/api/w/${wid}/channels/${cid}/drive/files${folder ? `?folder=${folder}` : ''}`, `contenu de ${name}`, {
			'content-type': 'text/plain',
			'x-file-name': encodeURIComponent(name),
		});

	it('gère dossiers et fichiers avec les droits', async () => {
		const { owner, member, wid, general, announcements } = await workspaceWithMember();
		const folder = await member.req<DriveFolder>('POST', `/api/w/${wid}/channels/${general.id}/drive/folders`, { name: 'Notes de version' });
		expect(folder.status).toBe(200);
		const file = await upload(member, wid, general.id, 'v2.4.txt', folder.data.id);
		expect(file.status).toBe(201);
		const inFolder = await owner.req<DriveListing>('GET', `/api/w/${wid}/channels/${general.id}/drive?folder=${folder.data.id}`);
		expect(inFolder.data.files.map((f) => f.name)).toEqual(['v2.4.txt']);
		expect(inFolder.data.path.map((f) => f.name)).toEqual(['Notes de version']);

		const ownerFile = await upload(owner, wid, general.id, 'admin.txt');
		expect((await member.req('DELETE', `/api/w/${wid}/drive/files/${ownerFile.data.id}`)).status).toBe(403);
		expect((await member.req<DriveFile>('PATCH', `/api/w/${wid}/drive/files/${file.data.id}`, { name: 'v2.4-final.txt', folderId: null })).data).toMatchObject({
			name: 'v2.4-final.txt',
			folderId: null,
		});
		expect((await upload(member, wid, announcements.id, 'x.txt')).status).toBe(403);

		expect((await owner.req('DELETE', `/api/w/${wid}/drive/folders/${folder.data.id}`)).status).toBe(200);
		const root = await owner.req<DriveListing>('GET', `/api/w/${wid}/channels/${general.id}/drive`);
		expect(root.data.folders).toEqual([]);
		expect(root.data.files.map((f) => f.name).sort()).toEqual(['admin.txt', 'v2.4-final.txt']);
	});

	it('range les pièces jointes et synchronise les suppressions', async () => {
		const { owner, wid, general } = await workspaceWithMember();
		const attachment = await owner.req<Attachment>('POST', `/api/w/${wid}/files`, 'pdf', { 'content-type': 'application/pdf', 'x-file-name': 'plan.pdf' });
		const message = await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: '', attachmentKey: attachment.data.key });
		const root = await owner.req<DriveListing>('GET', `/api/w/${wid}/channels/${general.id}/drive`);
		const listed = root.data.files.find((f) => f.key === attachment.data.key)!;
		expect(listed.messageId).toBe(message.data.id);

		const sock = await owner.socket(wid);
		await sock.next('hello');
		expect((await owner.req('DELETE', `/api/w/${wid}/drive/files/${listed.id}`)).status).toBe(200);
		expect(await sock.next('message_deleted')).toEqual({ t: 'message_deleted', channelId: general.id, id: message.data.id });
		sock.ws.close(1000);
	});
});

describe('vocal', () => {
	let sessions = 0;
	const sfuCalls: Array<{ path: string; body: any }> = [];

	function mockSfu() {
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			const body = init?.body ? JSON.parse(String(init.body)) : null;
			sfuCalls.push({ path: url.pathname, body });
			if (url.pathname.endsWith('/sessions/new')) {
				return Response.json({ sessionId: `S${++sessions}` });
			}
			if (url.pathname.endsWith('/tracks/new')) {
				const local = body.tracks[0].location === 'local';
				return Response.json({
					sessionDescription: { type: local ? 'answer' : 'offer', sdp: 'v=0' },
					requiresImmediateRenegotiation: !local,
					tracks: body.tracks.map((t: { trackName: string; mid?: string }) => ({ trackName: t.trackName, mid: t.mid ?? '1' })),
				});
			}
			return Response.json({});
		});
	}

	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function voiceSetup() {
		mockSfu();
		const base = await workspaceWithMember();
		const channels = await base.owner.req<Channel[]>('GET', `/api/w/${base.wid}/channels`);
		const voice = channels.data.find((c) => c.kind === 'voice')!;
		const alice = await base.owner.socket(base.wid);
		const aliceHello = (await alice.next('hello')) as Extract<ServerEvent, { t: 'hello' }>;
		const bob = await base.member.socket(base.wid);
		const bobHello = (await bob.next('hello')) as Extract<ServerEvent, { t: 'hello' }>;
		return { ...base, voice, alice, bob, aliceConn: aliceHello.connId, bobConn: bobHello.connId };
	}

	it('rejoint, publie, s’abonne et quitte', async () => {
		const { owner, member, wid, voice, general, alice, bob, aliceConn, bobConn } = await voiceSetup();
		expect((await owner.req('POST', `/api/w/${wid}/voice/join`, { channelId: general.id, connId: aliceConn })).status).toBe(404);
		expect((await owner.req('POST', `/api/w/${wid}/voice/join`, { channelId: voice.id, connId: bobConn })).status).toBe(404);

		expect((await owner.req('POST', `/api/w/${wid}/voice/session`, { connId: aliceConn, role: 'publish' })).status).toBe(404);
		const callsBefore = sfuCalls.length;
		const joined = await owner.req<{ iceServers: unknown[] }>('POST', `/api/w/${wid}/voice/join`, { channelId: voice.id, connId: aliceConn });
		expect(joined.status).toBe(200);
		expect(joined.data.iceServers).toEqual([{ urls: ['stun:stun.cloudflare.com:3478'] }]);
		// Sessions SFU créées à la première négociation : une session jamais connectée expire.
		expect(sfuCalls.slice(callsBefore).some((call) => call.path.endsWith('/sessions/new'))).toBe(false);
		const aliceSession = await openSession(owner, wid, aliceConn, 'publish');

		const offer = { type: 'offer', sdp: 'v=0' };
		const stolen = await member.req('POST', `/api/w/${wid}/voice/tracks`, {
			connId: bobConn,
			sessionId: aliceSession,
			sessionDescription: offer,
			tracks: [{ location: 'local', mid: '0', trackName: 'mic' }],
		});
		expect(stolen.status).toBe(403);

		const published = await owner.req('POST', `/api/w/${wid}/voice/tracks`, {
			connId: aliceConn,
			sessionId: aliceSession,
			sessionDescription: offer,
			tracks: [{ location: 'local', mid: '0', trackName: 'mic' }],
		});
		expect(published.status).toBe(200);
		bob.drain();
		await owner.req('POST', `/api/w/${wid}/voice/tracks`, {
			connId: aliceConn,
			sessionId: aliceSession,
			sessionDescription: offer,
			tracks: [{ location: 'local', mid: '1', trackName: 'cam' }],
		});
		const state = (await bob.next('voice')) as Extract<ServerEvent, { t: 'voice' }>;
		expect(state.participants).toMatchObject([{ userId: owner.user.id, tracks: ['mic', 'cam'], muted: false }]);

		const outsider = await member.req('POST', `/api/w/${wid}/voice/tracks`, {
			connId: bobConn,
			sessionId: 'S999',
			tracks: [{ location: 'remote', sessionId: aliceSession, trackName: 'mic' }],
		});
		expect(outsider.status).toBe(403);

		await member.req('POST', `/api/w/${wid}/voice/join`, { channelId: voice.id, connId: bobConn });
		const bobPublish = await openSession(member, wid, bobConn, 'publish');
		const bobReceive = await openSession(member, wid, bobConn, 'receive');
		const onPublishSession = await member.req('POST', `/api/w/${wid}/voice/tracks`, {
			connId: bobConn,
			sessionId: bobPublish,
			tracks: [{ location: 'remote', sessionId: aliceSession, trackName: 'mic' }],
		});
		expect(onPublishSession.status).toBe(403);
		const pulled = await member.req<{ requiresImmediateRenegotiation: boolean }>('POST', `/api/w/${wid}/voice/tracks`, {
			connId: bobConn,
			sessionId: bobReceive,
			tracks: [{ location: 'remote', sessionId: aliceSession, trackName: 'mic' }],
		});
		expect(pulled.data.requiresImmediateRenegotiation).toBe(true);
		const answer = await member.req('PUT', `/api/w/${wid}/voice/renegotiate`, {
			connId: bobConn,
			sessionId: bobReceive,
			sessionDescription: { type: 'answer', sdp: 'v=0' },
		});
		expect(answer.status).toBe(200);
		expect(sfuCalls.at(-1)!.path).toBe(`/v1/apps/8da7b4df0958febdfb5af2d7f19b4238/sessions/${bobReceive}/renegotiate`);

		alice.ws.send(JSON.stringify({ t: 'voice_update', muted: true, video: true }));
		bob.drain();
		const muted = (await bob.next('voice')) as Extract<ServerEvent, { t: 'voice' }>;
		expect(muted.participants.find((p) => p.userId === owner.user.id)).toMatchObject({ muted: true, video: true });

		alice.ws.close(1000);
		const afterClose = (await bob.next('voice')) as Extract<ServerEvent, { t: 'voice' }>;
		expect(afterClose.participants.map((p) => p.userId)).toEqual([member.user.id]);

		expect((await member.req('POST', `/api/w/${wid}/voice/leave`, { connId: bobConn })).status).toBe(200);
		const empty = (await bob.next('voice')) as Extract<ServerEvent, { t: 'voice' }>;
		expect(empty.participants).toEqual([]);
		bob.ws.close(1000);
	});

	it('publie des pistes numérotées et les retire à la fermeture', async () => {
		const { owner, wid, voice, alice, bob, aliceConn } = await voiceSetup();
		await owner.req('POST', `/api/w/${wid}/voice/join`, { channelId: voice.id, connId: aliceConn });
		const sessionId = await openSession(owner, wid, aliceConn, 'publish');
		const offer = { type: 'offer', sdp: 'v=0' };
		for (const [mid, trackName] of [['0', 'mic'], ['1', 'cam-1']]) {
			expect((await owner.req('POST', `/api/w/${wid}/voice/tracks`, { connId: aliceConn, sessionId, sessionDescription: offer, tracks: [{ location: 'local', mid, trackName }] })).status).toBe(200);
		}
		expect(
			(await owner.req('POST', `/api/w/${wid}/voice/tracks`, { connId: aliceConn, sessionId, sessionDescription: offer, tracks: [{ location: 'local', mid: '2', trackName: 'webcam' }] })).status,
		).toBe(403);
		bob.drain();
		const closed = await owner.req('PUT', `/api/w/${wid}/voice/tracks/close`, { connId: aliceConn, sessionId, sessionDescription: offer, tracks: [{ mid: '1' }], trackNames: ['cam-1'] });
		expect(closed.status).toBe(200);
		const state = (await bob.next('voice')) as Extract<ServerEvent, { t: 'voice' }>;
		expect(state.participants[0]!.tracks).toEqual(['mic']);
		const replaced = await owner.req('POST', `/api/w/${wid}/voice/session`, { connId: aliceConn, role: 'publish' });
		expect(replaced.status).toBe(409);
		expect((await owner.req('POST', `/api/w/${wid}/voice/diag`, { kind: 'pc_failed', ice: 'failed' })).status).toBe(200);
		alice.ws.close(1000);
		bob.ws.close(1000);
	});

	it('répond 504 quand le serveur vocal reste muet', async () => {
		const { owner, wid, voice, alice, bob, aliceConn } = await voiceSetup();
		await owner.req('POST', `/api/w/${wid}/voice/join`, { channelId: voice.id, connId: aliceConn });
		const sessionId = await openSession(owner, wid, aliceConn, 'publish');
		const real = globalThis.fetch;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			if (url.includes('/tracks/new')) {
				throw new DOMException('Délai dépassé', 'TimeoutError');
			}
			return real(input, init);
		});
		const published = await owner.req('POST', `/api/w/${wid}/voice/tracks`, {
			connId: aliceConn,
			sessionId,
			sessionDescription: { type: 'offer', sdp: 'v=0' },
			tracks: [{ location: 'local', mid: '0', trackName: 'mic' }],
		});
		expect(published.status).toBe(504);
		alice.ws.close(1000);
		bob.ws.close(1000);
	});

	it('accepte les messages dans le chat d’un salon vocal', async () => {
		const { owner, wid, voice } = await voiceSetup();
		const posted = await owner.req<Message>('POST', `/api/w/${wid}/channels/${voice.id}/messages`, { body: 'lien de la réunion' });
		expect(posted.status).toBe(200);
		const page = await owner.req<MessagePage>('GET', `/api/w/${wid}/channels/${voice.id}/messages`);
		expect(page.data.messages.map((m) => m.body)).toEqual(['lien de la réunion']);
	});

	it('applique la limite de places aux membres', async () => {
		const { owner, member, wid, voice, alice, bob, aliceConn, bobConn } = await voiceSetup();
		await owner.req('PATCH', `/api/w/${wid}/channels/${voice.id}`, { userLimit: 1 });
		expect((await owner.req('POST', `/api/w/${wid}/voice/join`, { channelId: voice.id, connId: aliceConn })).status).toBe(200);
		const full = await member.req<{ error: string }>('POST', `/api/w/${wid}/voice/join`, { channelId: voice.id, connId: bobConn });
		expect(full).toEqual({ status: 403, data: { error: 'Salon complet' } });
		alice.ws.close(1000);
		bob.ws.close(1000);
	});
});

describe('compatibilité des connexions', () => {
	it('accepte une connexion malgré un socket à l’ancien format', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const legacy = await member.socket(wid);
		await legacy.next('hello');
		const stub = env.WORKSPACE.getByName(wid);
		await runInDurableObject(stub, (_instance, state) => {
			for (const ws of state.getWebSockets()) {
				ws.serializeAttachment({ id: member.user.id, name: 'Ancien', role: 'member' });
			}
		});
		const fresh = await owner.socket(wid);
		const hello = (await fresh.next('hello')) as Extract<ServerEvent, { t: 'hello' }>;
		expect(hello.online).toEqual([owner.user.id]);
		fresh.ws.close(1000);
	});
});

describe('grades et permissions', () => {
	const P = { MANAGE_GRADES: 4, MANAGE_CHANNELS: 8, KICK_MEMBERS: 16, VIEW_CHANNEL: 64, SEND_MESSAGES: 128, MANAGE_MESSAGES: 512, VOICE_CONNECT: 4096, VOICE_SPEAK: 8192 };

	async function team() {
		const base = await workspaceWithMember();
		const carol = await signup('Carol');
		const invite = await base.owner.req<{ code: string }>('POST', `/api/w/${base.wid}/invites`);
		await carol.req('POST', `/api/invites/${invite.data.code}/accept`);
		const modo = await base.owner.req<Grade>('POST', `/api/w/${base.wid}/grades`, { name: 'Modo', color: '#2563eb', permissions: P.MANAGE_GRADES | P.KICK_MEMBERS | P.MANAGE_MESSAGES });
		expect(modo.status).toBe(201);
		expect((await base.owner.req('PUT', `/api/w/${base.wid}/members/${base.member.user.id}/grades`, { gradeIds: [modo.data.id] })).status).toBe(200);
		return { ...base, bob: base.member, carol, modo: modo.data };
	}

	it('respecte la hiérarchie des grades', async () => {
		const { owner, bob, carol, wid, modo } = await team();
		const grades = await owner.req<Grade[]>('GET', `/api/w/${wid}/grades`);
		expect(grades.data.map((g) => [g.name, g.position])).toEqual([
			['Admin', 2],
			['Modo', 1],
			['Membre', 0],
		]);
		expect((await bob.req('PATCH', `/api/w/${wid}/grades/admin`, { name: 'Pirate' })).status).toBe(403);
		expect((await bob.req('PUT', `/api/w/${wid}/members/${bob.user.id}/grades`, { gradeIds: [modo.id, 'admin'] })).status).toBe(403);
		expect((await bob.req('POST', `/api/w/${wid}/grades`, { name: 'Salons', permissions: P.MANAGE_CHANNELS })).status).toBe(403);
		const helper = await bob.req<Grade>('POST', `/api/w/${wid}/grades`, { name: 'Aide', permissions: P.MANAGE_MESSAGES });
		expect(helper.status).toBe(201);
		expect((await bob.req('PUT', `/api/w/${wid}/members/${carol.user.id}/grades`, { gradeIds: [helper.data.id] })).status).toBe(200);
		expect((await bob.req('DELETE', `/api/w/${wid}/members/${owner.user.id}`)).status).toBe(403);
		expect((await bob.req('DELETE', `/api/w/${wid}/members/${carol.user.id}`)).status).toBe(200);
		expect((await bob.req('DELETE', `/api/w/${wid}/grades/default`)).status).toBe(400);
	});

	it('cache un salon privé et ses messages', async () => {
		const { owner, bob, carol, wid, modo } = await team();
		const staff = await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'staff' });
		const set = await owner.req('PUT', `/api/w/${wid}/channels/${staff.data.id}/overrides`, {
			overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL }, [modo.id]: { allow: P.VIEW_CHANNEL, deny: 0 } },
		});
		expect(set.status).toBe(200);
		const carolSocket = await carol.socket(wid);
		await carolSocket.next('hello');
		const bobSocket = await bob.socket(wid);
		await bobSocket.next('hello');
		await owner.req('POST', `/api/w/${wid}/channels/${staff.data.id}/messages`, { body: 'réunion secrète' });
		expect(((await bobSocket.next('message')) as Extract<ServerEvent, { t: 'message' }>).message.body).toBe('réunion secrète');
		expect((await carol.req<Channel[]>('GET', `/api/w/${wid}/channels`)).data.map((c) => c.name)).not.toContain('staff');
		expect((await carol.req('GET', `/api/w/${wid}/channels/${staff.data.id}/messages`)).status).toBe(404);
		expect((await carol.req<SearchHit[]>('GET', `/api/w/${wid}/search?q=secrete`)).data).toEqual([]);
		expect((await bob.req<SearchHit[]>('GET', `/api/w/${wid}/search?q=secrete`)).data).toHaveLength(1);
		expect((await carol.req('POST', `/api/w/${wid}/channels/${staff.data.id}/messages`, { body: 'x' })).status).toBe(404);
		await expect(carolSocket.next('message')).rejects.toThrow('timeout');

		// Grade attribué en direct : Carol voit le salon sans recharger.
		await owner.req('PUT', `/api/w/${wid}/members/${carol.user.id}/grades`, { gradeIds: [modo.id] });
		const access = (await carolSocket.next('access')) as Extract<ServerEvent, { t: 'access' }>;
		expect(access.channels.map((c) => c.name)).toContain('staff');
		carolSocket.ws.close(1000);
		bobSocket.ws.close(1000);
	});

	it('applique les permissions vocales et la modération', async () => {
		mockVoice();
		const { owner, bob, wid } = await team();
		const channels = await owner.req<Channel[]>('GET', `/api/w/${wid}/channels`);
		const voice = channels.data.find((c) => c.kind === 'voice')!;
		await owner.req('PUT', `/api/w/${wid}/channels/${voice.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VOICE_SPEAK } } });
		const ownerSocket = await owner.socket(wid);
		const ownerConn = ((await ownerSocket.next('hello')) as Extract<ServerEvent, { t: 'hello' }>).connId;
		const bobSocket = await bob.socket(wid);
		const hello = (await bobSocket.next('hello')) as Extract<ServerEvent, { t: 'hello' }>;
		expect(hello.perms[voice.id]! & P.VOICE_SPEAK).toBe(0);
		const joined = await bob.req('POST', `/api/w/${wid}/voice/join`, { channelId: voice.id, connId: hello.connId });
		expect(joined.status).toBe(200);
		const mic = await bob.req('POST', `/api/w/${wid}/voice/tracks`, {
			connId: hello.connId,
			sessionId: await openSession(bob, wid, hello.connId, 'publish'),
			sessionDescription: { type: 'offer', sdp: 'v=0' },
			tracks: [{ location: 'local', mid: '0', trackName: 'mic' }],
		});
		expect(mic.status).toBe(403);
		await owner.req('POST', `/api/w/${wid}/voice/join`, { channelId: voice.id, connId: ownerConn });
		expect((await bob.req('POST', `/api/w/${wid}/voice/moderate`, { userId: owner.user.id, action: 'mute' })).status).toBe(403);
		expect((await owner.req('POST', `/api/w/${wid}/voice/moderate`, { userId: bob.user.id, action: 'kick' })).status).toBe(200);
		expect(((await bobSocket.next('voice_ended')) as Extract<ServerEvent, { t: 'voice_ended' }>).reason).toContain('retiré du salon vocal');
		await owner.req('PUT', `/api/w/${wid}/channels/${voice.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VOICE_CONNECT } } });
		await bobSocket.next('access');
		expect((await bob.req('POST', `/api/w/${wid}/voice/join`, { channelId: voice.id, connId: hello.connId })).status).toBe(403);
		ownerSocket.ws.close(1000);
		bobSocket.ws.close(1000);
		vi.restoreAllMocks();
	});
});

async function openSession(client: Client, wid: string, connId: string, role: 'publish' | 'receive') {
	const created = await client.req<{ sessionId: string }>('POST', `/api/w/${wid}/voice/session`, { connId, role });
	expect(created.status).toBe(200);
	return created.data.sessionId;
}

function mockVoice() {
	let n = 0;
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		const body = init?.body ? JSON.parse(String(init.body)) : null;
		if (url.pathname.endsWith('/sessions/new')) {
			return Response.json({ sessionId: `V${++n}` });
		}
		if (url.pathname.endsWith('/tracks/new')) {
			return Response.json({ sessionDescription: { type: 'answer', sdp: 'v=0' }, tracks: body.tracks.map((t: { trackName: string }) => ({ trackName: t.trackName, mid: '0' })) });
		}
		return Response.json({});
	});
}
