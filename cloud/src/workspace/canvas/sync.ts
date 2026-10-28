import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { CANVAS_MSG, canvasFrame } from '../../../shared/canvas';

export type SyncStatus = 'connecting' | 'synced' | 'offline';

const PING_EVERY = 30_000;

// Fournisseur minimal pour TipTap : même protocole que le DO CanvasDoc, reconnexion automatique.
export class CanvasSync {
	readonly awareness: Awareness;
	status: SyncStatus = 'connecting';
	private ws: WebSocket | null = null;
	private closed = false;
	private retry = 0;
	private timer = 0;
	private ping = 0;
	private readonly listeners = new Set<() => void>();

	constructor(
		readonly doc: Y.Doc,
		private readonly url: string,
	) {
		this.awareness = new Awareness(doc);
		doc.on('update', this.onDoc);
		this.awareness.on('update', this.onAwareness);
		this.connect();
	}

	subscribe = (listener: () => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	private setStatus(status: SyncStatus): void {
		this.status = status;
		this.listeners.forEach((listener) => listener());
	}

	private send(type: number, payload: Uint8Array): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(canvasFrame(type, payload));
		}
	}

	private onDoc = (update: Uint8Array, origin: unknown) => {
		if (origin !== this) {
			this.send(CANVAS_MSG.update, update);
		}
	};

	private onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
		if (origin !== this) {
			this.send(CANVAS_MSG.awareness, encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]));
		}
	};

	private sendLocalAwareness(): void {
		if (this.awareness.getLocalState() !== null) {
			this.send(CANVAS_MSG.awareness, encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
		}
	}

	private connect(): void {
		const ws = new WebSocket(this.url);
		ws.binaryType = 'arraybuffer';
		this.ws = ws;
		ws.onopen = () => {
			this.retry = 0;
			this.send(CANVAS_MSG.sync, Y.encodeStateVector(this.doc));
			this.sendLocalAwareness();
			this.ping = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_EVERY);
		};
		ws.onmessage = (event) => {
			if (typeof event.data === 'string') {
				return;
			}
			const data = new Uint8Array(event.data as ArrayBuffer);
			const body = data.subarray(1);
			if (data[0] === CANVAS_MSG.sync) {
				this.send(CANVAS_MSG.update, Y.encodeStateAsUpdate(this.doc, body));
			} else if (data[0] === CANVAS_MSG.update) {
				Y.applyUpdate(this.doc, body, this);
				if (this.status !== 'synced') {
					this.setStatus('synced');
				}
			} else if (data[0] === CANVAS_MSG.awareness) {
				applyAwarenessUpdate(this.awareness, body, this);
			} else if (data[0] === CANVAS_MSG.query) {
				this.sendLocalAwareness();
			}
		};
		ws.onclose = (event) => {
			window.clearInterval(this.ping);
			// Droits revus par le serveur : la page relit son accès.
			if (event.code === 4403 || event.code === 4409) {
				window.dispatchEvent(new CustomEvent('synq-canvas-access', { detail: { code: event.code } }));
				this.closed ||= event.code === 4403;
			}
			this.ws = null;
			// Curseurs des autres effacés : ils reviendront à la reconnexion.
			removeAwarenessStates(
				this.awareness,
				[...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID),
				this,
			);
			if (this.closed) {
				return;
			}
			this.setStatus('offline');
			this.timer = window.setTimeout(() => this.connect(), Math.min(10_000, 500 * 2 ** this.retry++));
		};
	}

	destroy(): void {
		this.closed = true;
		window.clearTimeout(this.timer);
		this.awareness.setLocalState(null);
		this.ws?.close();
		this.doc.off('update', this.onDoc);
		this.awareness.off('update', this.onAwareness);
		this.awareness.destroy();
	}
}

export const canvasSocketUrl = (workspaceId: string, id: string) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/w/${workspaceId}/canvases/${id}/ws`;

const COLORS = ['#E5484D', '#F76B15', '#D6A100', '#30A46C', '#12A594', '#0090FF', '#6E56CF', '#D6409F'];

export function colorFor(id: string): string {
	let hash = 0;
	for (const char of id) {
		hash = (hash * 31 + char.charCodeAt(0)) | 0;
	}
	return COLORS[Math.abs(hash) % COLORS.length]!;
}
