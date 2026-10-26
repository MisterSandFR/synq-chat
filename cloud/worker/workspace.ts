import { DurableObject } from 'cloudflare:workers';

import {
	LIMITS,
	mentionedUsers,
	type Attachment,
	type Channel,
	type ChannelInput,
	type ChannelKind,
	type ClientEvent,
	type DriveFile,
	type DriveFolder,
	type DriveListing,
	type Message,
	type MessagePage,
	type Role,
	type SearchHit,
	type ServerEvent,
	type VoiceFlags,
	type VoiceParticipant,
} from '../shared/types';
import { err, ok, type Result } from './result';

export interface Actor {
	id: string;
	name: string;
	role: Role;
}

interface Voice {
	channelId: string;
	sessionId: string;
	tracks: string[];
	muted: boolean;
	deafened: boolean;
	video: boolean;
	screen: boolean;
}

interface Conn {
	connId: string;
	actor: Actor;
	voice: Voice | null;
}

type ChannelRow = {
	id: string;
	name: string;
	kind: ChannelKind;
	topic: string;
	category: string;
	read_only: number;
	user_limit: number;
	position: number;
	created_at: number;
};

type MessageRow = {
	id: number;
	channel_id: string;
	user_id: string;
	body: string;
	attachment: string | null;
	reply_to: number | null;
	reply_user: string | null;
	reply_body: string | null;
	created_at: number;
	edited_at: number | null;
};

type FolderRow = { id: string; channel_id: string; parent_id: string | null; name: string; created_by: string; created_at: number };

type FileRow = {
	id: string;
	channel_id: string;
	folder_id: string | null;
	key: string;
	name: string;
	size: number;
	type: string;
	uploaded_by: string;
	message_id: number | null;
	created_at: number;
};

const PAGE_SIZE = 50;
const AROUND = 25;

// Une entrée par version ; jamais modifier une entrée publiée.
const MIGRATIONS = [
	`CREATE TABLE IF NOT EXISTS channels (
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
	);`,
	`ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
	ALTER TABLE channels ADD COLUMN user_limit INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE messages ADD COLUMN reply_to INTEGER;
	CREATE TABLE mentions (
		message_id INTEGER NOT NULL,
		user_id TEXT NOT NULL,
		PRIMARY KEY (message_id, user_id)
	);
	CREATE INDEX mentions_user ON mentions (user_id, message_id);
	CREATE VIRTUAL TABLE messages_fts USING fts5(body, content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
	CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
		INSERT INTO messages_fts (rowid, body) VALUES (new.id, new.body);
	END;
	CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
		INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', old.id, old.body);
		DELETE FROM mentions WHERE message_id = old.id;
	END;
	CREATE TRIGGER messages_au AFTER UPDATE OF body ON messages BEGIN
		INSERT INTO messages_fts (messages_fts, rowid, body) VALUES ('delete', old.id, old.body);
		INSERT INTO messages_fts (rowid, body) VALUES (new.id, new.body);
	END;
	INSERT INTO messages_fts (messages_fts) VALUES ('rebuild');
	CREATE TABLE folders (
		id TEXT PRIMARY KEY,
		channel_id TEXT NOT NULL,
		parent_id TEXT,
		name TEXT NOT NULL,
		created_by TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX folders_parent ON folders (channel_id, parent_id);
	CREATE TABLE files (
		id TEXT PRIMARY KEY,
		channel_id TEXT NOT NULL,
		folder_id TEXT,
		key TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		size INTEGER NOT NULL,
		type TEXT NOT NULL,
		uploaded_by TEXT NOT NULL,
		message_id INTEGER,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX files_folder ON files (channel_id, folder_id);
	CREATE INDEX files_message ON files (message_id);
	INSERT INTO files (id, channel_id, folder_id, key, name, size, type, uploaded_by, message_id, created_at)
		SELECT substr(json_extract(attachment, '$.key'), -36), channel_id, NULL, json_extract(attachment, '$.key'), json_extract(attachment, '$.name'),
			json_extract(attachment, '$.size'), json_extract(attachment, '$.type'), user_id, id, created_at
		FROM messages WHERE attachment IS NOT NULL;`,
];

const MESSAGE_SELECT = `SELECT m.*, r.user_id AS reply_user, substr(r.body, 1, 160) AS reply_body
	FROM messages m LEFT JOIN messages r ON r.id = m.reply_to`;

const isStaff = (actor: Actor) => actor.role !== 'member';

