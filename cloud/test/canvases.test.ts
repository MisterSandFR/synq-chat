import { runDurableObjectAlarm } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { CANVAS_MSG, canvasFrame, type CanvasMeta } from '../shared/canvas';
import { P } from '../shared/permissions';
import { BASE, signup, workspaceWithMember, type Client } from './helpers';

async function canvasSocket(client: Client, wid: string, id: string) {
	const res = await exports.default.fetch(new Request(`${BASE}/api/w/${wid}/canvases/${id}/ws`, { headers: { Upgrade: 'websocket', cookie: client.cookie } }));
	const ws = res.webSocket;
	if (!ws) {
		throw new Error(`no websocket, status ${res.status}`);
	}
	ws.accept();
	const queue: Uint8Array[] = [];
	const waiters: Array<() => void> = [];
	ws.addEventListener('message', (event) => {
		// Trame binaire reçue en Blob côté client de test.
		const data = event.data as ArrayBuffer | Blob;
		void (data instanceof ArrayBuffer ? Promise.resolve(data) : data.arrayBuffer()).then((buffer) => {
			queue.push(new Uint8Array(buffer));
			waiters.splice(0).forEach((wake) => wake());
		});
	});
	const next = async (type: number): Promise<Uint8Array> => {
		for (;;) {
			const index = queue.findIndex((frame) => frame[0] === type);
			if (index >= 0) {
				return queue.splice(index, 1)[0]!.subarray(1);
			}
			await new Promise<void>((resolve, reject) => {
				waiters.push(resolve);
				setTimeout(() => reject(new Error(`timeout waiting ${type}`)), 2000);
			});
		}
	};
	// Un aller-retour de synchro garantit que les trames précédentes sont traitées.
	const snapshot = async () => {
		ws.send(canvasFrame(CANVAS_MSG.sync, Y.encodeStateVector(new Y.Doc())));
		const doc = new Y.Doc();
		Y.applyUpdate(doc, await next(CANVAS_MSG.update));
		return doc;
	};
	return { ws, next, snapshot, send: (type: number, payload: Uint8Array) => ws.send(canvasFrame(type, payload)) };
}

function paragraphUpdate(text: string, title?: string) {
	const doc = new Y.Doc();
	const p = new Y.XmlElement('paragraph');
	p.insert(0, [new Y.XmlText(text)]);
	doc.getXmlFragment('default').insert(0, [p]);
	if (title) {
		doc.getMap('meta').set('title', title);
	}
	return Y.encodeStateAsUpdate(doc);
}

const content = (doc: Y.Doc) => doc.getXmlFragment('default').toString();

