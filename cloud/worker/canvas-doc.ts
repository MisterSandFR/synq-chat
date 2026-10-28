import { DurableObject } from 'cloudflare:workers';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';

import { CANVAS_LIMITS, CANVAS_MSG, canvasFrame, type TemplateNode } from '../shared/canvas';
import { updateCanvasContent } from './canvases';

export type CanvasPeer = { canvasId: string; userId: string; write: boolean };

// Identifiants d'awareness du socket et leur dernière horloge, pour effacer ses curseurs à la fermeture.
type Attachment = { userId: string; write: boolean; clients: Array<[number, number]> };

const COMPACT_AFTER = 200;
const FLUSH_DELAY = 3000;
const MAX_CLIENTS = 8;

type Node = Y.XmlElement | Y.XmlText | Y.XmlFragment | Y.XmlHook;

const textOf = (node: Node): string =>
	node instanceof Y.XmlText
		? (node.toDelta() as Array<{ insert: unknown }>).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('')
		: node instanceof Y.XmlHook
			? ''
			: (node.toArray() as Node[]).map(textOf).join(' ');

const LINK_NODES = new Set(['pageLink', 'subpage']);

const linksOf = (node: Node, out: string[] = []): string[] => {
	if (node instanceof Y.XmlElement && LINK_NODES.has(node.nodeName)) {
		const id = node.getAttribute('id');
		if (typeof id === 'string' && id) {
			out.push(id);
		}
	}
	if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
		(node.toArray() as Node[]).forEach((child) => linksOf(child, out));
	}
	return out;
};

const toYNode = (node: TemplateNode): Y.XmlElement | Y.XmlText => {
	if (node.type === 'text') {
		const text = new Y.XmlText();
		text.insert(0, node.text ?? '');
		return text;
	}
	const element = new Y.XmlElement(node.type);
	for (const [key, value] of Object.entries(node.attrs ?? {})) {
		element.setAttribute(key, value as string);
	}
	element.insert(0, (node.content ?? []).map(toYNode));
	return element;
};

// Un objet par canevas : état Yjs en SQLite, relais des mises à jour et de la présence.
export class CanvasDoc extends DurableObject<Env> {
	private readonly sql: SqlStorage;
	private doc: Y.Doc | null = null;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.sql.exec('CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)');
		this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	private load(): Y.Doc {
		if (!this.doc) {
			const doc = new Y.Doc();
			const rows = this.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM updates ORDER BY id').toArray();
			doc.transact(() => rows.forEach((row) => Y.applyUpdate(doc, new Uint8Array(row.data))));
			this.doc = doc;
		}
		return this.doc;
	}

	private meta(key: string): string | null {
		return this.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value ?? null;
	}

	private setMeta(key: string, value: string): void {
		this.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', key, value);
	}

	private persist(update: Uint8Array): void {
		this.sql.exec('INSERT INTO updates (data) VALUES (?)', update);
		const { n } = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM updates').one();
		if (n > COMPACT_AFTER) {
			const state = Y.encodeStateAsUpdate(this.load());
			this.ctx.storage.transactionSync(() => {
				this.sql.exec('DELETE FROM updates');
				this.sql.exec('INSERT INTO updates (data) VALUES (?)', state);
			});
		}
	}

	private broadcast(frame: Uint8Array, except: WebSocket | null): void {
		for (const ws of this.ctx.getWebSockets()) {
			if (ws !== except) {
				try {
					ws.send(frame);
				} catch {
					// Socket déjà fermé.
				}
			}
		}
	}