const toChannel = (row: ChannelRow): Channel => ({
	id: row.id,
	name: row.name,
	kind: row.kind,
	topic: row.topic,
	category: row.category,
	readOnly: row.read_only === 1,
	userLimit: row.user_limit,
	position: row.position,
	createdAt: row.created_at,
});

const toMessage = (row: MessageRow): Message => ({
	id: row.id,
	channelId: row.channel_id,
	userId: row.user_id,
	body: row.body,
	attachment: row.attachment ? (JSON.parse(row.attachment) as Attachment) : null,
	replyTo: row.reply_to === null ? null : { id: row.reply_to, userId: row.reply_user, body: row.reply_body },
	createdAt: row.created_at,
	editedAt: row.edited_at,
});

const toFolder = (row: FolderRow): DriveFolder => ({
	id: row.id,
	channelId: row.channel_id,
	parentId: row.parent_id,
	name: row.name,
	createdBy: row.created_by,
	createdAt: row.created_at,
});

const toFile = (row: FileRow): DriveFile => ({
	id: row.id,
	channelId: row.channel_id,
	folderId: row.folder_id,
	key: row.key,
	name: row.name,
	size: row.size,
	type: row.type,
	uploadedBy: row.uploaded_by,
	messageId: row.message_id,
	createdAt: row.created_at,
});

export function normalizeChannelName(raw: string, kind: ChannelKind = 'text'): string {
	const trimmed = raw.trim().replace(/\s+/g, ' ');
	if (kind === 'voice') {
		return trimmed.slice(0, LIMITS.channelNameLength);
	}
	return trimmed
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^\p{L}\p{N}_-]/gu, '')
		.slice(0, LIMITS.channelNameLength);
}

const cleanFileName = (raw: string) => raw.trim().replace(/[/\\\0]/g, '_').slice(0, 120);

