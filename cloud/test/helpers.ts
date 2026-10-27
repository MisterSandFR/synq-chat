import { exports } from 'cloudflare:workers';
import { expect } from 'vitest';

import type { Channel, ServerEvent, User } from '../shared/types';

export const BASE = 'https://synq.test';

export type Reply<T> = { status: number; data: T };

export class Client {
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

export async function signup(name: string): Promise<Client> {
	const client = new Client();
	const res = await client.req<User>('POST', '/api/auth/signup', { email: `${name.toLowerCase()}-${crypto.randomUUID()}@test.dev`, name, password: 'motdepasse123' });
	expect(res.status).toBe(201);
	client.user = res.data;
	return client;
}

export async function workspaceWithMember() {
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

export async function openSession(client: Client, wid: string, connId: string, role: 'publish' | 'receive') {
	const created = await client.req<{ sessionId: string }>('POST', `/api/w/${wid}/voice/session`, { connId, role });
	expect(created.status).toBe(200);
	return created.data.sessionId;
}
