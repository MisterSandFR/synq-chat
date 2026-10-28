import { runDurableObjectAlarm } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { CANVAS_MSG, canvasFrame, type CanvasMeta, type PageComment, type PageRelated } from '../shared/canvas';
import { P } from '../shared/permissions';
import { BASE, workspaceWithMember, type Client } from './helpers';

async function snapshot(client: Client, wid: string, id: string) {
	const res = await exports.default.fetch(new Request(`${BASE}/api/w/${wid}/canvases/${id}/ws`, { headers: { Upgrade: 'websocket', cookie: client.cookie } }));
	const ws = res.webSocket!;
	ws.accept();
	const doc = new Y.Doc();
	const done = new Promise<void>((resolve, reject) => {
		ws.addEventListener('message', (event) => {
			const data = event.data as ArrayBuffer | Blob;
			void (data instanceof ArrayBuffer ? Promise.resolve(data) : data.arrayBuffer()).then((buffer) => {
				const frame = new Uint8Array(buffer);
				if (frame[0] === CANVAS_MSG.update) {
					Y.applyUpdate(doc, frame.subarray(1));
					resolve();
				}
			});
		});
		setTimeout(() => reject(new Error('timeout')), 2000);
	});
	ws.send(canvasFrame(CANVAS_MSG.sync, Y.encodeStateVector(doc)));
	await done;
	return { doc, ws };
}

const create = async (client: Client, wid: string, body: Record<string, unknown> = {}) => (await client.req<CanvasMeta>('POST', `/api/w/${wid}/canvases`, body)).data;

const list = async (client: Client, wid: string, archived = false) => (await client.req<CanvasMeta[]>('GET', `/api/w/${wid}/canvases${archived ? '?archived=1' : ''}`)).data;

