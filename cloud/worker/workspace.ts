import { DurableObject } from 'cloudflare:workers';

import { LIMITS, type Attachment, type Channel, type ChannelInput, type ClientEvent, type Message, type MessagePage, type Role, type ServerEvent } from '../shared/types';
import { err, ok, type Result } from './result';

export interface Actor {
	id: string;
	name: string;
	role: Role;
}

type ChannelRow = {
	id: string;
	name: string;
	topic: string;
	category: string;
	read_only: number;
	position: number;
	created_at: number;
};

type MessageRow = {
	id: number;
	channel_id: string;
	user_id: string;
	body: string;
	attachment: string | null;
	created_at: number;
	edited_at: number | null;
};

const PAGE_SIZE = 50;

const isStaff = (actor: Actor) => actor.role !== 'member';

const toChannel = (row: ChannelRow): Channel => ({
	id: row.id,
	name: row.name,
	topic: row.topic,
	category: row.category,
	readOnly: row.read_only === 1,
	position: row.position,
	createdAt: row.created_at,
});

const toMessage = (row: MessageRow): Message => ({
	id: row.id,
	channelId: row.channel_id,
	userId: row.user_id,
	body: row.body,
	attachment: row.attachment ? (JSON.parse(row.attachment) as Attachment) : null,
	createdAt: row.created_at,
	editedAt: row.edited_at,
});

export function normalizeChannelName(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^\p{L}\p{N}_-]/gu, '')
		.slice(0, LIMITS.channelNameLength);
}