describe('canevas', () => {
	it('crée, liste et décrit un canevas autonome', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const created = await owner.req<CanvasMeta>('POST', `/api/w/${wid}/canvases`, { title: '  Plan   de rentrée ' });
		expect(created.status).toBe(201);
		expect(created.data).toMatchObject({ title: 'Plan de rentrée', channelId: null, access: 'write', createdBy: owner.user.id });
		const listed = await member.req<CanvasMeta[]>('GET', `/api/w/${wid}/canvases`);
		expect(listed.data.map((c) => c.id)).toEqual([created.data.id]);
		expect((await member.req<CanvasMeta>('GET', `/api/w/${wid}/canvases/${created.data.id}`)).data.access).toBe('write');
		const outsider = await signup('Dave');
		expect((await outsider.req('GET', `/api/w/${wid}/canvases/${created.data.id}`)).status).toBeGreaterThanOrEqual(403);
	});

	it('page liée au salon : droits de la page, pas ceux du salon', async () => {
		const { owner, member, wid, general, announcements } = await workspaceWithMember();
		// Annonces : lecture seule, pas de création liée par un membre.
		expect((await member.req('POST', `/api/w/${wid}/channels/${announcements.id}/canvas`)).status).toBe(403);
		const own = await owner.req<CanvasMeta>('POST', `/api/w/${wid}/channels/${general.id}/canvas`, { title: 'Notes' });
		expect(own.status).toBe(201);
		expect((await member.req<CanvasMeta>('GET', `/api/w/${wid}/canvases/${own.data.id}`)).data.access).toBe('write');
		await owner.req('PUT', `/api/w/${wid}/access/page/${own.data.id}`, { restricted: true, rules: [] });
		expect((await member.req('GET', `/api/w/${wid}/canvases/${own.data.id}`)).status).toBe(404);
		expect((await member.req<CanvasMeta[]>('GET', `/api/w/${wid}/canvases`)).data).toEqual([]);
		const denied = await exports.default.fetch(new Request(`${BASE}/api/w/${wid}/canvases/${own.data.id}/ws`, { headers: { Upgrade: 'websocket', cookie: member.cookie } }));
		expect(denied.status).toBe(404);
	});

	it('refuse le WebSocket sans session', async () => {
		const { owner, wid } = await workspaceWithMember();
		const created = await owner.req<CanvasMeta>('POST', `/api/w/${wid}/canvases`, {});
		const res = await exports.default.fetch(new Request(`${BASE}/api/w/${wid}/canvases/${created.data.id}/ws`, { headers: { Upgrade: 'websocket' } }));
		expect(res.status).toBe(401);
	});

	it('garde l’état Yjs entre deux connexions et relaie aux autres', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const created = await owner.req<CanvasMeta>('POST', `/api/w/${wid}/canvases`, { title: 'Notes' });
		const a = await canvasSocket(owner, wid, created.data.id);
		const b = await canvasSocket(member, wid, created.data.id);
		await a.next(CANVAS_MSG.sync);
		a.send(CANVAS_MSG.update, paragraphUpdate('Bonjour', 'Plan'));
		const relayed = new Y.Doc();
		Y.applyUpdate(relayed, await b.next(CANVAS_MSG.update));
		expect(content(relayed)).toContain('Bonjour');
		expect(content(await a.snapshot())).toContain('Bonjour');
		a.ws.close();
		b.ws.close();

		const c = await canvasSocket(member, wid, created.data.id);
		expect(content(await c.snapshot())).toContain('Bonjour');
		c.ws.close();

		await runDurableObjectAlarm(env.CANVAS_DOC.getByName(created.data.id));
		const meta = await owner.req<CanvasMeta>('GET', `/api/w/${wid}/canvases/${created.data.id}`);
		expect(meta.data).toMatchObject({ title: 'Plan', excerpt: 'Bonjour', editors: [owner.user.id] });
	});

	it('ignore les mises à jour d’un lecteur', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const tab = await owner.req<CanvasMeta>('POST', `/api/w/${wid}/canvases`, { title: 'Annonce' });
		await owner.req('PUT', `/api/w/${wid}/access/page/${tab.data.id}`, { restricted: false, rules: [{ subjectId: 'default', level: 'view' }] });
		const reader = await canvasSocket(member, wid, tab.data.id);
		reader.send(CANVAS_MSG.update, paragraphUpdate('Pirate'));
		expect(content(await reader.snapshot())).not.toContain('Pirate');
		reader.ws.close();
	});

	it('n’accepte que des images et les sert sous les droits du canevas', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const created = await owner.req<CanvasMeta>('POST', `/api/w/${wid}/canvases`, {});
		const bytes = new Uint8Array([137, 80, 78, 71]).buffer;
		expect((await member.req('POST', `/api/w/${wid}/canvases/${created.data.id}/files`, bytes, { 'content-type': 'text/html' })).status).toBe(400);
		const up = await member.req<{ url: string }>('POST', `/api/w/${wid}/canvases/${created.data.id}/files`, bytes, { 'content-type': 'image/png' });
		expect(up.status).toBe(201);
		const got = await owner.raw('GET', up.data.url);
		expect(got.status).toBe(200);
		expect(got.headers.get('content-type')).toBe('image/png');
		await got.arrayBuffer();
	});

	it('réserve la suppression à l’auteur ou à un gestionnaire', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const created = await owner.req<CanvasMeta>('POST', `/api/w/${wid}/canvases`, {});
		expect((await member.req('DELETE', `/api/w/${wid}/canvases/${created.data.id}`)).status).toBe(403);
		expect((await owner.req('DELETE', `/api/w/${wid}/canvases/${created.data.id}`)).status).toBe(200);
		expect((await owner.req('GET', `/api/w/${wid}/canvases/${created.data.id}`)).status).toBe(404);
	});
});