describe('pages', () => {
	it('range les sous-pages sous leur parente, dans l’ordre', async () => {
		const { owner, wid } = await workspaceWithMember();
		const root = await create(owner, wid, { title: 'Racine' });
		const a = await create(owner, wid, { title: 'A', parentId: root.id });
		const b = await create(owner, wid, { title: 'B', parentId: root.id });
		expect(a.parentId).toBe(root.id);
		expect(b.position).toBeGreaterThan(a.position);

		const moved = await owner.req<CanvasMeta>('PATCH', `/api/w/${wid}/canvases/${b.id}`, { position: a.position - 1 });
		expect(moved.data.position).toBeLessThan(a.position);
		const related = await owner.req<PageRelated>('GET', `/api/w/${wid}/canvases/${root.id}/related`);
		expect(related.data.children.map((c) => c.title)).toEqual(['B', 'A']);
		expect((await owner.req<PageRelated>('GET', `/api/w/${wid}/canvases/${a.id}/related`)).data.ancestors.map((r) => r.id)).toEqual([root.id]);

		await owner.req('PATCH', `/api/w/${wid}/canvases/${a.id}`, { parentId: null, icon: '🌱', cover: 'gradient:2' });
		const fresh = (await list(owner, wid)).find((p) => p.id === a.id)!;
		expect(fresh).toMatchObject({ parentId: null, icon: '🌱', cover: 'gradient:2' });
		expect((await owner.req('PATCH', `/api/w/${wid}/canvases/${a.id}`, { cover: 'javascript:alert(1)' })).status).toBe(400);
	});

	it('refuse un déplacement qui crée un cycle', async () => {
		const { owner, wid } = await workspaceWithMember();
		const a = await create(owner, wid, { title: 'A' });
		const b = await create(owner, wid, { title: 'B', parentId: a.id });
		const c = await create(owner, wid, { title: 'C', parentId: b.id });
		expect((await owner.req('PATCH', `/api/w/${wid}/canvases/${a.id}`, { parentId: c.id })).status).toBe(409);
		expect((await owner.req('PATCH', `/api/w/${wid}/canvases/${a.id}`, { parentId: a.id })).status).toBe(409);
		expect((await owner.req('PATCH', `/api/w/${wid}/canvases/${c.id}`, { parentId: a.id })).status).toBe(200);
	});

	it('archive en cascade et restaure', async () => {
		const { owner, wid } = await workspaceWithMember();
		const a = await create(owner, wid, { title: 'A' });
		const b = await create(owner, wid, { title: 'B', parentId: a.id });
		const c = await create(owner, wid, { title: 'C', parentId: b.id });
		await owner.req('PATCH', `/api/w/${wid}/canvases/${a.id}`, { archived: true });
		expect(await list(owner, wid)).toEqual([]);
		expect((await list(owner, wid, true)).map((p) => p.id).sort()).toEqual([a.id, b.id, c.id].sort());
		expect((await owner.req('POST', `/api/w/${wid}/canvases`, { parentId: a.id })).status).toBe(404);

		// Restaurée seule, sa parente toujours archivée : elle remonte à la racine.
		await owner.req('PATCH', `/api/w/${wid}/canvases/${c.id}`, { archived: false });
		expect((await list(owner, wid)).map((p) => [p.id, p.parentId])).toEqual([[c.id, null]]);
		await owner.req('PATCH', `/api/w/${wid}/canvases/${a.id}`, { archived: false });
		expect((await list(owner, wid)).length).toBe(3);

		expect((await owner.req('DELETE', `/api/w/${wid}/canvases/${a.id}`)).status).toBe(200);
		expect((await list(owner, wid)).map((p) => p.id)).toEqual([c.id]);
		expect((await owner.req('GET', `/api/w/${wid}/canvases/${b.id}`)).status).toBe(404);
	});

	it('fait hériter une sous-page des droits du salon de sa racine', async () => {
		const { owner, member, wid, general, announcements } = await workspaceWithMember();
		const tab = (await owner.req<CanvasMeta>('POST', `/api/w/${wid}/channels/${general.id}/canvas`)).data;
		const sub = await create(owner, wid, { title: 'Sous-page', parentId: tab.id });
		const deep = await create(member, wid, { title: 'Profonde', parentId: sub.id });
		expect(deep.access).toBe('write');

		const news = (await owner.req<CanvasMeta>('POST', `/api/w/${wid}/channels/${announcements.id}/canvas`)).data;
		const readOnly = await create(owner, wid, { title: 'Lecture', parentId: news.id });
		expect((await member.req<CanvasMeta>('GET', `/api/w/${wid}/canvases/${readOnly.id}`)).data.access).toBe('read');
		expect((await member.req('POST', `/api/w/${wid}/canvases`, { parentId: readOnly.id })).status).toBe(403);
		expect((await member.req('PATCH', `/api/w/${wid}/canvases/${readOnly.id}`, { title: 'Non' })).status).toBe(403);

		await owner.req('PUT', `/api/w/${wid}/channels/${general.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } });
		expect((await member.req('GET', `/api/w/${wid}/canvases/${deep.id}`)).status).toBe(404);
		const seen = (await list(member, wid)).map((p) => p.id);
		expect(seen).not.toContain(sub.id);
		expect(seen).not.toContain(deep.id);
		// Sortir une page de son salon demande d'écrire dans la destination.
		expect((await owner.req('PATCH', `/api/w/${wid}/canvases/${tab.id}`, { parentId: readOnly.id })).status).toBe(400);
	});

	it('relève les rétroliens depuis le document', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const target = await create(owner, wid, { title: 'Cible' });
		const source = await create(owner, wid, { title: 'Source' });
		const tab = (await owner.req<CanvasMeta>('POST', `/api/w/${wid}/channels/${general.id}/canvas`)).data;

		for (const from of [source, tab]) {
			const { doc, ws } = await snapshot(owner, wid, from.id);
			const before = Y.encodeStateVector(doc);
			const p = new Y.XmlElement('paragraph');
			const link = new Y.XmlElement('pageLink');
			link.setAttribute('id', target.id);
			p.insert(0, [new Y.XmlText('Voir '), link]);
			doc.getXmlFragment('default').insert(0, [p]);
			ws.send(canvasFrame(CANVAS_MSG.update, Y.encodeStateAsUpdate(doc, before)));
			await snapshot(owner, wid, from.id);
			ws.close();
			await runDurableObjectAlarm(env.CANVAS_DOC.getByName(from.id));
		}

		const related = await owner.req<PageRelated>('GET', `/api/w/${wid}/canvases/${target.id}/related`);
		expect(related.data.backlinks.map((r) => r.id).sort()).toEqual([source.id, tab.id].sort());
		await owner.req('PUT', `/api/w/${wid}/channels/${general.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } });
		expect((await member.req<PageRelated>('GET', `/api/w/${wid}/canvases/${target.id}/related`)).data.backlinks.map((r) => r.id)).toEqual([source.id]);
	});

	it('crée une page depuis un modèle et la duplique', async () => {
		const { owner, wid } = await workspaceWithMember();
		expect((await owner.req('POST', `/api/w/${wid}/canvases`, { template: 'inconnu' })).status).toBe(400);
		const page = await create(owner, wid, { template: 'meeting' });
		expect(page).toMatchObject({ title: 'Compte-rendu de réunion', icon: '📝' });
		const { doc, ws } = await snapshot(owner, wid, page.id);
		ws.close();
		const xml = doc.getXmlFragment('default').toString();
		expect(xml).toContain('<callout emoji="📅">');
		expect(xml).toContain('Décisions');
		expect(doc.getMap('meta').get('title')).toBe('Compte-rendu de réunion');

		const copy = (await owner.req<CanvasMeta>('POST', `/api/w/${wid}/canvases/${page.id}/duplicate`)).data;
		expect(copy).toMatchObject({ title: 'Compte-rendu de réunion (copie)', icon: '📝' });
		const dup = await snapshot(owner, wid, copy.id);
		dup.ws.close();
		expect(dup.doc.getXmlFragment('default').toString()).toContain('Décisions');
		expect(dup.doc.getMap('meta').get('title')).toBe('Compte-rendu de réunion (copie)');
	});

	it('ouvre des fils de commentaires et notifie les mentions', async () => {
		const { owner, member, wid, announcements } = await workspaceWithMember();
		const news = (await owner.req<CanvasMeta>('POST', `/api/w/${wid}/channels/${announcements.id}/canvas`)).data;
		// Lecteur : répondre oui, ouvrir un fil non.
		expect((await member.req('POST', `/api/w/${wid}/canvases/${news.id}/comments`, { threadId: 't1', quote: 'x', body: 'Salut' })).status).toBe(403);
		const first = await owner.req<PageComment>('POST', `/api/w/${wid}/canvases/${news.id}/comments`, { threadId: 't1', quote: 'Ordre du jour', body: 'À revoir', mentions: [member.user.id, 'inconnu'] });
		expect(first.status).toBe(201);
		const reply = await member.req<PageComment>('POST', `/api/w/${wid}/canvases/${news.id}/comments`, { threadId: 't1', quote: 'ignoré', body: 'D’accord' });
		expect(reply.data).toMatchObject({ threadId: 't1', quote: '' });
		expect((await member.req('POST', `/api/w/${wid}/canvases/${news.id}/comments`, { threadId: 't1', body: '  ' })).status).toBe(400);

		const notes = await member.req('GET', `/api/w/${wid}/notifications`);
		expect(JSON.stringify(notes.data)).toContain('t’a mentionné dans une page');

		const resolved = await owner.req<PageComment[]>('PATCH', `/api/w/${wid}/canvases/${news.id}/comments/${first.data.id}`, { resolved: true });
		expect(resolved.data.every((c) => c.resolvedAt !== null)).toBe(true);
		expect((await member.req('DELETE', `/api/w/${wid}/canvases/${news.id}/comments/${first.data.id}`)).status).toBe(403);
		expect((await member.req('DELETE', `/api/w/${wid}/canvases/${news.id}/comments/${reply.data.id}`)).status).toBe(200);
	});

	it('accepte les pièces jointes et les sert en téléchargement', async () => {
		const { owner, wid } = await workspaceWithMember();
		const page = await create(owner, wid, {});
		const res = await exports.default.fetch(
			new Request(`${BASE}/api/w/${wid}/canvases/${page.id}/files?kind=file&name=notes.txt`, { method: 'POST', body: 'bonjour', headers: { cookie: owner.cookie, 'Content-Type': 'text/plain', 'Content-Length': '7' } }),
		);
		expect(res.status).toBe(201);
		const { url } = await res.json<{ url: string }>();
		const file = await exports.default.fetch(new Request(BASE + url, { headers: { cookie: owner.cookie } }));
		expect(file.headers.get('Content-Disposition')).toContain('notes.txt');
		expect(await file.text()).toBe('bonjour');
	});
});