export class Workspace extends DurableObject<Env> {
	private readonly sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS channels (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				topic TEXT NOT NULL DEFAULT '',
				category TEXT NOT NULL DEFAULT '',
				read_only INTEGER NOT NULL DEFAULT 0,
				position INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				channel_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				body TEXT NOT NULL,
				attachment TEXT,
				created_at INTEGER NOT NULL,
				edited_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS messages_channel ON messages (channel_id, id);
			CREATE TABLE IF NOT EXISTS reads (
				user_id TEXT NOT NULL,
				channel_id TEXT NOT NULL,
				last_read_id INTEGER NOT NULL,
				PRIMARY KEY (user_id, channel_id)
			);
		`);
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	setup(): Channel[] {
		const { n } = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM channels').one();
		if (n === 0) {
			const now = Date.now();
			this.sql.exec(
				'INSERT INTO channels (id, name, topic, category, read_only, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)',
				crypto.randomUUID(), 'général', 'Discussions de l’équipe', '', 0, 0, now,
				crypto.randomUUID(), 'annonces', 'Annonces officielles, lecture seule', '', 1, 1, now,
			);
		}
		return this.channels();
	}

	channels(): Channel[] {
		return this.sql
			.exec<ChannelRow>('SELECT * FROM channels ORDER BY category, position, name')
			.toArray()
			.map(toChannel);
	}

	createChannel(actor: Actor, input: ChannelInput): Result<Channel> {
		if (!isStaff(actor)) {
			return err(403, 'Réservé aux administrateurs');
		}
		const name = normalizeChannelName(input.name ?? '');
		if (!name) {
			return err(400, 'Nom de salon invalide');
		}
		if (this.channelByName(name)) {
			return err(409, 'Un salon porte déjà ce nom');
		}
		const { max } = this.sql.exec<{ max: number | null }>('SELECT MAX(position) AS max FROM channels').one();
		const row = this.sql
			.exec<ChannelRow>(
				'INSERT INTO channels (id, name, topic, category, read_only, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
				crypto.randomUUID(),
				name,
				(input.topic ?? '').trim().slice(0, LIMITS.topicLength),
				(input.category ?? '').trim().slice(0, LIMITS.categoryLength),
				input.readOnly ? 1 : 0,
				input.position ?? (max ?? -1) + 1,
				Date.now(),
			)
			.one();
		const channel = toChannel(row);
		this.broadcast({ t: 'channel_upsert', channel });
		return ok(channel);
	}

	updateChannel(actor: Actor, id: string, input: ChannelInput): Result<Channel> {
		if (!isStaff(actor)) {
			return err(403, 'Réservé aux administrateurs');
		}
		const current = this.channelRow(id);
		if (!current) {
			return err(404, 'Salon introuvable');
		}
		const name = input.name === undefined ? current.name : normalizeChannelName(input.name);
		if (!name) {
			return err(400, 'Nom de salon invalide');
		}
		const clash = this.channelByName(name);
		if (clash && clash.id !== id) {
			return err(409, 'Un salon porte déjà ce nom');
		}
		const row = this.sql
			.exec<ChannelRow>(
				'UPDATE channels SET name = ?, topic = ?, category = ?, read_only = ?, position = ? WHERE id = ? RETURNING *',
				name,
				input.topic === undefined ? current.topic : input.topic.trim().slice(0, LIMITS.topicLength),
				input.category === undefined ? current.category : input.category.trim().slice(0, LIMITS.categoryLength),
				input.readOnly === undefined ? current.read_only : input.readOnly ? 1 : 0,
				input.position ?? current.position,
				id,
			)
			.one();
		const channel = toChannel(row);
		this.broadcast({ t: 'channel_upsert', channel });
		return ok(channel);
	}

	async deleteChannel(actor: Actor, id: string): Promise<Result<null>> {
		if (!isStaff(actor)) {
			return err(403, 'Réservé aux administrateurs');
		}
		if (!this.channelRow(id)) {
			return err(404, 'Salon introuvable');
		}
		const { n } = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM channels').one();
		if (n <= 1) {
			return err(400, 'Impossible de supprimer le dernier salon');
		}
		const keys = this.sql
			.exec<{ attachment: string }>('SELECT attachment FROM messages WHERE channel_id = ? AND attachment IS NOT NULL', id)
			.toArray()
			.map((row) => (JSON.parse(row.attachment) as Attachment).key);
		this.sql.exec('DELETE FROM messages WHERE channel_id = ?', id);
		this.sql.exec('DELETE FROM reads WHERE channel_id = ?', id);
		this.sql.exec('DELETE FROM channels WHERE id = ?', id);
		this.broadcast({ t: 'channel_deleted', id });
		await this.deleteFiles(keys);
		return ok(null);
	}

	listMessages(channelId: string, before?: number): Result<MessagePage> {
		if (!this.channelRow(channelId)) {
			return err(404, 'Salon introuvable');
		}
		const rows = this.sql
			.exec<MessageRow>(
				'SELECT * FROM messages WHERE channel_id = ? AND id < ? ORDER BY id DESC LIMIT ?',
				channelId,
				before ?? Number.MAX_SAFE_INTEGER,
				PAGE_SIZE + 1,
			)
			.toArray();
		const hasMore = rows.length > PAGE_SIZE;
		return ok({ messages: rows.slice(0, PAGE_SIZE).reverse().map(toMessage), hasMore });
	}

	postMessage(actor: Actor, channelId: string, body: string, attachment: Attachment | null): Result<Message> {
		const channel = this.channelRow(channelId);
		if (!channel) {
			return err(404, 'Salon introuvable');
		}
		if (channel.read_only && !isStaff(actor)) {
			return err(403, 'Salon en lecture seule');
		}
		const text = body.trim();
		if (!text && !attachment) {
			return err(400, 'Message vide');
		}
		if (text.length > LIMITS.messageLength) {
			return err(400, `Message trop long (${LIMITS.messageLength} caractères max)`);
		}
		const row = this.sql
			.exec<MessageRow>(
				'INSERT INTO messages (channel_id, user_id, body, attachment, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
				channelId,
				actor.id,
				text,
				attachment ? JSON.stringify(attachment) : null,
				Date.now(),
			)
			.one();
		this.setRead(actor.id, channelId, row.id);
		const message = toMessage(row);
		this.broadcast({ t: 'message', message });
		return ok(message);
	}

	editMessage(actor: Actor, id: number, body: string): Result<Message> {
		const current = this.messageRow(id);
		if (!current) {
			return err(404, 'Message introuvable');
		}
		if (current.user_id !== actor.id) {
			return err(403, 'Seul l’auteur peut modifier ce message');
		}
		const text = body.trim();
		if (!text && !current.attachment) {
			return err(400, 'Message vide');
		}
		if (text.length > LIMITS.messageLength) {
			return err(400, `Message trop long (${LIMITS.messageLength} caractères max)`);
		}
		const row = this.sql.exec<MessageRow>('UPDATE messages SET body = ?, edited_at = ? WHERE id = ? RETURNING *', text, Date.now(), id).one();
		const message = toMessage(row);
		this.broadcast({ t: 'message_updated', message });
		return ok(message);
	}

	async deleteMessage(actor: Actor, id: number): Promise<Result<null>> {
		const current = this.messageRow(id);
		if (!current) {
			return err(404, 'Message introuvable');
		}
		if (current.user_id !== actor.id && !isStaff(actor)) {
			return err(403, 'Suppression non autorisée');
		}
		this.sql.exec('DELETE FROM messages WHERE id = ?', id);
		this.broadcast({ t: 'message_deleted', channelId: current.channel_id, id });
		if (current.attachment) {
			await this.deleteFiles([(JSON.parse(current.attachment) as Attachment).key]);
		}
		return ok(null);
	}

	markRead(userId: string, channelId: string): void {
		const { max } = this.sql.exec<{ max: number | null }>('SELECT MAX(id) AS max FROM messages WHERE channel_id = ?', channelId).one();
		if (max !== null) {
			this.setRead(userId, channelId, max);
		}
	}

	unread(userId: string): Record<string, number> {
		const rows = this.sql
			.exec<{ channel_id: string; n: number }>(
				`SELECT m.channel_id AS channel_id, COUNT(*) AS n
				FROM messages m
				LEFT JOIN reads r ON r.channel_id = m.channel_id AND r.user_id = ?1
				WHERE m.id > COALESCE(r.last_read_id, 0) AND m.user_id != ?1
				GROUP BY m.channel_id`,
				userId,
			)
			.toArray();
		return Object.fromEntries(rows.map((row) => [row.channel_id, row.n]));
	}

	// Nouveau membre : l'historique ne compte pas comme non lu.
	memberJoined(userId: string): void {
		for (const { channel_id, max } of this.sql
			.exec<{ channel_id: string; max: number }>('SELECT channel_id, MAX(id) AS max FROM messages GROUP BY channel_id')
			.toArray()) {
			this.setRead(userId, channel_id, max);
		}
		this.broadcast({ t: 'members_changed' });
	}

	memberRemoved(userId: string): void {
		for (const ws of this.ctx.getWebSockets(userId)) {
			ws.close(4001, 'Retiré de l’espace');
		}
		this.sql.exec('DELETE FROM reads WHERE user_id = ?', userId);
		this.broadcast({ t: 'presence', userId, online: false });
		this.broadcast({ t: 'members_changed' });
	}

	membersChanged(): void {
		this.broadcast({ t: 'members_changed' });
	}

	async destroy(): Promise<void> {
		this.broadcast({ t: 'workspace_deleted' });
		for (const ws of this.ctx.getWebSockets()) {
			ws.close(4002, 'Espace supprimé');
		}
		const keys = this.sql
			.exec<{ attachment: string }>('SELECT attachment FROM messages WHERE attachment IS NOT NULL')
			.toArray()
			.map((row) => (JSON.parse(row.attachment) as Attachment).key);
		await this.ctx.storage.deleteAll();
		await this.deleteFiles(keys);
	}

	async fetch(request: Request): Promise<Response> {
		const actor = JSON.parse(request.headers.get('x-synq-actor') ?? 'null') as Actor | null;
		if (!actor || request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Bad request', { status: 400 });
		}
		const wasOnline = this.ctx.getWebSockets(actor.id).length > 0;
		const { 0: client, 1: server } = new WebSocketPair();
		this.ctx.acceptWebSocket(server, [actor.id]);
		server.serializeAttachment(actor);
		this.send(server, { t: 'hello', channels: this.channels(), online: this.onlineIds(), unread: this.unread(actor.id) });
		if (!wasOnline) {
			this.broadcast({ t: 'presence', userId: actor.id, online: true }, server);
		}
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		const actor = ws.deserializeAttachment() as Actor | null;
		if (!actor || typeof raw !== 'string') {
			return;
		}
		let event: ClientEvent;
		try {
			event = JSON.parse(raw) as ClientEvent;
		} catch {
			return;
		}
		if (event.t === 'typing' && this.channelRow(event.channelId)) {
			this.broadcast({ t: 'typing', channelId: event.channelId, userId: actor.id }, ws);
		} else if (event.t === 'read') {
			this.markRead(actor.id, event.channelId);
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		ws.close(code, reason);
		this.dropPresence(ws);
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		this.dropPresence(ws);
	}

	private dropPresence(ws: WebSocket): void {
		const actor = ws.deserializeAttachment() as Actor | null;
		if (!actor) {
			return;
		}
		const stillOnline = this.ctx.getWebSockets(actor.id).some((other) => other !== ws && other.readyState === WebSocket.OPEN);
		if (!stillOnline) {
			this.broadcast({ t: 'presence', userId: actor.id, online: false }, ws);
		}
	}

	private onlineIds(): string[] {
		const ids = new Set<string>();
		for (const ws of this.ctx.getWebSockets()) {
			const actor = ws.deserializeAttachment() as Actor | null;
			if (actor) {
				ids.add(actor.id);
			}
		}
		return [...ids];
	}

	private channelRow(id: string): ChannelRow | null {
		return this.sql.exec<ChannelRow>('SELECT * FROM channels WHERE id = ?', id).toArray()[0] ?? null;
	}

	private channelByName(name: string): ChannelRow | null {
		return this.sql.exec<ChannelRow>('SELECT * FROM channels WHERE name = ?', name).toArray()[0] ?? null;
	}

	private messageRow(id: number): MessageRow | null {
		return this.sql.exec<MessageRow>('SELECT * FROM messages WHERE id = ?', id).toArray()[0] ?? null;
	}

	private setRead(userId: string, channelId: string, messageId: number): void {
		this.sql.exec(
			`INSERT INTO reads (user_id, channel_id, last_read_id) VALUES (?, ?, ?)
			ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`,
			userId,
			channelId,
			messageId,
		);
	}

	private async deleteFiles(keys: string[]): Promise<void> {
		for (let i = 0; i < keys.length; i += 1000) {
			await this.env.FILES.delete(keys.slice(i, i + 1000));
		}
	}

	private send(ws: WebSocket, event: ServerEvent): void {
		try {
			ws.send(JSON.stringify(event));
		} catch {
			// Socket déjà fermé.
		}
	}

	private broadcast(event: ServerEvent, except?: WebSocket): void {
		const payload = JSON.stringify(event);
		for (const ws of this.ctx.getWebSockets()) {
			if (ws === except) {
				continue;
			}
			try {
				ws.send(payload);
			} catch {
				// Socket déjà fermé.
			}
		}
	}
}