	async fetch(request: Request): Promise<Response> {
		const peer = JSON.parse(request.headers.get('x-canvas-peer') ?? 'null') as CanvasPeer | null;
		if (!peer || request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Bad request', { status: 400 });
		}
		this.setMeta('canvas', peer.canvasId);
		const { 0: client, 1: server } = new WebSocketPair();
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ userId: peer.userId, write: peer.write, clients: [] } satisfies Attachment);
		// Le client répond avec ce qui manque au serveur ; les autres renvoient leur présence au nouveau venu.
		server.send(canvasFrame(CANVAS_MSG.sync, Y.encodeStateVector(this.load())));
		this.broadcast(canvasFrame(CANVAS_MSG.query, new Uint8Array()), server);
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		if (typeof raw === 'string' || raw.byteLength < 1) {
			return;
		}
		const data = new Uint8Array(raw);
		const body = data.subarray(1);
		const peer = ws.deserializeAttachment() as Attachment;
		if (data[0] === CANVAS_MSG.sync) {
			try {
				ws.send(canvasFrame(CANVAS_MSG.update, Y.encodeStateAsUpdate(this.load(), body)));
			} catch {
				// Vecteur d'état illisible.
			}
		} else if (data[0] === CANVAS_MSG.update) {
			if (peer.write && body.length <= CANVAS_LIMITS.update) {
				await this.applyUpdate(ws, peer, body);
			}
		} else if (data[0] === CANVAS_MSG.awareness && body.length <= CANVAS_LIMITS.awareness) {
			if (this.trackAwareness(ws, peer, body)) {
				this.broadcast(data, ws);
			}
		}
	}

	private async applyUpdate(ws: WebSocket, peer: Attachment, body: Uint8Array): Promise<void> {
		const doc = this.load();
		let changed: Uint8Array | null = null;
		const onUpdate = (update: Uint8Array) => {
			changed = update;
		};
		doc.on('update', onUpdate);
		try {
			Y.applyUpdate(doc, body);
		} catch {
			// Mise à jour corrompue : on repart de l'état stocké.
			this.doc = null;
			return;
		} finally {
			doc.off('update', onUpdate);
		}
		if (!changed) {
			return;
		}
		this.persist(changed);
		this.broadcast(canvasFrame(CANVAS_MSG.update, changed), ws);
		const editors = JSON.parse(this.meta('editors') ?? '[]') as string[];
		this.setMeta('editors', JSON.stringify([peer.userId, ...editors.filter((id) => id !== peer.userId)]));
		if ((await this.ctx.storage.getAlarm()) === null) {
			await this.ctx.storage.setAlarm(Date.now() + FLUSH_DELAY);
		}
	}

	private trackAwareness(ws: WebSocket, peer: Attachment, body: Uint8Array): boolean {
		try {
			const decoder = decoding.createDecoder(body);
			const count = decoding.readVarUint(decoder);
			const clients = new Map(peer.clients);
			for (let i = 0; i < count; i++) {
				const id = decoding.readVarUint(decoder);
				const clock = decoding.readVarUint(decoder);
				const state = decoding.readVarString(decoder);
				if (state === 'null') {
					clients.delete(id);
				} else {
					clients.set(id, clock);
				}
			}
			if (clients.size > MAX_CLIENTS) {
				return false;
			}
			ws.serializeAttachment({ ...peer, clients: [...clients] } satisfies Attachment);
			return true;
		} catch {
			return false;
		}
	}

	private drop(ws: WebSocket): void {
		const peer = ws.deserializeAttachment() as Attachment | null;
		if (!peer?.clients.length) {
			return;
		}
		const encoder = encoding.createEncoder();
		encoding.writeVarUint(encoder, peer.clients.length);
		for (const [id, clock] of peer.clients) {
			encoding.writeVarUint(encoder, id);
			encoding.writeVarUint(encoder, clock + 1);
			encoding.writeVarString(encoder, 'null');
		}
		this.broadcast(canvasFrame(CANVAS_MSG.awareness, encoding.toUint8Array(encoder)), ws);
	}

	async webSocketClose(ws: WebSocket): Promise<void> {
		this.drop(ws);
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		this.drop(ws);
	}

	// Titre, extrait, éditeurs et liens de pages recopiés en D1 pour les listes, cartes et rétroliens.
	async alarm(): Promise<void> {
		const canvasId = this.meta('canvas');
		if (!canvasId) {
			return;
		}
		const doc = this.load();
		const title = doc.getMap('meta').get('title');
		const fragment = doc.getXmlFragment('default');
		const excerpt = textOf(fragment).replace(/\s+/g, ' ').trim();
		const editors = JSON.parse(this.meta('editors') ?? '[]') as string[];
		this.sql.exec("DELETE FROM meta WHERE key = 'editors'");
		await updateCanvasContent(this.env.DB, canvasId, { title: typeof title === 'string' ? title : null, excerpt, editors, links: linksOf(fragment) });
	}

	// Modification côté serveur (modèle, titre, copie) relayée comme une édition.
	private commit(canvasId: string, change: (doc: Y.Doc) => void): void {
		this.setMeta('canvas', canvasId);
		const doc = this.load();
		let changed: Uint8Array | null = null;
		const onUpdate = (update: Uint8Array) => {
			changed = update;
		};
		doc.on('update', onUpdate);
		try {
			doc.transact(() => change(doc));
		} finally {
			doc.off('update', onUpdate);
		}
		if (changed) {
			this.persist(changed);
			this.broadcast(canvasFrame(CANVAS_MSG.update, changed), null);
		}
	}

	async seed(canvasId: string, title: string, blocks: TemplateNode[]): Promise<void> {
		this.commit(canvasId, (doc) => {
			doc.getMap('meta').set('title', title);
			const fragment = doc.getXmlFragment('default');
			if (fragment.length === 0) {
				fragment.insert(0, blocks.map(toYNode));
			}
		});
	}

	async setTitle(canvasId: string, title: string): Promise<void> {
		this.commit(canvasId, (doc) => doc.getMap('meta').set('title', title));
	}

	async exportState(): Promise<Uint8Array> {
		return Y.encodeStateAsUpdate(this.load());
	}

	async importState(canvasId: string, state: Uint8Array, title: string): Promise<void> {
		this.commit(canvasId, (doc) => {
			Y.applyUpdate(doc, state);
			doc.getMap('meta').set('title', title);
		});
		await this.ctx.storage.setAlarm(Date.now() + FLUSH_DELAY);
	}

	async wipe(): Promise<void> {
		for (const ws of this.ctx.getWebSockets()) {
			ws.close(4404, 'Canevas supprimé');
		}
		this.doc = null;
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
	}
}