export class Workspace extends DurableObject<Env> {
	private readonly sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.migrate();
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	private migrate(): void {
		this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)');
		const version = this.sql.exec<{ value: number }>("SELECT value FROM meta WHERE key = 'schema'").toArray()[0]?.value ?? 0;
		if (version >= MIGRATIONS.length) {
			return;
		}
		this.ctx.storage.transactionSync(() => {
			for (const step of MIGRATIONS.slice(version)) {
				this.sql.exec(step);
			}
			this.sql.exec("INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", MIGRATIONS.length);
		});
	}

	setup(): Channel[] {
		const { n } = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM channels').one();
		if (n === 0) {
			const now = Date.now();
			const insert = 'INSERT INTO channels (id, name, kind, topic, category, read_only, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
			this.sql.exec(insert, crypto.randomUUID(), 'général', 'text', 'Discussions de l’équipe', '', 0, 0, now);
			this.sql.exec(insert, crypto.randomUUID(), 'annonces', 'text', 'Annonces officielles, lecture seule', '', 1, 1, now);
			this.sql.exec(insert, crypto.randomUUID(), 'Salon vocal', 'voice', '', 'Vocal', 0, 0, now);
		}
		return this.channels();
	}

	channels(): Channel[] {
		return this.sql
			.exec<ChannelRow>("SELECT * FROM channels ORDER BY kind = 'voice', category, position, name")
			.toArray()
			.map(toChannel);
	}

	createChannel(actor: Actor, input: ChannelInput): Result<Channel> {
		if (!isStaff(actor)) {
			return err(403, 'Réservé aux administrateurs');
		}
		const kind: ChannelKind = input.kind === 'voice' ? 'voice' : 'text';
		const name = normalizeChannelName(input.name ?? '', kind);
		if (!name) {
			return err(400, 'Nom de salon invalide');
		}
		if (this.channelByName(name)) {
			return err(409, 'Un salon porte déjà ce nom');
		}
		const { max } = this.sql.exec<{ max: number | null }>('SELECT MAX(position) AS max FROM channels WHERE kind = ?', kind).one();
		const row = this.sql
			.exec<ChannelRow>(
				'INSERT INTO channels (id, name, kind, topic, category, read_only, user_limit, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
				crypto.randomUUID(),
				name,
				kind,
				(input.topic ?? '').trim().slice(0, LIMITS.topicLength),
				(input.category ?? '').trim().slice(0, LIMITS.categoryLength),
				kind === 'text' && input.readOnly ? 1 : 0,
				kind === 'voice' ? this.clampLimit(input.userLimit) : 0,
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
		const name = input.name === undefined ? current.name : normalizeChannelName(input.name, current.kind);
		if (!name) {
			return err(400, 'Nom de salon invalide');
		}
		const clash = this.channelByName(name);
		if (clash && clash.id !== id) {
			return err(409, 'Un salon porte déjà ce nom');
		}
		const row = this.sql
			.exec<ChannelRow>(
				'UPDATE channels SET name = ?, topic = ?, category = ?, read_only = ?, user_limit = ?, position = ? WHERE id = ? RETURNING *',
				name,
				input.topic === undefined ? current.topic : input.topic.trim().slice(0, LIMITS.topicLength),
				input.category === undefined ? current.category : input.category.trim().slice(0, LIMITS.categoryLength),
				current.kind === 'text' && (input.readOnly ?? current.read_only === 1) ? 1 : 0,
				current.kind === 'voice' ? this.clampLimit(input.userLimit ?? current.user_limit) : 0,
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
		const { n } = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM channels WHERE kind = 'text'").one();
		const isLastText = this.channelRow(id)?.kind === 'text' && n <= 1;
		if (isLastText) {
			return err(400, 'Impossible de supprimer le dernier salon écrit');
		}
		const keys = this.sql.exec<{ key: string }>('SELECT key FROM files WHERE channel_id = ?', id).toArray().map((row) => row.key);
		this.ctx.storage.transactionSync(() => {
			this.sql.exec('DELETE FROM messages WHERE channel_id = ?', id);
			this.sql.exec('DELETE FROM reads WHERE channel_id = ?', id);
			this.sql.exec('DELETE FROM files WHERE channel_id = ?', id);
			this.sql.exec('DELETE FROM folders WHERE channel_id = ?', id);
			this.sql.exec('DELETE FROM channels WHERE id = ?', id);
		});
		for (const ws of this.ctx.getWebSockets()) {
			const conn = this.conn(ws);
			if (conn?.voice?.channelId === id) {
				this.setVoice(ws, conn, null);
				this.send(ws, { t: 'voice_ended', reason: 'Salon supprimé' });
			}
		}
		this.broadcast({ t: 'channel_deleted', id });
		await this.deleteObjects(keys);
		return ok(null);
	}

	listMessages(channelId: string, cursor: { before?: number; after?: number; around?: number } = {}): Result<MessagePage> {
		if (!this.channelRow(channelId)) {
			return err(404, 'Salon introuvable');
		}
		const older = (before: number, limit: number) =>
			this.sql.exec<MessageRow>(`${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`, channelId, before, limit + 1).toArray();
		const newer = (from: number, limit: number) =>
			this.sql.exec<MessageRow>(`${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.id >= ? ORDER BY m.id ASC LIMIT ?`, channelId, from, limit + 1).toArray();

		if (cursor.around !== undefined) {
			const before = older(cursor.around, AROUND);
			const after = newer(cursor.around, AROUND);
			return ok({
				messages: [...before.slice(0, AROUND).reverse(), ...after.slice(0, AROUND)].map(toMessage),
				hasMore: before.length > AROUND,
				hasNewer: after.length > AROUND,
			});
		}
		if (cursor.after !== undefined) {
			const rows = newer(cursor.after + 1, PAGE_SIZE);
			return ok({ messages: rows.slice(0, PAGE_SIZE).map(toMessage), hasMore: true, hasNewer: rows.length > PAGE_SIZE });
		}
		const rows = older(cursor.before ?? Number.MAX_SAFE_INTEGER, PAGE_SIZE);
		return ok({ messages: rows.slice(0, PAGE_SIZE).reverse().map(toMessage), hasMore: rows.length > PAGE_SIZE, hasNewer: false });
	}

	postMessage(actor: Actor, channelId: string, body: string, attachment: Attachment | null, replyTo: number | null = null): Result<Message> {
		const channel = this.channelRow(channelId);
		if (!channel) {
			return err(404, 'Salon introuvable');
		}
		if (channel.kind !== 'text') {
			return err(400, 'Salon vocal : pas de messages écrits');
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
		const target = replyTo === null ? null : this.sql.exec<{ id: number }>('SELECT id FROM messages WHERE id = ? AND channel_id = ?', replyTo, channelId).toArray()[0];
		if (replyTo !== null && !target) {
			return err(400, 'Message cité introuvable');
		}
		const now = Date.now();
		const id = this.ctx.storage.transactionSync(() => {
			const row = this.sql
				.exec<{ id: number }>(
					'INSERT INTO messages (channel_id, user_id, body, attachment, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
					channelId,
					actor.id,
					text,
					attachment ? JSON.stringify(attachment) : null,
					replyTo,
					now,
				)
				.one();
			this.saveMentions(row.id, text);
			if (attachment) {
				this.insertFile(channelId, null, attachment, actor.id, row.id);
			}
			return row.id;
		});
		this.setRead(actor.id, channelId, id);
		const message = this.message(id)!;
		this.broadcast({ t: 'message', message });
		if (attachment) {
			this.broadcast({ t: 'drive', channelId });
		}
		return ok(message);
	}

	editMessage(actor: Actor, id: number, body: string): Result<Message> {
		const current = this.message(id);
		if (!current) {
			return err(404, 'Message introuvable');
		}
		if (current.userId !== actor.id) {
			return err(403, 'Seul l’auteur peut modifier ce message');
		}
		const text = body.trim();
		if (!text && !current.attachment) {
			return err(400, 'Message vide');
		}
		if (text.length > LIMITS.messageLength) {
			return err(400, `Message trop long (${LIMITS.messageLength} caractères max)`);
		}
		this.ctx.storage.transactionSync(() => {
			this.sql.exec('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', text, Date.now(), id);
			this.sql.exec('DELETE FROM mentions WHERE message_id = ?', id);
			this.saveMentions(id, text);
		});
		const message = this.message(id)!;
		this.broadcast({ t: 'message_updated', message });
		return ok(message);
	}

	async deleteMessage(actor: Actor, id: number): Promise<Result<null>> {
		const current = this.message(id);
		if (!current) {
			return err(404, 'Message introuvable');
		}
		if (current.userId !== actor.id && !isStaff(actor)) {
			return err(403, 'Suppression non autorisée');
		}
		this.ctx.storage.transactionSync(() => {
			this.sql.exec('DELETE FROM messages WHERE id = ?', id);
			this.sql.exec('DELETE FROM files WHERE message_id = ?', id);
		});
		this.broadcast({ t: 'message_deleted', channelId: current.channelId, id });
		if (current.attachment) {
			this.broadcast({ t: 'drive', channelId: current.channelId });
			await this.deleteObjects([current.attachment.key]);
		}
		return ok(null);
	}

	search(query: string): SearchHit[] {
		const terms = query
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 8)
			.map((term) => `"${term.replace(/"/g, '""')}"*`);
		if (terms.length === 0) {
			return [];
		}
		const rows = this.sql
			.exec<MessageRow & { snippet: string }>(
				`SELECT m.*, r.user_id AS reply_user, substr(r.body, 1, 160) AS reply_body, snippet(messages_fts, 0, '[[', ']]', '…', 16) AS snippet
				FROM messages_fts
				JOIN messages m ON m.id = messages_fts.rowid
				LEFT JOIN messages r ON r.id = m.reply_to
				WHERE messages_fts MATCH ?
				ORDER BY m.id DESC LIMIT 30`,
				terms.join(' '),
			)
			.toArray();
		return rows.map((row) => ({ message: toMessage(row), snippet: row.snippet }));
	}

	markRead(userId: string, channelId: string): void {
		const { max } = this.sql.exec<{ max: number | null }>('SELECT MAX(id) AS max FROM messages WHERE channel_id = ?', channelId).one();
		if (max !== null) {
			this.setRead(userId, channelId, max);
		}
	}

	unread(userId: string): { unread: Record<string, number>; mentions: Record<string, number> } {
		const rows = this.sql
			.exec<{ channel_id: string; n: number; mentions: number }>(
				`SELECT m.channel_id AS channel_id, COUNT(*) AS n, COUNT(x.user_id) AS mentions
				FROM messages m
				LEFT JOIN reads r ON r.channel_id = m.channel_id AND r.user_id = ?1
				LEFT JOIN mentions x ON x.message_id = m.id AND x.user_id = ?1
				WHERE m.id > COALESCE(r.last_read_id, 0) AND m.user_id != ?1
				GROUP BY m.channel_id`,
				userId,
			)
			.toArray();
		return {
			unread: Object.fromEntries(rows.map((row) => [row.channel_id, row.n])),
			mentions: Object.fromEntries(rows.filter((row) => row.mentions > 0).map((row) => [row.channel_id, row.mentions])),
		};
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
		const channels = new Set<string>();
		for (const ws of this.ctx.getWebSockets(userId)) {
			const voice = this.conn(ws)?.voice;
			if (voice) {
				channels.add(voice.channelId);
			}
			ws.close(4001, 'Retiré de l’espace');
		}
		this.sql.exec('DELETE FROM reads WHERE user_id = ?', userId);
		for (const channelId of channels) {
			this.broadcastVoice(channelId, userId);
		}
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
		const keys = this.sql.exec<{ key: string }>('SELECT key FROM files').toArray().map((row) => row.key);
		await this.ctx.storage.deleteAll();
		await this.deleteObjects(keys);
	}

	voiceJoin(actor: Actor, connId: string, channelId: string, sessionId: string): Result<VoiceParticipant[]> {
		const ws = this.socketFor(actor.id, connId);
		if (!ws) {
			return err(404, 'Connexion temps réel introuvable, recharge la page');
		}
		const channel = this.channelRow(channelId);
		if (!channel || channel.kind !== 'voice') {
			return err(404, 'Salon vocal introuvable');
		}
		const others = this.participants(channelId).filter((p) => p.userId !== actor.id);
		if (channel.user_limit > 0 && others.length >= channel.user_limit && !isStaff(actor)) {
			return err(403, 'Salon complet');
		}
		// Un seul vocal par personne : les autres onglets sont déconnectés.
		for (const other of this.ctx.getWebSockets(actor.id)) {
			const conn = this.conn(other);
			if (other !== ws && conn?.voice) {
				const previous = conn.voice.channelId;
				this.setVoice(other, conn, null);
				this.send(other, { t: 'voice_ended', reason: 'Vocal ouvert dans un autre onglet' });
				this.broadcastVoice(previous);
			}
		}
		const conn = this.conn(ws)!;
		const previous = conn.voice?.channelId;
		this.setVoice(ws, conn, { channelId, sessionId, tracks: [], muted: false, deafened: false, video: false, screen: false });
		if (previous && previous !== channelId) {
			this.broadcastVoice(previous);
		}
		return ok(this.broadcastVoice(channelId));
	}

	voiceLeave(actor: Actor, connId: string): void {
		const ws = this.socketFor(actor.id, connId);
		const conn = ws && this.conn(ws);
		if (ws && conn?.voice) {
			const channelId = conn.voice.channelId;
			this.setVoice(ws, conn, null);
			this.broadcastVoice(channelId);
		}
	}

	voiceOwns(actor: Actor, connId: string, sessionId: string): boolean {
		const ws = this.socketFor(actor.id, connId);
		return Boolean(ws && this.conn(ws)?.voice?.sessionId === sessionId);
	}

	voicePublished(actor: Actor, connId: string, sessionId: string, trackNames: string[]): void {
		const ws = this.socketFor(actor.id, connId);
		const conn = ws && this.conn(ws);
		if (!ws || !conn?.voice || conn.voice.sessionId !== sessionId) {
			return;
		}
		this.setVoice(ws, conn, { ...conn.voice, tracks: [...new Set([...conn.voice.tracks, ...trackNames])] });
		this.broadcastVoice(conn.voice.channelId);
	}

	// Abonnement autorisé seulement aux sessions du même salon vocal.
	voiceCanPull(actor: Actor, connId: string, sessionId: string, remoteSessionIds: string[]): boolean {
		const ws = this.socketFor(actor.id, connId);
		const voice = ws && this.conn(ws)?.voice;
		if (!voice || voice.sessionId !== sessionId) {
			return false;
		}
		const allowed = new Set(this.participants(voice.channelId).map((p) => p.sessionId));
		return remoteSessionIds.every((id) => id !== sessionId && allowed.has(id));
	}

	private conn(ws: WebSocket): Conn | null {
		return ws.deserializeAttachment() as Conn | null;
	}

	private socketFor(userId: string, connId: string): WebSocket | undefined {
		return this.ctx.getWebSockets(userId).find((ws) => this.conn(ws)?.connId === connId);
	}

	private setVoice(ws: WebSocket, conn: Conn, voice: Voice | null): void {
		conn.voice = voice;
		ws.serializeAttachment(conn);
	}

	private participants(channelId: string, exceptUser?: string, exceptSocket?: WebSocket): VoiceParticipant[] {
		const seen = new Map<string, VoiceParticipant>();
		for (const ws of this.ctx.getWebSockets()) {
			if (ws === exceptSocket) {
				continue;
			}
			const conn = this.conn(ws);
			if (conn?.voice?.channelId === channelId && conn.actor.id !== exceptUser) {
				const { sessionId, tracks, muted, deafened, video, screen } = conn.voice;
				seen.set(conn.actor.id, { userId: conn.actor.id, sessionId, tracks, muted, deafened, video, screen });
			}
		}
		return [...seen.values()];
	}

	private voiceSnapshot(exceptSocket?: WebSocket): Record<string, VoiceParticipant[]> {
		const byChannel: Record<string, VoiceParticipant[]> = {};
		for (const ws of this.ctx.getWebSockets()) {
			if (ws === exceptSocket) {
				continue;
			}
			const conn = this.conn(ws);
			if (conn?.voice) {
				const { channelId, sessionId, tracks, muted, deafened, video, screen } = conn.voice;
				(byChannel[channelId] ??= []).push({ userId: conn.actor.id, sessionId, tracks, muted, deafened, video, screen });
			}
		}
		return byChannel;
	}

	private broadcastVoice(channelId: string, exceptUser?: string, exceptSocket?: WebSocket): VoiceParticipant[] {
		const participants = this.participants(channelId, exceptUser, exceptSocket);
		this.broadcast({ t: 'voice', channelId, participants }, exceptSocket);
		return participants;
	}

	driveList(channelId: string, folderId: string | null): Result<DriveListing> {
		if (!this.channelRow(channelId)) {
			return err(404, 'Salon introuvable');
		}
		if (folderId && !this.folderRow(folderId, channelId)) {
			return err(404, 'Dossier introuvable');
		}
		const folders = this.sql
			.exec<FolderRow>('SELECT * FROM folders WHERE channel_id = ? AND parent_id IS ? ORDER BY name COLLATE NOCASE', channelId, folderId)
			.toArray()
			.map(toFolder);
		const files = this.sql
			.exec<FileRow>('SELECT * FROM files WHERE channel_id = ? AND folder_id IS ? ORDER BY created_at DESC', channelId, folderId)
			.toArray()
			.map(toFile);
		const path: DriveFolder[] = [];
		let cursor = folderId ? this.folderRow(folderId, channelId) : null;
		while (cursor && path.length < 32) {
			path.unshift(toFolder(cursor));
			cursor = cursor.parent_id ? this.folderRow(cursor.parent_id, channelId) : null;
		}
		return ok({ folders, files, path });
	}

	driveCreateFolder(actor: Actor, channelId: string, parentId: string | null, rawName: string): Result<DriveFolder> {
		const denied = this.driveDenied<DriveFolder>(actor, channelId);
		if (denied) {
			return denied;
		}
		if (parentId && !this.folderRow(parentId, channelId)) {
			return err(404, 'Dossier parent introuvable');
		}
		const name = cleanFileName(rawName);
		if (!name) {
			return err(400, 'Nom de dossier requis');
		}
		const row = this.sql
			.exec<FolderRow>(
				'INSERT INTO folders (id, channel_id, parent_id, name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
				crypto.randomUUID(),
				channelId,
				parentId,
				name,
				actor.id,
				Date.now(),
			)
			.one();
		this.broadcast({ t: 'drive', channelId });
		return ok(toFolder(row));
	}

	driveRenameFolder(actor: Actor, id: string, rawName: string): Result<DriveFolder> {
		const folder = this.sql.exec<FolderRow>('SELECT * FROM folders WHERE id = ?', id).toArray()[0];
		if (!folder) {
			return err(404, 'Dossier introuvable');
		}
		if (folder.created_by !== actor.id && !isStaff(actor)) {
			return err(403, 'Modification non autorisée');
		}
		const name = cleanFileName(rawName);
		if (!name) {
			return err(400, 'Nom de dossier requis');
		}
		const row = this.sql.exec<FolderRow>('UPDATE folders SET name = ? WHERE id = ? RETURNING *', name, id).one();
		this.broadcast({ t: 'drive', channelId: folder.channel_id });
		return ok(toFolder(row));
	}

	async driveDeleteFolder(actor: Actor, id: string): Promise<Result<null>> {
		const folder = this.sql.exec<FolderRow>('SELECT * FROM folders WHERE id = ?', id).toArray()[0];
		if (!folder) {
			return err(404, 'Dossier introuvable');
		}
		if (folder.created_by !== actor.id && !isStaff(actor)) {
			return err(403, 'Suppression non autorisée');
		}
		const ids = [id];
		for (let i = 0; i < ids.length && ids.length < 5000; i++) {
			for (const child of this.sql.exec<{ id: string }>('SELECT id FROM folders WHERE parent_id = ?', ids[i]!).toArray()) {
				ids.push(child.id);
			}
		}
		const placeholders = ids.map(() => '?').join(',');
		const files = this.sql.exec<FileRow>(`SELECT * FROM files WHERE folder_id IN (${placeholders})`, ...ids).toArray();
		const touched = this.ctx.storage.transactionSync(() => {
			this.sql.exec(`DELETE FROM folders WHERE id IN (${placeholders})`, ...ids);
			return this.detachFiles(files);
		});
		this.afterDetach(folder.channel_id, touched);
		await this.deleteObjects(files.map((f) => f.key));
		return ok(null);
	}

	driveAddFile(actor: Actor, channelId: string, folderId: string | null, attachment: Attachment): Result<DriveFile> {
		const denied = this.driveDenied<DriveFile>(actor, channelId);
		if (denied) {
			return denied;
		}
		if (folderId && !this.folderRow(folderId, channelId)) {
			return err(404, 'Dossier introuvable');
		}
		const file = this.insertFile(channelId, folderId, attachment, actor.id, null);
		this.broadcast({ t: 'drive', channelId });
		return ok(file);
	}

	driveUpdateFile(actor: Actor, id: string, input: { name?: string; folderId?: string | null }): Result<DriveFile> {
		const file = this.sql.exec<FileRow>('SELECT * FROM files WHERE id = ?', id).toArray()[0];
		if (!file) {
			return err(404, 'Fichier introuvable');
		}
		if (file.uploaded_by !== actor.id && !isStaff(actor)) {
			return err(403, 'Modification non autorisée');
		}
		const name = input.name === undefined ? file.name : cleanFileName(input.name);
		if (!name) {
			return err(400, 'Nom de fichier requis');
		}
		const folderId = input.folderId === undefined ? file.folder_id : input.folderId;
		if (folderId && !this.folderRow(folderId, file.channel_id)) {
			return err(404, 'Dossier introuvable');
		}
		const row = this.sql.exec<FileRow>('UPDATE files SET name = ?, folder_id = ? WHERE id = ? RETURNING *', name, folderId, id).one();
		this.broadcast({ t: 'drive', channelId: file.channel_id });
		return ok(toFile(row));
	}

	async driveDeleteFile(actor: Actor, id: string): Promise<Result<null>> {
		const file = this.sql.exec<FileRow>('SELECT * FROM files WHERE id = ?', id).toArray()[0];
		if (!file) {
			return err(404, 'Fichier introuvable');
		}
		if (file.uploaded_by !== actor.id && !isStaff(actor)) {
			return err(403, 'Suppression non autorisée');
		}
		const touched = this.ctx.storage.transactionSync(() => this.detachFiles([file]));
		this.afterDetach(file.channel_id, touched);
		await this.deleteObjects([file.key]);
		return ok(null);
	}

	fileByKey(key: string): DriveFile | null {
		const row = this.sql.exec<FileRow>('SELECT * FROM files WHERE key = ?', key).toArray()[0];
		return row ? toFile(row) : null;
	}

	private driveDenied<T>(actor: Actor, channelId: string): Result<T> | null {
		const channel = this.channelRow(channelId);
		if (!channel) {
			return err(404, 'Salon introuvable');
		}
		if (channel.read_only && !isStaff(actor)) {
			return err(403, 'Salon en lecture seule');
		}
		return null;
	}

	private insertFile(channelId: string, folderId: string | null, attachment: Attachment, userId: string, messageId: number | null): DriveFile {
		const row = this.sql
			.exec<FileRow>(
				'INSERT INTO files (id, channel_id, folder_id, key, name, size, type, uploaded_by, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
				attachment.key.split('/').pop()!,
				channelId,
				folderId,
				attachment.key,
				attachment.name,
				attachment.size,
				attachment.type,
				userId,
				messageId,
				Date.now(),
			)
			.one();
		return toFile(row);
	}

	// Fichier supprimé du drive : le message lié perd sa pièce jointe, ou disparaît s'il n'avait qu'elle.
	private detachFiles(files: FileRow[]): { updated: number[]; deleted: Array<{ id: number; channelId: string }> } {
		const updated: number[] = [];
		const deleted: Array<{ id: number; channelId: string }> = [];
		for (const file of files) {
			this.sql.exec('DELETE FROM files WHERE id = ?', file.id);
			if (file.message_id === null) {
				continue;
			}
			const message = this.sql.exec<{ body: string }>('SELECT body FROM messages WHERE id = ?', file.message_id).toArray()[0];
			if (!message) {
				continue;
			}
			if (message.body) {
				this.sql.exec('UPDATE messages SET attachment = NULL WHERE id = ?', file.message_id);
				updated.push(file.message_id);
			} else {
				this.sql.exec('DELETE FROM messages WHERE id = ?', file.message_id);
				deleted.push({ id: file.message_id, channelId: file.channel_id });
			}
		}
		return { updated, deleted };
	}

	private afterDetach(channelId: string, touched: { updated: number[]; deleted: Array<{ id: number; channelId: string }> }): void {
		for (const id of touched.updated) {
			const message = this.message(id);
			if (message) {
				this.broadcast({ t: 'message_updated', message });
			}
		}
		for (const { id, channelId: messageChannel } of touched.deleted) {
			this.broadcast({ t: 'message_deleted', channelId: messageChannel, id });
		}
		this.broadcast({ t: 'drive', channelId });
	}

	async fetch(request: Request): Promise<Response> {
		const actor = JSON.parse(request.headers.get('x-synq-actor') ?? 'null') as Actor | null;
		if (!actor || request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Bad request', { status: 400 });
		}
		const wasOnline = this.ctx.getWebSockets(actor.id).length > 0;
		const { 0: client, 1: server } = new WebSocketPair();
		const conn: Conn = { connId: crypto.randomUUID(), actor, voice: null };
		this.ctx.acceptWebSocket(server, [actor.id]);
		server.serializeAttachment(conn);
		const { unread, mentions } = this.unread(actor.id);
		this.send(server, {
			t: 'hello',
			connId: conn.connId,
			channels: this.channels(),
			online: this.onlineIds(),
			unread,
			mentions,
			voice: this.voiceSnapshot(),
		});
		if (!wasOnline) {
			this.broadcast({ t: 'presence', userId: actor.id, online: true }, server);
		}
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		const conn = this.conn(ws);
		if (!conn || typeof raw !== 'string') {
			return;
		}
		let event: ClientEvent;
		try {
			event = JSON.parse(raw) as ClientEvent;
		} catch {
			return;
		}
		if (event.t === 'typing' && this.channelRow(event.channelId)) {
			this.broadcast({ t: 'typing', channelId: event.channelId, userId: conn.actor.id }, ws);
		} else if (event.t === 'read') {
			this.markRead(conn.actor.id, event.channelId);
		} else if (event.t === 'voice_update' && conn.voice) {
			const flags: VoiceFlags = {};
			for (const key of ['muted', 'deafened', 'video', 'screen'] as const) {
				if (typeof event[key] === 'boolean') {
					flags[key] = event[key];
				}
			}
			this.setVoice(ws, conn, { ...conn.voice, ...flags });
			this.broadcastVoice(conn.voice.channelId);
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		ws.close(code, reason);
		this.dropConnection(ws);
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		this.dropConnection(ws);
	}

	private dropConnection(ws: WebSocket): void {
		const conn = this.conn(ws);
		if (!conn) {
			return;
		}
		if (conn.voice) {
			this.broadcastVoice(conn.voice.channelId, undefined, ws);
		}
		const stillOnline = this.ctx.getWebSockets(conn.actor.id).some((other) => other !== ws && other.readyState === WebSocket.OPEN);
		if (!stillOnline) {
			this.broadcast({ t: 'presence', userId: conn.actor.id, online: false }, ws);
		}
	}

	private onlineIds(): string[] {
		return [...new Set(this.ctx.getWebSockets().flatMap((ws) => this.conn(ws)?.actor.id ?? []))];
	}

	private clampLimit(value: number | undefined): number {
		return Math.max(0, Math.min(LIMITS.userLimit, Math.floor(Number(value) || 0)));
	}

	private channelRow(id: string): ChannelRow | null {
		return this.sql.exec<ChannelRow>('SELECT * FROM channels WHERE id = ?', id).toArray()[0] ?? null;
	}

	private channelByName(name: string): ChannelRow | null {
		return this.sql.exec<ChannelRow>('SELECT * FROM channels WHERE name = ?', name).toArray()[0] ?? null;
	}

	private folderRow(id: string, channelId: string): FolderRow | null {
		return this.sql.exec<FolderRow>('SELECT * FROM folders WHERE id = ? AND channel_id = ?', id, channelId).toArray()[0] ?? null;
	}

	private message(id: number): Message | null {
		const row = this.sql.exec<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = ?`, id).toArray()[0];
		return row ? toMessage(row) : null;
	}

	private saveMentions(messageId: number, body: string): void {
		for (const userId of mentionedUsers(body)) {
			this.sql.exec('INSERT OR IGNORE INTO mentions (message_id, user_id) VALUES (?, ?)', messageId, userId);
		}
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

	private async deleteObjects(keys: string[]): Promise<void> {
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
