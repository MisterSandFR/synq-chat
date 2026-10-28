import { DurableObject } from 'cloudflare:workers';
import { AI_CHAT_LIMITS } from '../shared/ai-chat';

import { cleanChannelIcon, type Category, type Layout } from '../shared/categories';
import { appUserId, type CommandConfig, type CommandInput, type SlashCommand } from '../shared/commands';
import type { PinInfo, Reaction } from '../shared/chat';
import { DM_MAX_MEMBERS, DM_PERMS, type DirectChange, type DirectConversation, type FollowedThread, type ThreadView } from '../shared/dm-threads';
import { FAVORITES_MAX, type FavoriteRef } from '../shared/favorites';
import type { CalendarReminder } from '../shared/calendar';
import { DEFAULT_GRADE, P, READ_ONLY_DENY, channelPerms, has, PERMISSIONS, type Override } from '../shared/permissions';
import {
	LIMITS,
	mentionedUsers,
	type Actor,
	type Attachment,
	type Channel,
	type ChannelInput,
	type ChannelKind,
	type ChannelOverrides,
	type ClientEvent,
	type DriveFile,
	type DriveFolder,
	type DriveListing,
	type Message,
	type MessagePage,
	type SearchHit,
	type ServerEvent,
	type VoiceFlags,
	type VoiceParticipant,
} from '../shared/types';
import type { MailCard } from '../shared/mail';
import { NOTIFICATIONS_MIGRATION, forgetNotifications, listNotifications, markChannelNotificationsRead, markNotificationsRead, messageRecipients, notificationPrefs, notify, setNotifyLevel, unreadCount } from './notifications';
import type { NotificationFilter, NotificationItem, NotificationPage, NotifyInput, NotifyLevel } from '../shared/notifications';
import { parseAttachments } from './media';
import {
	applyLayout,
	cleanCategoryName,
	copyCategoryOverrides,
	insertCategory,
	listCategories,
	nextPosition,
	readCategoryOverrides,
	removeCategory,
	renameCategory,
	resolveCategory,
	setCategoryBanner,
	validLayout,
	writeCategoryOverrides,
} from './categories';
import { editCommand, findCommand, insertCommand, listCommandConfigs, listCommands, removeCommand, type CommandTarget } from './commands';
import { RC_LIMITS, everyoneMentions, type Announcement, type ForwardRef, type SavedMessage, type Webhook } from '../shared/rc';
import {
	EVERYONE,
	cleanHookName,
	forwardRef,
	insertMentions,
	insertWebhook,
	listWebhooks,
	matchWebhook,
	readAnnouncement,
	removeWebhook,
	rotateWebhookSecret,
	savedRows,
	webhookById,
	writeAnnouncement,
	writeSaved,
} from './rc';
import { decorate, dropChannelExtras, dropExtras, setPin, toggleReaction } from './chat';
import {
	changeDirect,
	createDirect,
	directById,
	findDirect,
	follow,
	followedRows,
	isFollowing,
	lastReplyId,
	listDirects,
	loadDmMembers,
	syncHolders,
	markThreadRead,
	unfollow,
} from './dm-threads';
import { FAVORITES_MIGRATION, deleteFavorite, favoriteRows, insertFavorite, reorderFavorites, type FavoriteRow } from './favorites';
import type { AuditKind, AuditPage } from '../shared/audit';
import { AUDIT_MIGRATION, insertAudit, readAudit, type AuditInput } from './audit';
import { err, ok, type Result } from './result';
import { DRAFT_LIMITS, type Draft, type ScheduledMessage, type SentPage } from '../shared/drafts';
import {
	DRAFTS_MIGRATION,
	checkSendAt,
	countScheduled,
	deleteScheduled,
	dropDraft,
	dueScheduled,
	failScheduled,
	getScheduled,
	insertScheduled,
	listScheduled,
	moveScheduled,
	nextScheduledAt,
	publicScheduled,
	readDrafts,
	writeDraft,
	type ScheduleInput,
	type ScheduledFull,
} from './drafts';
import { loadActor } from './grades';

interface Voice {
	channelId: string;
	sessionId: string | null;
	recvSessionId: string | null;
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
	category_id: string | null;
	category_name: string;
	synced: number;
	read_only: number;
	ro_deny: number | null;
	user_limit: number;
	position: number;
	created_at: number;
	icon: string;
};

type MessageRow = {
	id: number;
	channel_id: string;
	user_id: string;
	body: string;
	attachment: string | null;
	attachments: string | null;
	reply_to: number | null;
	reply_user: string | null;
	reply_body: string | null;
	created_at: number;
	edited_at: number | null;
	thread_root?: number | null;
	thread_count?: number;
	thread_last?: number | null;
	event_id?: string | null;
	forward?: string | null;
	mail_card?: string | null;
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
	// 1408 = READ_ONLY_DENY : la lecture seule devient une surcharge du grade par défaut.
	`CREATE TABLE channel_overrides (
		channel_id TEXT NOT NULL,
		grade_id TEXT NOT NULL,
		allow INTEGER NOT NULL DEFAULT 0,
		deny INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (channel_id, grade_id)
	);
	INSERT INTO channel_overrides (channel_id, grade_id, allow, deny) SELECT id, 'default', 0, 1408 FROM channels WHERE read_only = 1;`,
	NOTIFICATIONS_MIGRATION,
	// Pièces jointes multiples : l'ancienne colonne reste lue pour compat, plus jamais écrite.
	`ALTER TABLE messages ADD COLUMN attachments TEXT;
	UPDATE messages SET attachments = json_array(json(attachment)), attachment = NULL WHERE attachment IS NOT NULL;`,
	// Catégories en table : salons texte et vocaux mélangés, positions recalculées par catégorie.
	`CREATE TABLE categories (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		position INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE category_overrides (
		category_id TEXT NOT NULL,
		subject_id TEXT NOT NULL,
		allow INTEGER NOT NULL DEFAULT 0,
		deny INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (category_id, subject_id)
	);
	ALTER TABLE channels ADD COLUMN category_id TEXT;
	ALTER TABLE channels ADD COLUMN synced INTEGER NOT NULL DEFAULT 0;
	INSERT INTO categories (id, name, position)
		SELECT lower(hex(randomblob(16))), category, ROW_NUMBER() OVER (ORDER BY MIN(kind = 'voice'), category) - 1 FROM channels WHERE category != '' GROUP BY category;
	UPDATE channels SET category_id = (SELECT k.id FROM categories k WHERE k.name = channels.category);
	UPDATE channels SET position = r.n
		FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY kind = 'voice', position, name) - 1 AS n FROM channels) AS r
		WHERE r.id = channels.id;`,
	// Secret HMAC stocké ici seulement ; jamais relu hors de l'appel sortant.
	`CREATE TABLE commands (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL UNIQUE,
		description TEXT NOT NULL DEFAULT '',
		usage TEXT NOT NULL DEFAULT '',
		url TEXT NOT NULL,
		secret TEXT NOT NULL,
		ephemeral INTEGER NOT NULL DEFAULT 0,
		created_by TEXT NOT NULL,
		created_at INTEGER NOT NULL
	);`,
	`CREATE TABLE saved (
		user_id TEXT NOT NULL,
		message_id INTEGER NOT NULL,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (user_id, message_id)
	);
	CREATE INDEX saved_message ON saved (message_id);
	CREATE TABLE announcements (
		channel_id TEXT PRIMARY KEY,
		text TEXT NOT NULL,
		updated_by TEXT NOT NULL,
		updated_at INTEGER NOT NULL
	);
	CREATE TRIGGER saved_ad AFTER DELETE ON messages BEGIN
		DELETE FROM saved WHERE message_id = old.id;
	END;
	CREATE TRIGGER announcements_ad AFTER DELETE ON channels BEGIN
		DELETE FROM announcements WHERE channel_id = old.id;
	END;`,
	`CREATE TABLE reactions (
		message_id INTEGER NOT NULL,
		emoji TEXT NOT NULL,
		user_id TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		PRIMARY KEY (message_id, emoji, user_id)
	);
	CREATE TABLE pins (
		message_id INTEGER PRIMARY KEY,
		channel_id TEXT NOT NULL,
		pinned_by TEXT NOT NULL,
		pinned_at INTEGER NOT NULL
	);
	CREATE INDEX pins_channel ON pins (channel_id, pinned_at);`,
	`CREATE TABLE dm_members (
		channel_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		PRIMARY KEY (channel_id, user_id)
	);
	CREATE INDEX dm_members_user ON dm_members (user_id);
	ALTER TABLE channels ADD COLUMN dm_group INTEGER NOT NULL DEFAULT 0;
	ALTER TABLE channels ADD COLUMN dm_name TEXT NOT NULL DEFAULT '';
	ALTER TABLE messages ADD COLUMN thread_root INTEGER;
	ALTER TABLE messages ADD COLUMN thread_broadcast INTEGER NOT NULL DEFAULT 0;
	CREATE INDEX messages_thread ON messages (thread_root, id);
	CREATE TABLE thread_follows (
		user_id TEXT NOT NULL,
		root_id INTEGER NOT NULL,
		last_read_id INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (user_id, root_id)
	);`,
	`ALTER TABLE messages ADD COLUMN event_id TEXT;
	CREATE INDEX messages_event ON messages (event_id) WHERE event_id IS NOT NULL;`,
	`ALTER TABLE messages ADD COLUMN forward TEXT;
	CREATE TABLE webhooks (
		id TEXT PRIMARY KEY,
		channel_id TEXT NOT NULL,
		name TEXT NOT NULL,
		secret_hash TEXT NOT NULL,
		created_by TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		last_used_at INTEGER
	);
	CREATE INDEX webhooks_channel ON webhooks (channel_id);
	CREATE TRIGGER webhooks_ad AFTER DELETE ON channels BEGIN
		DELETE FROM webhooks WHERE channel_id = old.id;
	END;`,
	`CREATE TABLE guests (user_id TEXT PRIMARY KEY);`,
	AUDIT_MIGRATION,
	`ALTER TABLE messages ADD COLUMN mail_card TEXT;`,
	`CREATE TABLE dm_grades (
		channel_id TEXT NOT NULL,
		grade_id TEXT NOT NULL,
		PRIMARY KEY (channel_id, grade_id)
	);
	CREATE INDEX dm_grades_grade ON dm_grades (grade_id);
	CREATE TABLE grade_holders (
		grade_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		PRIMARY KEY (grade_id, user_id)
	);`,
	`ALTER TABLE channels ADD COLUMN icon TEXT NOT NULL DEFAULT '';
	ALTER TABLE categories ADD COLUMN banner_key TEXT;`,
	DRAFTS_MIGRATION,
	FAVORITES_MIGRATION,
];

const MESSAGE_SELECT = `SELECT m.*, r.user_id AS reply_user, substr(r.body, 1, 160) AS reply_body,
	(SELECT COUNT(*) FROM messages t WHERE t.thread_root = m.id) AS thread_count,
	(SELECT MAX(t.created_at) FROM messages t WHERE t.thread_root = m.id) AS thread_last
	FROM messages m LEFT JOIN messages r ON r.id = m.reply_to`;

const CHANNEL_SELECT = `SELECT c.*, o.deny AS ro_deny, COALESCE(k.name, '') AS category_name FROM channels c
	LEFT JOIN channel_overrides o ON o.channel_id = c.id AND o.grade_id = '${DEFAULT_GRADE}'
	LEFT JOIN categories k ON k.id = c.category_id`;
// Réponses de fil hors salon, sauf celles envoyées aussi dans le salon.
const IN_CHANNEL = '(m.thread_root IS NULL OR m.thread_broadcast = 1)';

const CHANNEL_BITS = PERMISSIONS.filter((p) => p.channel).reduce((acc, p) => acc | P[p.key], 0);

const TRACK_PERM: Record<string, number> = { mic: P.VOICE_SPEAK, cam: P.VOICE_VIDEO, screen: P.VOICE_SCREEN, 'screen-audio': P.VOICE_SCREEN };

const trackPerm = (name: string) => TRACK_PERM[name.startsWith('screen-audio') ? 'screen-audio' : (name.split('-')[0] ?? '')] ?? P.ADMINISTRATOR;

const toChannel = (row: ChannelRow): Channel => ({
	id: row.id,
	name: row.name,
	kind: row.kind,
	topic: row.topic,
	category: row.category_name,
	categoryId: row.category_id,
	synced: row.synced === 1,
	readOnly: has(row.ro_deny ?? 0, P.SEND_MESSAGES),
	userLimit: row.user_limit,
	position: row.position,
	createdAt: row.created_at,
	icon: row.icon,
});

const toMessage = (row: MessageRow): Message => ({
	id: row.id,
	channelId: row.channel_id,
	userId: row.user_id,
	body: row.body,
	attachments: parseAttachments(row.attachments, row.attachment),
	replyTo: row.reply_to === null ? null : { id: row.reply_to, userId: row.reply_user, body: row.reply_body },
	createdAt: row.created_at,
	editedAt: row.edited_at,
	threadRoot: row.thread_root ?? null,
	thread: row.thread_count ? { count: row.thread_count, lastAt: row.thread_last ?? row.created_at } : null,
	...(row.event_id ? { eventId: row.event_id } : {}),
	...(row.forward ? { forward: JSON.parse(row.forward) as ForwardRef } : {}),
	...(row.mail_card ? { mailCard: JSON.parse(row.mail_card) as MailCard } : {}),
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

const DENIED = 'Permission insuffisante';

export class Workspace extends DurableObject<Env> {
	private readonly sql: SqlStorage;
	private readonly overrideCache = new Map<string, ChannelOverrides>();
	private dmCache: Map<string, string[]> | null = null;
	// Envoi programmé en cours : le brouillon actuel du salon n'est pas celui du message.
	private deliveringScheduled = false;

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
			const text = insertCategory(this.sql, 'Salons textuels').id;
			const vocal = insertCategory(this.sql, 'Salons vocaux').id;
			const insert = 'INSERT INTO channels (id, name, kind, topic, category_id, synced, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
			const announcements = crypto.randomUUID();
			this.sql.exec(insert, crypto.randomUUID(), 'général', 'text', 'Discussions de l’équipe', text, 1, 0, now);
			this.sql.exec(insert, announcements, 'annonces', 'text', 'Annonces officielles, lecture seule', text, 0, 1, now);
			this.sql.exec(insert, crypto.randomUUID(), 'Salon vocal', 'voice', '', vocal, 1, 0, now);
			this.writeOverride(announcements, DEFAULT_GRADE, { allow: 0, deny: READ_ONLY_DENY });
		}
		return this.allChannels();
	}

	private overrides(channelId: string): ChannelOverrides {
		const cached = this.overrideCache.get(channelId);
		if (cached) {
			return cached;
		}
		const rows = this.sql.exec<{ grade_id: string; allow: number; deny: number }>('SELECT grade_id, allow, deny FROM channel_overrides WHERE channel_id = ?', channelId).toArray();
		const value = Object.fromEntries(rows.map((row) => [row.grade_id, { allow: row.allow, deny: row.deny }]));
		this.overrideCache.set(channelId, value);
		return value;
	}

	private writeOverride(channelId: string, gradeId: string, override: Override): void {
		const allow = override.allow & CHANNEL_BITS;
		const deny = override.deny & CHANNEL_BITS & ~allow;
		if (allow === 0 && deny === 0) {
			this.sql.exec('DELETE FROM channel_overrides WHERE channel_id = ? AND grade_id = ?', channelId, gradeId);
		} else {
			this.sql.exec(
				'INSERT INTO channel_overrides (channel_id, grade_id, allow, deny) VALUES (?, ?, ?, ?) ON CONFLICT (channel_id, grade_id) DO UPDATE SET allow = excluded.allow, deny = excluded.deny',
				channelId,
				gradeId,
				allow,
				deny,
			);
		}
		this.overrideCache.delete(channelId);
	}

	private permsIn(actor: Actor, channelId: string): number {
		const participants = this.dmMembers(channelId);
		if (participants) {
			return participants.includes(actor.id) ? DM_PERMS : 0;
		}
		if (actor.guest) {
			return 0;
		}
		return channelPerms({ owner: actor.owner, base: actor.perms, grades: actor.grades, id: actor.id }, this.overrides(channelId));
	}

	private can(actor: Actor, channelId: string, flag: number): boolean {
		return has(this.permsIn(actor, channelId), flag);
	}

	private visibleIds(actor: Actor): Set<string> {
		return new Set(this.allChannels().filter((c) => this.can(actor, c.id, P.VIEW_CHANNEL)).map((c) => c.id));
	}

	private access(actor: Actor) {
		const channels = this.allChannels().filter((c) => this.can(actor, c.id, P.VIEW_CHANNEL));
		const visible = new Set(channels.map((c) => c.id));
		const perms = Object.fromEntries(channels.map((c) => [c.id, this.permsIn(actor, c.id)]));
		const { unread, mentions } = this.unread(actor, visible);
		const voice = Object.fromEntries(Object.entries(this.voiceSnapshot()).filter(([id]) => visible.has(id)));
		return { channels, perms, unread, mentions, voice };
	}

	getOverrides(actor: Actor, channelId: string): Result<ChannelOverrides> {
		if (!this.roomRow(channelId)) {
			return err(404, 'Salon introuvable');
		}
		if (!has(actor.perms, P.MANAGE_CHANNELS)) {
			return err(403, DENIED);
		}
		return ok(this.overrides(channelId));
	}

	setOverrides(actor: Actor, channelId: string, overrides: ChannelOverrides): Result<ChannelOverrides> {
		if (!this.roomRow(channelId)) {
			return err(404, 'Salon introuvable');
		}
		if (!has(actor.perms, P.MANAGE_CHANNELS)) {
			return err(403, DENIED);
		}
		this.ctx.storage.transactionSync(() => {
			this.sql.exec('DELETE FROM channel_overrides WHERE channel_id = ?', channelId);
			this.sql.exec('UPDATE channels SET synced = 0 WHERE id = ?', channelId);
			for (const [gradeId, override] of Object.entries(overrides)) {
				this.writeOverride(channelId, gradeId, override);
			}
		});
		this.overrideCache.delete(channelId);
		this.resync();
		return ok(this.overrides(channelId));
	}

	gradeDeleted(gradeId: string): void {
		this.sql.exec('DELETE FROM channel_overrides WHERE grade_id = ?', gradeId);
		this.sql.exec('DELETE FROM category_overrides WHERE subject_id = ?', gradeId);
		this.sql.exec('DELETE FROM dm_grades WHERE grade_id = ?', gradeId);
		this.sql.exec('DELETE FROM grade_holders WHERE grade_id = ?', gradeId);
		this.overrideCache.clear();
		this.dmCache = null;
	}

	// Grades modifiés côté D1 : nouveaux acteurs pour les sockets ouverts, puis resynchronisation.
	refreshActors(actors: Actor[]): void {
		this.ctx.storage.transactionSync(() => syncHolders(this.sql, actors));
		this.dmCache = null;
		const byId = new Map(actors.map((a) => [a.id, a]));
		for (const ws of this.ctx.getWebSockets()) {
			const conn = this.conn(ws);
			const actor = conn && byId.get(conn.actor.id);
			if (conn && actor) {
				conn.actor = actor;
				ws.serializeAttachment(conn);
			}
		}
		this.resync();
		this.pushGradeDirects();
		this.broadcast({ t: 'members_changed' });
	}

	private resync(): void {
		for (const ws of this.ctx.getWebSockets()) {
			const conn = this.conn(ws);
			if (!conn) {
				continue;
			}
			if (conn.voice && !this.can(conn.actor, conn.voice.channelId, P.VIEW_CHANNEL | P.VOICE_CONNECT)) {
				const channelId = conn.voice.channelId;
				this.setVoice(ws, conn, null);
				this.send(ws, { t: 'voice_ended', reason: 'Accès au salon vocal retiré' });
				this.broadcastVoice(channelId);
			}
			this.send(ws, { t: 'access', ...this.access(conn.actor) });
		}
	}

	private allChannels(): Channel[] {
		return this.sql
			.exec<ChannelRow>(`${CHANNEL_SELECT} ORDER BY k.position IS NOT NULL, k.position, c.position, c.name`)
			.toArray()
			.map(toChannel);
	}

	channels(actor: Actor): Channel[] {
		return this.allChannels().filter((c) => this.can(actor, c.id, P.VIEW_CHANNEL));
	}

	createChannel(actor: Actor, input: ChannelInput): Result<Channel> {
		if (!has(actor.perms, P.MANAGE_CHANNELS)) {
			return err(403, DENIED);
		}
		const kind: ChannelKind = input.kind === 'voice' ? 'voice' : 'text';
		const name = normalizeChannelName(input.name ?? '', kind);
		if (!name) {
			return err(400, 'Nom de salon invalide');
		}
		if (this.channelByName(name)) {
			return err(409, 'Un salon porte déjà ce nom');
		}
		const categoryId = resolveCategory(this.sql, input, null);
		if (categoryId === undefined) {
			return err(404, 'Catégorie introuvable');
		}
		const readOnly = kind === 'text' && input.readOnly === true;
		const id = crypto.randomUUID();
		this.ctx.storage.transactionSync(() => {
			this.sql.exec(
				'INSERT INTO channels (id, name, kind, topic, category_id, synced, user_limit, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
				id,
				name,
				kind,
				(input.topic ?? '').trim().slice(0, LIMITS.topicLength),
				categoryId,
				categoryId && !readOnly ? 1 : 0,
				kind === 'voice' ? this.clampLimit(input.userLimit) : 0,
				input.position ?? nextPosition(this.sql, categoryId),
				Date.now(),
			);
			// Nouveau salon d'une catégorie : mêmes permissions qu'elle.
			if (categoryId) {
				copyCategoryOverrides(this.sql, categoryId, id);
			}
			if (readOnly) {
				const base = this.overrides(id)[DEFAULT_GRADE] ?? { allow: 0, deny: 0 };
				this.writeOverride(id, DEFAULT_GRADE, { allow: base.allow & ~READ_ONLY_DENY, deny: base.deny | READ_ONLY_DENY });
			}
		});
		this.overrideCache.delete(id);
		const channel = this.channelView(id)!;
		this.broadcastChannel(channel);
		return ok(channel);
	}

	updateChannel(actor: Actor, id: string, input: ChannelInput): Result<Channel> {
		if (!has(actor.perms, P.MANAGE_CHANNELS)) {
			return err(403, DENIED);
		}
		const current = this.roomRow(id);
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
		const categoryId = resolveCategory(this.sql, input, current.category_id);
		if (categoryId === undefined) {
			return err(404, 'Catégorie introuvable');
		}
		const icon = input.icon === undefined ? current.icon : cleanChannelIcon(input.icon);
		if (icon === null) {
			return err(400, 'Icône invalide : un emoji ou :nom:');
		}
		const moved = categoryId !== current.category_id;
		let changed = moved;
		this.ctx.storage.transactionSync(() => {
			this.sql.exec(
				'UPDATE channels SET name = ?, topic = ?, category_id = ?, synced = ?, user_limit = ?, position = ?, icon = ? WHERE id = ?',
				name,
				input.topic === undefined ? current.topic : input.topic.trim().slice(0, LIMITS.topicLength),
				categoryId,
				moved && !categoryId ? 0 : current.synced,
				current.kind === 'voice' ? this.clampLimit(input.userLimit ?? current.user_limit) : 0,
				input.position ?? (moved ? nextPosition(this.sql, categoryId) : current.position),
				icon,
				id,
			);
			if (moved && categoryId && current.synced === 1) {
				copyCategoryOverrides(this.sql, categoryId, id);
				this.overrideCache.delete(id);
			}
			if (input.readOnly !== undefined) {
				const base = this.overrides(id)[DEFAULT_GRADE] ?? { allow: 0, deny: 0 };
				const next = input.readOnly ? { allow: base.allow & ~READ_ONLY_DENY, deny: base.deny | READ_ONLY_DENY } : { allow: base.allow, deny: base.deny & ~READ_ONLY_DENY };
				// Formulaire renvoyé tel quel : ne désynchronise que sur un vrai changement.
				if (next.allow !== base.allow || next.deny !== base.deny) {
					this.writeOverride(id, DEFAULT_GRADE, next);
					this.sql.exec('UPDATE channels SET synced = 0 WHERE id = ?', id);
					changed = true;
				}
			}
		});
		this.overrideCache.delete(id);
		if (changed) {
			this.resync();
		}
		const channel = this.channelView(id)!;
		this.broadcastChannel(channel);
		return ok(channel);
	}

	async deleteChannel(actor: Actor, id: string): Promise<Result<null>> {
		if (!has(actor.perms, P.MANAGE_CHANNELS)) {
			return err(403, DENIED);
		}
		const current = this.roomRow(id);
		if (!current) {
			return err(404, 'Salon introuvable');
		}
		const { n } = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM channels WHERE kind = 'text'").one();
		if (current.kind === 'text' && n <= 1) {
			return err(400, 'Impossible de supprimer le dernier salon écrit');
		}
		const keys = this.sql.exec<{ key: string }>('SELECT key FROM files WHERE channel_id = ?', id).toArray().map((row) => row.key);
		this.ctx.storage.transactionSync(() => {
			dropChannelExtras(this.sql, id);
			this.sql.exec('DELETE FROM messages WHERE channel_id = ?', id);
			this.sql.exec('DELETE FROM reads WHERE channel_id = ?', id);
			this.sql.exec('DELETE FROM files WHERE channel_id = ?', id);
			this.sql.exec('DELETE FROM folders WHERE channel_id = ?', id);
			this.sql.exec('DELETE FROM channel_overrides WHERE channel_id = ?', id);
			this.sql.exec('DELETE FROM channels WHERE id = ?', id);
		});
		this.overrideCache.delete(id);
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

	listMessages(actor: Actor, channelId: string, cursor: { before?: number; after?: number; around?: number } = {}): Result<MessagePage> {
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		const older = (before: number, limit: number) =>
			this.sql.exec<MessageRow>(`${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.id < ? AND ${IN_CHANNEL} ORDER BY m.id DESC LIMIT ?`, channelId, before, limit + 1).toArray();
		const newer = (from: number, limit: number) =>
			this.sql.exec<MessageRow>(`${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.id >= ? AND ${IN_CHANNEL} ORDER BY m.id ASC LIMIT ?`, channelId, from, limit + 1).toArray();

		if (cursor.around !== undefined) {
			const before = older(cursor.around, AROUND);
			const after = newer(cursor.around, AROUND);
			return ok({
				messages: decorate(this.sql, [...before.slice(0, AROUND).reverse(), ...after.slice(0, AROUND)].map(toMessage)),
				hasMore: before.length > AROUND,
				hasNewer: after.length > AROUND,
			});
		}
		if (cursor.after !== undefined) {
			const rows = newer(cursor.after + 1, PAGE_SIZE);
			return ok({ messages: decorate(this.sql, rows.slice(0, PAGE_SIZE).map(toMessage)), hasMore: true, hasNewer: rows.length > PAGE_SIZE });
		}
		const rows = older(cursor.before ?? Number.MAX_SAFE_INTEGER, PAGE_SIZE);
		return ok({ messages: decorate(this.sql, rows.slice(0, PAGE_SIZE).reverse().map(toMessage)), hasMore: rows.length > PAGE_SIZE, hasNewer: false });
	}

	postMessage(actor: Actor, channelId: string, body: string, attachments: Attachment[], replyTo: number | null = null, eventId: string | null = null): Result<Message> {
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		if (!this.can(actor, channelId, P.SEND_MESSAGES)) {
			return err(403, 'Tu ne peux pas écrire dans ce salon');
		}
		if (attachments.length && !this.can(actor, channelId, P.ATTACH_FILES)) {
			return err(403, 'Tu ne peux pas joindre de fichier ici');
		}
		const text = body.trim();
		if (!text && !attachments.length && !eventId) {
			return err(400, 'Message vide');
		}
		if (text.length > LIMITS.messageLength) {
			return err(400, `Message trop long (${LIMITS.messageLength} caractères max)`);
		}
		const target = replyTo === null ? null : this.sql.exec<{ id: number }>('SELECT id FROM messages WHERE id = ? AND channel_id = ?', replyTo, channelId).toArray()[0];
		if (replyTo !== null && !target) {
			return err(400, 'Message cité introuvable');
		}
		const keys = attachments.map((a) => a.key);
		if (keys.length && this.sql.exec(`SELECT 1 FROM files WHERE key IN (${keys.map(() => '?').join(', ')})`, ...keys).toArray().length) {
			return err(409, 'Fichier déjà joint à un message');
		}
		const now = Date.now();
		const id = this.ctx.storage.transactionSync(() => {
			const row = this.sql
				.exec<{ id: number }>(
					'INSERT INTO messages (channel_id, user_id, body, attachments, reply_to, created_at, event_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
					channelId,
					actor.id,
					text,
					attachments.length ? JSON.stringify(attachments) : null,
					replyTo,
					now,
					eventId,
				)
				.one();
			this.saveMentions(row.id, text);
			this.saveEveryone(actor, channelId, row.id, text);
			for (const attachment of attachments) {
				this.insertFile(channelId, null, attachment, actor.id, row.id);
			}
			return row.id;
		});
		this.setRead(actor.id, channelId, id);
		this.draftSent(actor.id, channelId, 0);
		const message = this.message(id)!;
		this.broadcastIn(channelId, { t: 'message', message });
		if (attachments.length) {
			this.broadcastIn(channelId, { t: 'drive', channelId });
		}
		this.notifyMessage(actor, message, mentionedUsers(text));
		return ok(message);
	}

	editMessage(actor: Actor, id: number, body: string): Result<Message> {
		const current = this.message(id);
		if (!current || !this.can(actor, current.channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Message introuvable');
		}
		if (current.userId !== actor.id) {
			return err(403, 'Seul l’auteur peut modifier ce message');
		}
		const text = body.trim();
		if (!text && !current.attachments.length) {
			return err(400, 'Message vide');
		}
		if (text.length > LIMITS.messageLength) {
			return err(400, `Message trop long (${LIMITS.messageLength} caractères max)`);
		}
		this.ctx.storage.transactionSync(() => {
			this.sql.exec('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?', text, Date.now(), id);
			this.sql.exec('DELETE FROM mentions WHERE message_id = ?', id);
			this.saveMentions(id, text);
			this.saveEveryone(actor, current.channelId, id, text);
		});
		const message = this.message(id)!;
		this.broadcastIn(message.channelId, { t: 'message_updated', message });
		const before = new Set(mentionedUsers(current.body));
		this.notifyMessage(actor, message, mentionedUsers(text).filter((userId) => !before.has(userId)), true);
		return ok(message);
	}

	async deleteMessage(actor: Actor, id: number): Promise<Result<null>> {
		const current = this.message(id);
		if (!current || !this.can(actor, current.channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Message introuvable');
		}
		if (current.userId !== actor.id && !this.can(actor, current.channelId, P.MANAGE_MESSAGES)) {
			return err(403, 'Suppression non autorisée');
		}
		this.ctx.storage.transactionSync(() => {
			this.sql.exec('DELETE FROM messages WHERE id = ?', id);
			this.sql.exec('DELETE FROM files WHERE message_id = ?', id);
			dropExtras(this.sql, id);
		});
		this.broadcastIn(current.channelId, { t: 'message_deleted', channelId: current.channelId, id });
		if (current.attachments.length) {
			this.broadcastIn(current.channelId, { t: 'drive', channelId: current.channelId });
			await this.deleteObjects(current.attachments.map((a) => a.key));
		}
		return ok(null);
	}

	search(actor: Actor, query: string): SearchHit[] {
		const terms = query
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 8)
			.map((term) => `"${term.replace(/"/g, '""')}"*`);
		const visible = [...this.visibleIds(actor)];
		if (terms.length === 0 || visible.length === 0) {
			return [];
		}
		const rows = this.sql
			.exec<MessageRow & { snippet: string }>(
				`SELECT m.*, r.user_id AS reply_user, substr(r.body, 1, 160) AS reply_body, snippet(messages_fts, 0, '[[', ']]', '…', 16) AS snippet
				FROM messages_fts
				JOIN messages m ON m.id = messages_fts.rowid
				LEFT JOIN messages r ON r.id = m.reply_to
				WHERE messages_fts MATCH ? AND m.channel_id IN (${visible.map(() => '?').join(',')})
				ORDER BY m.id DESC LIMIT 30`,
				terms.join(' '),
				...visible,
			)
			.toArray();
		return rows.map((row) => ({ message: toMessage(row), snippet: row.snippet }));
	}

	markRead(userId: string, channelId: string): void {
		const { max } = this.sql.exec<{ max: number | null }>('SELECT MAX(id) AS max FROM messages WHERE channel_id = ?', channelId).one();
		if (max !== null) {
			this.setRead(userId, channelId, max);
			if (markChannelNotificationsRead(this.sql, userId, channelId, max) > 0) {
				this.pushUnread(userId);
			}
		}
	}

	private unread(actor: Actor, visible: Set<string>): { unread: Record<string, number>; mentions: Record<string, number> } {
		const rows = this.sql
			.exec<{ channel_id: string; n: number; mentions: number }>(
				`SELECT m.channel_id AS channel_id, COUNT(DISTINCT m.id) AS n, COUNT(DISTINCT x.message_id) AS mentions
				FROM messages m
				LEFT JOIN reads r ON r.channel_id = m.channel_id AND r.user_id = ?1
				LEFT JOIN mentions x ON x.message_id = m.id AND x.user_id IN (?1, '${EVERYONE}')
				WHERE m.id > COALESCE(r.last_read_id, 0) AND m.user_id != ?1 AND ${IN_CHANNEL}
				GROUP BY m.channel_id`,
				actor.id,
			)
			.toArray()
			.filter((row) => visible.has(row.channel_id));
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
		// Tout membre porte le grade `default`.
		this.sql.exec('INSERT OR IGNORE INTO grade_holders (grade_id, user_id) VALUES (?, ?)', DEFAULT_GRADE, userId);
		this.dmCache = null;
		this.broadcast({ t: 'members_changed' });
	}

	memberRemoved(userId: string): void {
		this.sql.exec('DELETE FROM channel_overrides WHERE grade_id = ?', `@${userId}`);
		this.sql.exec('DELETE FROM category_overrides WHERE subject_id = ?', `@${userId}`);
		this.overrideCache.clear();
		const channels = new Set<string>();
		for (const ws of this.ctx.getWebSockets(userId)) {
			const voice = this.conn(ws)?.voice;
			if (voice) {
				channels.add(voice.channelId);
			}
			ws.close(4001, 'Retiré de l’espace');
		}
		this.sql.exec('DELETE FROM reads WHERE user_id = ?', userId);
		this.sql.exec('DELETE FROM guests WHERE user_id = ?', userId);
		this.sql.exec('DELETE FROM grade_holders WHERE user_id = ?', userId);
		this.dmCache = null;
		forgetNotifications(this.sql, userId);
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

	// Fichier lisible si son salon l'est ; un envoi pas encore rattaché reste à son auteur.
	canReadFile(actor: Actor, key: string, uploadedBy: string | undefined): boolean {
		const file = this.sql.exec<{ channel_id: string }>('SELECT channel_id FROM files WHERE key = ?', key).toArray()[0];
		return file ? this.can(actor, file.channel_id, P.VIEW_CHANNEL) : uploadedBy === actor.id || actor.owner;
	}

	voiceJoin(actor: Actor, connId: string, channelId: string): Result<VoiceParticipant[]> {
		const ws = this.socketFor(actor.id, connId);
		if (!ws) {
			return err(404, 'Connexion temps réel introuvable, recharge la page');
		}
		const channel = this.channelRow(channelId);
		if (!channel || (channel.kind !== 'voice' && channel.kind !== 'dm') || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon vocal introuvable');
		}
		if (!this.can(actor, channelId, P.VOICE_CONNECT)) {
			return err(403, 'Tu ne peux pas rejoindre ce salon vocal');
		}
		const others = this.participants(channelId).filter((p) => p.userId !== actor.id);
		if (channel.user_limit > 0 && others.length >= channel.user_limit && !this.can(actor, channelId, P.BYPASS_LIMIT)) {
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
		this.setVoice(ws, conn, { channelId, sessionId: null, recvSessionId: null, tracks: [], muted: false, deafened: false, video: false, screen: false });
		if (previous && previous !== channelId) {
			this.broadcastVoice(previous);
		}
		if (channel.kind === 'dm' && others.length === 0) {
			this.ringDirect(actor.id, channelId);
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

	// Session publique remplacée seulement sans piste : ses abonnés la perdraient.
	voiceSession(actor: Actor, connId: string, role: 'publish' | 'receive', sessionId: string): Result<null> {
		const ws = this.socketFor(actor.id, connId);
		const conn = ws && this.conn(ws);
		if (!ws || !conn?.voice) {
			return err(404, 'Pas connecté au vocal');
		}
		if (role === 'publish' && conn.voice.tracks.length) {
			return err(409, 'Session de publication déjà active');
		}
		this.setVoice(ws, conn, { ...conn.voice, [role === 'publish' ? 'sessionId' : 'recvSessionId']: sessionId });
		return ok(null);
	}

	voiceOwns(actor: Actor, connId: string, sessionId: string): boolean {
		const ws = this.socketFor(actor.id, connId);
		const voice = ws && this.conn(ws)?.voice;
		return Boolean(voice && (voice.sessionId === sessionId || voice.recvSessionId === sessionId));
	}

	// Micro, caméra et écran ont chacun leur permission dans le salon.
	voiceMayPublish(actor: Actor, connId: string, sessionId: string, trackNames: string[]): boolean {
		const ws = this.socketFor(actor.id, connId);
		const voice = ws && this.conn(ws)?.voice;
		if (!voice || voice.sessionId !== sessionId) {
			return false;
		}
		const perms = this.permsIn(actor, voice.channelId);
		return trackNames.every((name) => has(perms, trackPerm(name)));
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

	voiceUnpublished(actor: Actor, connId: string, sessionId: string, trackNames: string[]): void {
		const ws = this.socketFor(actor.id, connId);
		const conn = ws && this.conn(ws);
		if (!ws || !conn?.voice || conn.voice.sessionId !== sessionId) {
			return;
		}
		this.setVoice(ws, conn, { ...conn.voice, tracks: conn.voice.tracks.filter((name) => !trackNames.includes(name)) });
		this.broadcastVoice(conn.voice.channelId);
	}

	// Abonnement autorisé seulement aux sessions du même salon vocal.
	voiceCanPull(actor: Actor, connId: string, sessionId: string, remoteSessionIds: string[]): boolean {
		const ws = this.socketFor(actor.id, connId);
		const voice = ws && this.conn(ws)?.voice;
		if (!voice || voice.recvSessionId !== sessionId) {
			return false;
		}
		const allowed = new Set(this.participants(voice.channelId).map((p) => p.sessionId));
		return remoteSessionIds.every((id) => id !== voice.sessionId && allowed.has(id));
	}

	// Le membre déplacé rejoint lui-même : seul son navigateur peut ouvrir ses connexions WebRTC.
	voiceMove(actor: Actor, targetId: string, channelId: string): Result<null> {
		const sockets = this.ctx.getWebSockets(targetId).filter((ws) => this.conn(ws)?.voice);
		const target = sockets[0] && this.conn(sockets[0]);
		if (!target?.voice) {
			return err(404, 'Ce membre n’est pas en vocal');
		}
		const destination = this.channelRow(channelId);
		if (!destination || destination.kind !== 'voice' || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon vocal introuvable');
		}
		if (target.voice.channelId === channelId) {
			return ok(null);
		}
		if (!this.can(actor, target.voice.channelId, P.VOICE_MOVE) || !this.can(actor, channelId, P.VOICE_MOVE)) {
			return err(403, DENIED);
		}
		if (targetId !== actor.id && (target.actor.owner || (!actor.owner && target.actor.top >= actor.top))) {
			return err(403, 'Grade égal ou supérieur au tien');
		}
		if (!this.can(target.actor, channelId, P.VOICE_CONNECT)) {
			return err(403, `${target.actor.name} ne peut pas rejoindre ce salon`);
		}
		const others = this.participants(channelId).filter((p) => p.userId !== targetId);
		if (destination.user_limit > 0 && others.length >= destination.user_limit && !this.can(target.actor, channelId, P.BYPASS_LIMIT)) {
			return err(409, 'Salon complet');
		}
		for (const ws of sockets) {
			this.send(ws, { t: 'voice_move', channelId, by: actor.name });
		}
		return ok(null);
	}

	voiceModerate(actor: Actor, targetId: string, action: 'mute' | 'kick'): Result<null> {
		const sockets = this.ctx.getWebSockets(targetId).filter((ws) => this.conn(ws)?.voice);
		const target = sockets[0] && this.conn(sockets[0]);
		if (!target?.voice) {
			return err(404, 'Ce membre n’est pas en vocal');
		}
		const channelId = target.voice.channelId;
		if (!this.can(actor, channelId, P.VOICE_MODERATE)) {
			return err(403, DENIED);
		}
		if (targetId !== actor.id && (target.actor.owner || (!actor.owner && target.actor.top >= actor.top))) {
			return err(403, 'Grade égal ou supérieur au tien');
		}
		for (const ws of sockets) {
			const conn = this.conn(ws)!;
			if (action === 'kick') {
				this.setVoice(ws, conn, null);
				this.send(ws, { t: 'voice_ended', reason: `${actor.name} t’a retiré du salon vocal` });
			} else {
				this.setVoice(ws, conn, { ...conn.voice!, muted: true });
				this.send(ws, { t: 'voice_force_mute', by: actor.name });
			}
		}
		this.broadcastVoice(channelId);
		return ok(null);
	}

	// Calendrier

	// Rappel poussé par le cron sur les sockets de l'utilisateur dans cet espace.
	// `store` : une seule notification par personne, même membre de plusieurs espaces.
	calendarReminder(userId: string, reminder: CalendarReminder, store = false): void {
		if (store) {
			const at = new Date(reminder.startsAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
			this.pushNotification({ userId, kind: 'calendar', channelId: null, title: `Rappel : ${reminder.title}`, body: reminder.location ? `${at}, ${reminder.location}` : at, link: '/calendrier' });
		}
		for (const ws of this.ctx.getWebSockets(userId)) {
			if (this.conn(ws)) {
				this.send(ws, { t: 'calendar_reminder', reminder });
			}
		}
	}

	private conn(ws: WebSocket): Conn | null {
		const value = ws.deserializeAttachment() as Partial<Conn> | null;
		// Sockets ouverts avant les grades : acteur sans liste de grades, ignorés.
		return value && typeof value.connId === 'string' && value.actor && Array.isArray(value.actor.grades) ? (value as Conn) : null;
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
		this.broadcastIn(channelId, { t: 'voice', channelId, participants }, exceptSocket);
		return participants;
	}

	driveList(actor: Actor, channelId: string, folderId: string | null): Result<DriveListing> {
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
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
		this.broadcastIn(channelId, { t: 'drive', channelId });
		return ok(toFolder(row));
	}

	driveRenameFolder(actor: Actor, id: string, rawName: string): Result<DriveFolder> {
		const folder = this.sql.exec<FolderRow>('SELECT * FROM folders WHERE id = ?', id).toArray()[0];
		if (!folder || !this.can(actor, folder.channel_id, P.VIEW_CHANNEL)) {
			return err(404, 'Dossier introuvable');
		}
		if (folder.created_by !== actor.id && !this.can(actor, folder.channel_id, P.DRIVE_MANAGE)) {
			return err(403, 'Modification non autorisée');
		}
		const name = cleanFileName(rawName);
		if (!name) {
			return err(400, 'Nom de dossier requis');
		}
		const row = this.sql.exec<FolderRow>('UPDATE folders SET name = ? WHERE id = ? RETURNING *', name, id).one();
		this.broadcastIn(folder.channel_id, { t: 'drive', channelId: folder.channel_id });
		return ok(toFolder(row));
	}

	async driveDeleteFolder(actor: Actor, id: string): Promise<Result<null>> {
		const folder = this.sql.exec<FolderRow>('SELECT * FROM folders WHERE id = ?', id).toArray()[0];
		if (!folder || !this.can(actor, folder.channel_id, P.VIEW_CHANNEL)) {
			return err(404, 'Dossier introuvable');
		}
		if (folder.created_by !== actor.id && !this.can(actor, folder.channel_id, P.DRIVE_MANAGE)) {
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
		this.broadcastIn(channelId, { t: 'drive', channelId });
		return ok(file);
	}

	driveUpdateFile(actor: Actor, id: string, input: { name?: string; folderId?: string | null }): Result<DriveFile> {
		const file = this.sql.exec<FileRow>('SELECT * FROM files WHERE id = ?', id).toArray()[0];
		if (!file || !this.can(actor, file.channel_id, P.VIEW_CHANNEL)) {
			return err(404, 'Fichier introuvable');
		}
		if (file.uploaded_by !== actor.id && !this.can(actor, file.channel_id, P.DRIVE_MANAGE)) {
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
		this.broadcastIn(file.channel_id, { t: 'drive', channelId: file.channel_id });
		return ok(toFile(row));
	}

	async driveDeleteFile(actor: Actor, id: string): Promise<Result<null>> {
		const file = this.sql.exec<FileRow>('SELECT * FROM files WHERE id = ?', id).toArray()[0];
		if (!file || !this.can(actor, file.channel_id, P.VIEW_CHANNEL)) {
			return err(404, 'Fichier introuvable');
		}
		if (file.uploaded_by !== actor.id && !this.can(actor, file.channel_id, P.DRIVE_MANAGE)) {
			return err(403, 'Suppression non autorisée');
		}
		const touched = this.ctx.storage.transactionSync(() => this.detachFiles([file]));
		this.afterDetach(file.channel_id, touched);
		await this.deleteObjects([file.key]);
		return ok(null);
	}

	// Réactions et épingles

	react(actor: Actor, messageId: number, emoji: string, add: boolean): Result<Reaction[]> {
		const current = this.message(messageId);
		if (!current || !this.can(actor, current.channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Message introuvable');
		}
		if (add && !this.can(actor, current.channelId, P.ADD_REACTIONS)) {
			return err(403, 'Tu ne peux pas réagir dans ce salon');
		}
		const result = toggleReaction(this.sql, messageId, actor.id, emoji, add);
		if (result.ok) {
			this.broadcastIn(current.channelId, { t: 'reactions', channelId: current.channelId, messageId, reactions: result.value });
			if (add && current.userId !== actor.id && !current.userId.startsWith('app:')) {
				this.pushNotification({ userId: current.userId, kind: 'reaction', channelId: current.channelId, messageId, actorId: actor.id, title: `${actor.name} a réagi ${emoji}`, body: current.body });
			}
		}
		return result;
	}

	pins(actor: Actor, channelId: string): Result<Message[]> {
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		const rows = this.sql
			.exec<MessageRow>(`${MESSAGE_SELECT} JOIN pins p ON p.message_id = m.id WHERE p.channel_id = ? ORDER BY p.pinned_at DESC, p.message_id DESC`, channelId)
			.toArray();
		return ok(decorate(this.sql, rows.map(toMessage)));
	}

	pin(actor: Actor, messageId: number, pinned: boolean): Result<PinInfo | null> {
		const current = this.message(messageId);
		if (!current || !this.can(actor, current.channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Message introuvable');
		}
		if (!this.can(actor, current.channelId, P.PIN_MESSAGES) && !this.can(actor, current.channelId, P.MANAGE_MESSAGES)) {
			return err(403, 'Épinglage non autorisé');
		}
		const result = setPin(this.sql, current, actor.id, pinned);
		if (result.ok) {
			this.broadcastIn(current.channelId, { t: 'pinned', channelId: current.channelId, messageId, pinned: result.value });
		}
		return result;
	}

	// Messages directs et fils.

	directs(actor: Actor): DirectConversation[] {
		return listDirects(this.sql, actor.id, this.dmMap());
	}

	// Participants validés comme membres par la route, auteur compris ; grades validés en D1, porteurs lus dans `actors`.
	// `guests` : places réservées aux prestataires invités par email juste après ; toujours un groupe neuf.
	openDirect(actor: Actor, userIds: string[], name: string, gradeIds: string[] = [], actors: Actor[] = [], guests = 0): Result<DirectConversation> {
		if (!userIds.includes(actor.id) || userIds.length + guests > DM_MAX_MEMBERS || (userIds.length < 2 && !gradeIds.length && !guests)) {
			return err(400, 'Participants invalides');
		}
		if ((gradeIds.length || guests) && actor.guest) {
			return err(403, DENIED);
		}
		const existing = name || gradeIds.length || guests ? null : findDirect(this.sql, userIds);
		if (existing) {
			return ok(directById(this.sql, existing, this.dmMap())!);
		}
		const id = this.ctx.storage.transactionSync(() => {
			if (gradeIds.length) {
				syncHolders(this.sql, actors);
			}
			return createDirect(this.sql, userIds, name, gradeIds, guests > 0);
		});
		this.dmCache = null;
		const conversation = directById(this.sql, id, this.dmMap())!;
		this.sendTo(conversation.memberIds, { t: 'channel_upsert', channel: this.channelView(id)!, perms: DM_PERMS });
		this.sendTo(conversation.memberIds, { t: 'dm', conversation });
		return ok(conversation);
	}

	// Groupes seulement, par un participant ; null pour qui vient de partir.
	updateDirect(actor: Actor, channelId: string, change: DirectChange, actors: Actor[] = []): Result<DirectConversation | null> {
		const current = directById(this.sql, channelId, this.dmMap());
		if (!current || !current.memberIds.includes(actor.id)) {
			return err(404, 'Conversation introuvable');
		}
		if (!current.group) {
			return err(400, 'Réservé aux groupes');
		}
		// Un porteur de grade reste tant qu'il a le grade : seul un participant ajouté se retire.
		if (change.remove !== undefined && !current.addedIds.includes(change.remove)) {
			return err(404, 'Participant introuvable');
		}
		const grading = (change.addGrades?.length ?? 0) > 0 || change.removeGrade !== undefined;
		if (grading && actor.guest) {
			return err(403, DENIED);
		}
		if (change.removeGrade !== undefined && !current.gradeIds.includes(change.removeGrade)) {
			return err(404, 'Grade introuvable');
		}
		const add = [...new Set(change.add ?? [])].filter((id) => !current.addedIds.includes(id));
		if (add.length && current.addedIds.length + add.length > DM_MAX_MEMBERS) {
			return err(400, `${DM_MAX_MEMBERS} personnes ajoutées une à une maximum`);
		}
		this.ctx.storage.transactionSync(() => {
			if (grading) {
				syncHolders(this.sql, actors);
			}
			changeDirect(this.sql, channelId, { add, remove: change.remove, name: change.name, addGrades: change.addGrades, removeGrade: change.removeGrade });
		});
		this.dmCache = null;
		this.resync();
		const conversation = directById(this.sql, channelId, this.dmMap())!;
		this.sendTo(conversation.memberIds, { t: 'dm', conversation });
		return ok(conversation.memberIds.includes(actor.id) ? conversation : null);
	}

	threadView(actor: Actor, rootId: number): Result<ThreadView> {
		const found = this.threadRoot(actor, rootId);
		if (!found.ok) {
			return err(found.status, found.error);
		}
		const replies = this.sql.exec<MessageRow>(`${MESSAGE_SELECT} WHERE m.thread_root = ? ORDER BY m.id LIMIT 500`, rootId).toArray().map(toMessage);
		return ok({ root: found.value, replies, following: isFollowing(this.sql, actor.id, rootId) });
	}

	threadReply(actor: Actor, rootId: number, body: string, attachment: Attachment | null, broadcast: boolean): Result<Message> {
		const found = this.threadRoot(actor, rootId);
		if (!found.ok) {
			return err(found.status, found.error);
		}
		const { channelId, userId: rootAuthor } = found.value;
		if (!this.can(actor, channelId, P.SEND_MESSAGES)) {
			return err(403, 'Tu ne peux pas écrire dans ce salon');
		}
		if (attachment && !this.can(actor, channelId, P.ATTACH_FILES)) {
			return err(403, 'Tu ne peux pas joindre de fichier ici');
		}
		const text = body.trim();
		if (!text && !attachment) {
			return err(400, 'Message vide');
		}
		if (text.length > LIMITS.messageLength) {
			return err(400, `Message trop long (${LIMITS.messageLength} caractères max)`);
		}
		const id = this.ctx.storage.transactionSync(() => {
			const row = this.sql
				.exec<{ id: number }>(
					'INSERT INTO messages (channel_id, user_id, body, attachments, thread_root, thread_broadcast, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
					channelId,
					actor.id,
					text,
					attachment ? JSON.stringify([attachment]) : null,
					rootId,
					broadcast ? 1 : 0,
					Date.now(),
				)
				.one();
			this.saveMentions(row.id, text);
			if (attachment) {
				this.insertFile(channelId, null, attachment, actor.id, row.id);
			}
			follow(this.sql, rootAuthor, rootId, null);
			follow(this.sql, actor.id, rootId, row.id);
			return row.id;
		});
		this.draftSent(actor.id, channelId, rootId);
		const message = this.message(id)!;
		this.broadcastIn(channelId, { t: 'thread', channelId, rootId, message, root: this.message(rootId)! });
		const followers = this.sql.exec<{ user_id: string }>('SELECT user_id FROM thread_follows WHERE root_id = ? AND user_id != ?', rootId, actor.id).toArray();
		for (const { user_id: userId } of followers) {
			this.pushNotification({ userId, kind: 'thread', channelId, messageId: rootId, actorId: actor.id, title: `${actor.name} a répondu dans un fil`, body: text || attachment?.name || '' });
		}
		this.pushThreadsUnread([actor.id, ...followers.map((f) => f.user_id)]);
		if (broadcast) {
			this.setRead(actor.id, channelId, id);
			this.broadcastIn(channelId, { t: 'message', message });
		}
		if (attachment) {
			this.broadcastIn(channelId, { t: 'drive', channelId });
		}
		return ok(message);
	}

	followThread(actor: Actor, rootId: number, following: boolean): Result<{ following: boolean }> {
		const found = this.threadRoot(actor, rootId);
		if (!found.ok) {
			return err(found.status, found.error);
		}
		if (following) {
			follow(this.sql, actor.id, rootId, lastReplyId(this.sql, rootId));
		} else {
			unfollow(this.sql, actor.id, rootId);
		}
		this.pushThreadsUnread([actor.id]);
		return ok({ following });
	}

	readThread(actor: Actor, rootId: number): Result<null> {
		const found = this.threadRoot(actor, rootId);
		if (!found.ok) {
			return err(found.status, found.error);
		}
		markThreadRead(this.sql, actor.id, rootId);
		this.pushThreadsUnread([actor.id]);
		return ok(null);
	}

	followedThreads(actor: Actor): FollowedThread[] {
		return this.followedRoots(actor)
			.sort((a, b) => (b.root.thread?.lastAt ?? b.root.createdAt) - (a.root.thread?.lastAt ?? a.root.createdAt))
			.slice(0, 50)
			.map((t) => ({ ...t, ...this.threadTail(t.root.id) }));
	}

	threadsUnread(actor: Actor): number {
		return this.followedRoots(actor).filter((t) => t.unread > 0).length;
	}

	private followedRoots(actor: Actor): Array<{ root: Message; unread: number }> {
		return followedRows(this.sql, actor.id)
			.map((row) => ({ root: this.message(row.rootId), unread: row.unread }))
			.filter((t): t is { root: Message; unread: number } => t.root !== null && this.can(actor, t.root.channelId, P.VIEW_CHANNEL));
	}

	// Trois dernières réponses, dans l'ordre de lecture.
	private threadTail(rootId: number): { replies: Message[]; total: number } {
		const replies = this.sql.exec<MessageRow>(`${MESSAGE_SELECT} WHERE m.thread_root = ? ORDER BY m.id DESC LIMIT 3`, rootId).toArray().map(toMessage).reverse();
		const total = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE thread_root = ?', rootId).one().n;
		return { replies, total };
	}

	// Pastille des fils non lus, sur chaque appareil connecté.
	private pushThreadsUnread(userIds: string[]): void {
		for (const userId of new Set(userIds)) {
			const sockets = this.ctx.getWebSockets(userId);
			const actor = sockets.map((ws) => this.conn(ws)?.actor).find((a) => a !== undefined);
			if (actor) {
				const event: ServerEvent = { t: 'threads_unread', count: this.threadsUnread(actor) };
				sockets.forEach((ws) => this.send(ws, event));
			}
		}
	}

	private threadRoot(actor: Actor, rootId: number): Result<Message> {
		const root = Number.isInteger(rootId) ? this.message(rootId) : null;
		if (!root || !this.can(actor, root.channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Message introuvable');
		}
		if (root.threadRoot) {
			return err(400, 'Un fil ne s’ouvre que sur un message du salon');
		}
		return ok(root);
	}

	private dmMap(): Map<string, string[]> {
		this.dmCache ??= loadDmMembers(this.sql);
		return this.dmCache;
	}

	private dmMembers(channelId: string): string[] | null {
		return this.dmMap().get(channelId) ?? null;
	}

	// Porteurs changés : chaque groupe lié à un grade est renvoyé à ses participants.
	private pushGradeDirects(): void {
		for (const { channel_id } of this.sql.exec<{ channel_id: string }>('SELECT DISTINCT channel_id FROM dm_grades').toArray()) {
			const conversation = directById(this.sql, channel_id, this.dmMap());
			if (conversation) {
				this.sendTo(conversation.memberIds, { t: 'dm', conversation });
			}
		}
	}

	// Un DM n'est pas un salon d'espace : ni réglages ni suppression par les gestionnaires.
	private roomRow(id: string): ChannelRow | null {
		const row = this.channelRow(id);
		return row?.kind === 'dm' ? null : row;
	}

	private sendTo(userIds: string[], event: ServerEvent): void {
		for (const userId of new Set(userIds)) {
			for (const ws of this.ctx.getWebSockets(userId)) {
				this.send(ws, event);
			}
		}
	}

	private ringDirect(callerId: string, channelId: string): void {
		this.sendTo((this.dmMembers(channelId) ?? []).filter((id) => id !== callerId), { t: 'call_ring', channelId, by: callerId });
	}

	private driveDenied<T>(actor: Actor, channelId: string): Result<T> | null {
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		if (!this.can(actor, channelId, P.DRIVE_UPLOAD)) {
			return err(403, 'Tu ne peux pas déposer de fichier ici');
		}
		return null;
	}

	// --- Notifications ---

	notificationsList(actor: Actor, filter: NotificationFilter, before: number | null): NotificationPage {
		return listNotifications(this.sql, actor.id, this.visibleIds(actor), filter, before);
	}

	notificationsRead(actor: Actor, ids: number[] | 'all'): { unread: number } {
		if (markNotificationsRead(this.sql, actor.id, this.visibleIds(actor), ids) > 0) {
			this.pushUnread(actor.id);
		}
		return { unread: unreadCount(this.sql, actor.id, this.visibleIds(actor)) };
	}

	notificationPrefs(actor: Actor): Record<string, NotifyLevel> {
		return notificationPrefs(this.sql, actor.id, this.visibleIds(actor));
	}

	setNotificationPref(actor: Actor, channelId: string, level: NotifyLevel): Result<{ level: NotifyLevel }> {
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		setNotifyLevel(this.sql, actor.id, channelId, level);
		return ok({ level });
	}

	// Entrée commune des sources internes au DO (DM, fils, réactions, calendrier, mail).
	private pushNotification(input: NotifyInput): NotificationItem | null {
		const item = notify(this.sql, input);
		if (!item) {
			return null;
		}
		for (const ws of this.ctx.getWebSockets(input.userId)) {
			const conn = this.conn(ws);
			if (conn && (!item.channelId || this.can(conn.actor, item.channelId, P.VIEW_CHANNEL))) {
				this.send(ws, { t: 'notification', notification: item, unread: unreadCount(this.sql, input.userId, this.visibleIds(conn.actor)) });
			}
		}
		return item;
	}

	private pushUnread(userId: string): void {
		for (const ws of this.ctx.getWebSockets(userId)) {
			const conn = this.conn(ws);
			if (conn) {
				this.send(ws, { t: 'notifications_unread', unread: unreadCount(this.sql, userId, this.visibleIds(conn.actor)) });
			}
		}
	}

	// Une édition ne notifie que les nouvelles mentions.
	private notifyMessage(actor: Actor, message: Message, mentioned: string[], mentionsOnly = false): void {
		const channel = this.channelRow(message.channelId);
		if (!channel) {
			return;
		}
		const participants = channel.kind === 'dm' ? this.dmMembers(message.channelId) : null;
		if (participants) {
			const group = participants.length > 2;
			for (const userId of participants.filter((id) => id !== actor.id)) {
				this.pushNotification({ userId, kind: 'dm', channelId: message.channelId, messageId: message.id, actorId: actor.id, title: group ? `${actor.name} dans un groupe` : actor.name, body: message.body || message.attachments[0]?.name || '' });
			}
			return;
		}
		const where = channel.kind === 'text' ? `#${channel.name}` : channel.name;
		const titles: Record<string, string> = {
			mention: `${actor.name} t’a mentionné dans ${where}`,
			reply: `${actor.name} a répondu à ton message dans ${where}`,
			message: `${actor.name} dans ${where}`,
		};
		const recipients = mentionsOnly
			? mentioned.filter((userId) => userId !== actor.id).map((userId) => ({ userId, kind: 'mention' as const }))
			: messageRecipients(this.sql, { channelId: message.channelId, authorId: actor.id, mentioned, replyAuthor: message.replyTo?.userId ?? null });
		for (const { userId, kind } of recipients.filter((r) => !this.isGuest(r.userId))) {
			this.pushNotification({ userId, kind, channelId: message.channelId, messageId: message.id, actorId: actor.id, title: titles[kind] ?? where, body: message.body || message.attachments[0]?.name || '' });
		}
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

	// Fichier supprimé du drive : le message lié perd cette pièce jointe, ou disparaît s'il ne lui reste rien.
	private detachFiles(files: FileRow[]): { updated: number[]; deleted: Array<{ id: number; channelId: string }> } {
		const updated: number[] = [];
		const deleted: Array<{ id: number; channelId: string }> = [];
		for (const file of files) {
			this.sql.exec('DELETE FROM files WHERE id = ?', file.id);
			if (file.message_id === null) {
				continue;
			}
			const message = this.sql
				.exec<{ body: string; attachments: string | null; attachment: string | null }>('SELECT body, attachments, attachment FROM messages WHERE id = ?', file.message_id)
				.toArray()[0];
			if (!message) {
				continue;
			}
			const rest = parseAttachments(message.attachments, message.attachment).filter((a) => a.key !== file.key);
			if (message.body || rest.length) {
				this.sql.exec('UPDATE messages SET attachments = ?, attachment = NULL WHERE id = ?', rest.length ? JSON.stringify(rest) : null, file.message_id);
				if (!updated.includes(file.message_id)) {
					updated.push(file.message_id);
				}
			} else {
				this.sql.exec('DELETE FROM messages WHERE id = ?', file.message_id);
				dropExtras(this.sql, file.message_id);
				deleted.push({ id: file.message_id, channelId: file.channel_id });
			}
		}
		return { updated, deleted };
	}

	private afterDetach(channelId: string, touched: { updated: number[]; deleted: Array<{ id: number; channelId: string }> }): void {
		for (const id of touched.updated) {
			const message = this.message(id);
			if (message) {
				this.broadcastIn(message.channelId, { t: 'message_updated', message });
			}
		}
		for (const { id, channelId: messageChannel } of touched.deleted) {
			this.broadcastIn(messageChannel, { t: 'message_deleted', channelId: messageChannel, id });
		}
		this.broadcastIn(channelId, { t: 'drive', channelId });
	}

	// Catégories et ordre des salons.

	categories(actor: Actor): Category[] {
		const all = listCategories(this.sql);
		if (has(actor.perms, P.MANAGE_CHANNELS)) {
			return all;
		}
		const used = new Set(this.channels(actor).map((c) => c.categoryId));
		return all.filter((c) => used.has(c.id));
	}

	createCategory(actor: Actor, rawName: string): Result<Category> {
		if (!has(actor.perms, P.MANAGE_CHANNELS)) {
			return err(403, DENIED);
		}
		const name = cleanCategoryName(rawName);
		if (!name) {
			return err(400, 'Nom de catégorie requis');
		}
		const category = insertCategory(this.sql, name);
		this.resync();
		return ok(category);
	}

	updateCategory(actor: Actor, id: string, rawName: string): Result<Category> {
		const denied = this.categoryDenied<Category>(actor, id);
		if (denied) {
			return denied;
		}
		const name = cleanCategoryName(rawName);
		if (!name) {
			return err(400, 'Nom de catégorie requis');
		}
		const category = renameCategory(this.sql, id, name)!;
		this.resync();
		return ok(category);
	}

	// Ancienne clé renvoyée pour nettoyage R2 par la route.
	setCategoryBanner(actor: Actor, id: string, key: string | null): Result<{ previous: string | null }> {
		const denied = this.categoryDenied<{ previous: string | null }>(actor, id);
		if (denied) {
			return denied;
		}
		const previous = setCategoryBanner(this.sql, id, key);
		this.resync();
		return ok({ previous });
	}

	deleteCategory(actor: Actor, id: string): Result<null> {
		const denied = this.categoryDenied<null>(actor, id);
		if (denied) {
			return denied;
		}
		this.ctx.storage.transactionSync(() => removeCategory(this.sql, id));
		this.resync();
		return ok(null);
	}

	getCategoryOverrides(actor: Actor, id: string): Result<ChannelOverrides> {
		return this.categoryDenied<ChannelOverrides>(actor, id) ?? ok(readCategoryOverrides(this.sql, id));
	}

	setCategoryOverrides(actor: Actor, id: string, overrides: ChannelOverrides): Result<ChannelOverrides> {
		const denied = this.categoryDenied<ChannelOverrides>(actor, id);
		if (denied) {
			return denied;
		}
		const masked: ChannelOverrides = {};
		for (const [key, override] of Object.entries(overrides)) {
			const allow = override.allow & CHANNEL_BITS;
			masked[key] = { allow, deny: override.deny & CHANNEL_BITS & ~allow };
		}
		this.ctx.storage.transactionSync(() => writeCategoryOverrides(this.sql, id, masked));
		this.overrideCache.clear();
		this.resync();
		return ok(readCategoryOverrides(this.sql, id));
	}

	syncChannel(actor: Actor, channelId: string): Result<Channel> {
		if (!has(actor.perms, P.MANAGE_CHANNELS)) {
			return err(403, DENIED);
		}
		const row = this.channelRow(channelId);
		if (!row) {
			return err(404, 'Salon introuvable');
		}
		const categoryId = row.category_id;
		if (!categoryId) {
			return err(400, 'Salon sans catégorie');
		}
		this.ctx.storage.transactionSync(() => {
			copyCategoryOverrides(this.sql, categoryId, channelId);
			this.sql.exec('UPDATE channels SET synced = 1 WHERE id = ?', channelId);
		});
		this.overrideCache.delete(channelId);
		this.resync();
		return ok(this.channelView(channelId)!);
	}

	setLayout(actor: Actor, input: Partial<Layout>): Result<null> {
		if (!has(actor.perms, P.MANAGE_CHANNELS)) {
			return err(403, DENIED);
		}
		const layout = validLayout(this.sql, input);
		if (!layout) {
			return err(400, 'Ordre invalide');
		}
		this.ctx.storage.transactionSync(() => applyLayout(this.sql, layout));
		this.overrideCache.clear();
		this.resync();
		return ok(null);
	}

	private categoryDenied<T>(actor: Actor, id: string): Result<T> | null {
		if (!listCategories(this.sql).some((c) => c.id === id)) {
			return err(404, 'Catégorie introuvable');
		}
		return has(actor.perms, P.MANAGE_CHANNELS) ? null : err(403, DENIED);
	}

	// Mail

	mailNotify(userId: string, event: ServerEvent, store = false): void {
		if (store && event.t === 'mail_assigned') {
			this.pushNotification({ userId, kind: 'mail', channelId: null, title: 'Mail assigné', body: event.subject, link: '/mail' });
		}
		for (const ws of this.ctx.getWebSockets(userId)) {
			if (this.conn(ws)) {
				this.send(ws, event);
			}
		}
	}

	// --- Journal d'audit ---

	recordAudit(entry: AuditInput): void {
		insertAudit(this.sql, entry);
	}

	auditLog(actor: Actor, kind: AuditKind | null, before: number | null): Result<AuditPage> {
		if (!has(actor.perms, P.MANAGE_WORKSPACE)) {
			return err(403, DENIED);
		}
		return ok(readAudit(this.sql, kind, before));
	}

	async fetch(request: Request): Promise<Response> {
		const actor = JSON.parse(request.headers.get('x-synq-actor') ?? 'null') as Actor | null;
		if (!actor || request.headers.get('Upgrade') !== 'websocket') {
			return new Response('Bad request', { status: 400 });
		}
		for (const ws of this.ctx.getWebSockets()) {
			if (!this.conn(ws)) {
				ws.close(4000, 'Mise à jour du serveur');
			}
		}
		const wasOnline = this.ctx.getWebSockets(actor.id).some((ws) => this.conn(ws));
		const { 0: client, 1: server } = new WebSocketPair();
		const conn: Conn = { connId: crypto.randomUUID(), actor, voice: null };
		this.ctx.acceptWebSocket(server, [actor.id]);
		server.serializeAttachment(conn);
		this.send(server, { t: 'hello', connId: conn.connId, online: this.onlineFor(actor), ...this.access(actor) });
		this.send(server, { t: 'notifications_unread', unread: unreadCount(this.sql, actor.id, this.visibleIds(actor)) });
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
		if (event.t === 'typing' && this.channelRow(event.channelId) && this.can(conn.actor, event.channelId, P.SEND_MESSAGES)) {
			this.broadcastIn(event.channelId, { t: 'typing', channelId: event.channelId, userId: conn.actor.id }, ws);
		} else if (event.t === 'read' && this.channelRow(event.channelId) && this.can(conn.actor, event.channelId, P.VIEW_CHANNEL)) {
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

	// Réponse au Close automatique (web_socket_auto_reply_to_close) ; renvoyer 1006 lèverait une erreur.
	async webSocketClose(ws: WebSocket): Promise<void> {
		this.dropConnection(ws);
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		this.dropConnection(ws);
	}

	// Commandes slash
	commandList(): SlashCommand[] {
		return listCommands(this.sql);
	}

	commandConfigs(actor: Actor): Result<CommandConfig[]> {
		return listCommandConfigs(this.sql, actor);
	}

	createCommand(actor: Actor, input: Partial<CommandInput>): Result<CommandConfig> {
		return this.commandsChanged(insertCommand(this.sql, actor, input));
	}

	updateCommand(actor: Actor, id: string, input: Partial<CommandInput>): Result<CommandConfig> {
		return this.commandsChanged(editCommand(this.sql, actor, id, input));
	}

	deleteCommand(actor: Actor, id: string): Result<null> {
		return this.commandsChanged(removeCommand(this.sql, actor, id));
	}

	// Cible complète, secret compris : réservé au Worker, jamais transmis au client.
	commandTarget(actor: Actor, channelId: string, name: string): Result<CommandTarget & { channelName: string }> {
		const channel = this.channelRow(channelId);
		if (!channel || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		if (!this.can(actor, channelId, P.SEND_MESSAGES)) {
			return err(403, 'Tu ne peux pas écrire dans ce salon');
		}
		const target = findCommand(this.sql, name);
		return target ? ok({ ...target, channelName: channel.name }) : err(404, `Commande inconnue : /${name}`);
	}

	postCommandReply(actor: Actor, channelId: string, name: string, text: string): Result<Message> {
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.SEND_MESSAGES)) {
			return err(403, 'Tu ne peux pas écrire dans ce salon');
		}
		const body = text.trim().slice(0, LIMITS.messageLength);
		if (!body) {
			return err(400, 'Message vide');
		}
		const id = this.ctx.storage.transactionSync(() => {
			const row = this.sql
				.exec<{ id: number }>('INSERT INTO messages (channel_id, user_id, body, created_at) VALUES (?, ?, ?, ?) RETURNING id', channelId, appUserId(name), body, Date.now())
				.one();
			this.saveMentions(row.id, body);
			return row.id;
		});
		const message = this.message(id)!;
		this.broadcastIn(channelId, { t: 'message', message });
		return ok(message);
	}

	private commandsChanged<T>(result: Result<T>): Result<T> {
		if (result.ok) {
			this.broadcast({ t: 'commands_changed' });
		}
		return result;
	}

	// Parité Rocket.Chat : messages enregistrés, annonces de salon, mentions @all et @here.

	setSaved(actor: Actor, id: number, saved: boolean): Result<{ saved: boolean }> {
		const message = Number.isInteger(id) ? this.message(id) : null;
		if (!message || !this.can(actor, message.channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Message introuvable');
		}
		return writeSaved(this.sql, actor.id, id, saved);
	}

	savedMessages(actor: Actor): SavedMessage[] {
		return savedRows(this.sql, actor.id).flatMap((row) => {
			const message = this.message(row.message_id);
			return message && this.can(actor, message.channelId, P.VIEW_CHANNEL) ? [{ message, savedAt: row.created_at }] : [];
		});
	}

	announcement(actor: Actor, channelId: string): Result<Announcement> {
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		return ok(readAnnouncement(this.sql, channelId));
	}

	setAnnouncement(actor: Actor, channelId: string, raw: string): Result<Announcement> {
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		if (!has(actor.perms, P.MANAGE_CHANNELS)) {
			return err(403, DENIED);
		}
		const text = raw.trim();
		if (text.length > RC_LIMITS.announcement) {
			return err(400, `Annonce trop longue (${RC_LIMITS.announcement} caractères max)`);
		}
		const announcement = writeAnnouncement(this.sql, channelId, text, actor.id);
		this.broadcastIn(channelId, { t: 'announcement', ...announcement });
		return ok(announcement);
	}

	// Sans la permission, @all et @here restent du texte.
	private saveEveryone(actor: Actor, channelId: string, messageId: number, body: string): void {
		const kinds = everyoneMentions(body);
		if (!kinds.size || !this.can(actor, channelId, P.MENTION_EVERYONE)) {
			return;
		}
		const online = this.ctx.getWebSockets().flatMap((ws) => {
			const conn = this.conn(ws);
			return conn && conn.actor.id !== actor.id && this.can(conn.actor, channelId, P.VIEW_CHANNEL) ? [conn.actor.id] : [];
		});
		insertMentions(this.sql, messageId, kinds.has('all') ? [EVERYONE] : [...new Set(online)]);
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
		return this.sql.exec<ChannelRow>(`${CHANNEL_SELECT} WHERE c.id = ?`, id).toArray()[0] ?? null;
	}

	private channelView(id: string): Channel | null {
		const row = this.channelRow(id);
		return row ? toChannel(row) : null;
	}

	private channelByName(name: string): ChannelRow | null {
		return this.sql.exec<ChannelRow>(`${CHANNEL_SELECT} WHERE c.name = ?`, name).toArray()[0] ?? null;
	}

	private folderRow(id: string, channelId: string): FolderRow | null {
		return this.sql.exec<FolderRow>('SELECT * FROM folders WHERE id = ? AND channel_id = ?', id, channelId).toArray()[0] ?? null;
	}

	private message(id: number): Message | null {
		const row = this.sql.exec<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = ?`, id).toArray()[0];
		return row ? decorate(this.sql, [toMessage(row)])[0]! : null;
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
			const conn = this.conn(ws);
			if (ws === except || !conn || (conn.actor.guest && !this.guestHears(conn.actor.id, event))) {
				continue;
			}
			try {
				ws.send(payload);
			} catch {
				// Socket déjà fermé.
			}
		}
	}

	// Seuls ceux qui voient le salon reçoivent ses évènements.
	private broadcastIn(channelId: string, event: ServerEvent, except?: WebSocket): void {
		const payload = JSON.stringify(event);
		for (const ws of this.ctx.getWebSockets()) {
			const conn = this.conn(ws);
			if (ws === except || !conn || !this.can(conn.actor, channelId, P.VIEW_CHANNEL)) {
				continue;
			}
			try {
				ws.send(payload);
			} catch {
				// Socket déjà fermé.
			}
		}
	}

	private broadcastChannel(channel: Channel): void {
		for (const ws of this.ctx.getWebSockets()) {
			const conn = this.conn(ws);
			// Un invité n'apprend pas l'existence des salons.
			if (conn && !(conn.actor.guest && !this.can(conn.actor, channel.id, P.VIEW_CHANNEL))) {
				this.send(
					ws,
					this.can(conn.actor, channel.id, P.VIEW_CHANNEL) ? { t: 'channel_upsert', channel, perms: this.permsIn(conn.actor, channel.id) } : { t: 'channel_deleted', id: channel.id },
				);
			}
		}
	}

	// --- Cartes d'événement ---

	eventCardChanged(eventId: string): void {
		for (const { channel_id } of this.sql.exec<{ channel_id: string }>('SELECT DISTINCT channel_id FROM messages WHERE event_id = ?', eventId).toArray()) {
			this.broadcastIn(channel_id, { t: 'event_card', eventId });
		}
	}

	// Parité Rocket.Chat : transfert de message et webhooks entrants.

	forwardMessage(actor: Actor, id: number, targetId: string, comment: string): Result<Message> {
		const source = Number.isInteger(id) ? this.message(id) : null;
		if (!source || !this.can(actor, source.channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Message introuvable');
		}
		if (!this.channelRow(targetId) || !this.can(actor, targetId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		if (!this.can(actor, targetId, P.SEND_MESSAGES)) {
			return err(403, 'Tu ne peux pas écrire dans ce salon');
		}
		const text = comment.trim();
		if (text.length > LIMITS.messageLength) {
			return err(400, `Message trop long (${LIMITS.messageLength} caractères max)`);
		}
		const forward = JSON.stringify(forwardRef(source));
		const newId = this.ctx.storage.transactionSync(() => {
			const row = this.sql
				.exec<{ id: number }>('INSERT INTO messages (channel_id, user_id, body, forward, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id', targetId, actor.id, text, forward, Date.now())
				.one();
			this.saveMentions(row.id, text);
			this.saveEveryone(actor, targetId, row.id, text);
			return row.id;
		});
		this.setRead(actor.id, targetId, newId);
		const message = this.message(newId)!;
		this.broadcastIn(targetId, { t: 'message', message });
		this.notifyMessage(actor, message, mentionedUsers(text));
		return ok(message);
	}

	webhookList(actor: Actor, channelId: string): Result<Webhook[]> {
		return this.webhookDenied<Webhook[]>(actor, channelId) ?? ok(listWebhooks(this.sql, channelId));
	}

	// Haché calculé par le Worker, seul à voir le secret clair.
	createWebhook(actor: Actor, channelId: string, rawName: unknown, secretHash: string): Result<Webhook> {
		const denied = this.webhookDenied<Webhook>(actor, channelId);
		if (denied) {
			return denied;
		}
		const name = cleanHookName(rawName);
		return name ? insertWebhook(this.sql, channelId, name, secretHash, actor.id) : err(400, 'Nom du webhook requis');
	}

	rotateWebhook(actor: Actor, id: string, secretHash: string): Result<Webhook> {
		const hook = webhookById(this.sql, id);
		if (!hook) {
			return err(404, 'Webhook introuvable');
		}
		const denied = this.webhookDenied<Webhook>(actor, hook.channelId);
		if (denied) {
			return denied;
		}
		rotateWebhookSecret(this.sql, id, secretHash);
		return ok(hook);
	}

	deleteWebhook(actor: Actor, id: string): Result<null> {
		const hook = webhookById(this.sql, id);
		if (!hook) {
			return err(404, 'Webhook introuvable');
		}
		const denied = this.webhookDenied<null>(actor, hook.channelId);
		if (denied) {
			return denied;
		}
		removeWebhook(this.sql, id);
		return ok(null);
	}

	// Appel public : l'espace est vérifié par le Worker, le secret ici.
	webhookPost(id: string, secretHash: string, text: string, username: string): Result<Message> {
		const hook = matchWebhook(this.sql, id, secretHash);
		if (!hook || !this.channelRow(hook.channelId)) {
			return err(404, 'Webhook introuvable');
		}
		const body = text.trim();
		if (!body) {
			return err(400, 'Message vide');
		}
		if (body.length > LIMITS.messageLength) {
			return err(400, `Message trop long (${LIMITS.messageLength} caractères max)`);
		}
		const author = appUserId(cleanHookName(username) || hook.name);
		const messageId = this.ctx.storage.transactionSync(() => {
			const row = this.sql
				.exec<{ id: number }>('INSERT INTO messages (channel_id, user_id, body, created_at) VALUES (?, ?, ?, ?) RETURNING id', hook.channelId, author, body, Date.now())
				.one();
			this.saveMentions(row.id, body);
			return row.id;
		});
		const message = this.message(messageId)!;
		this.broadcastIn(hook.channelId, { t: 'message', message });
		return ok(message);
	}

	// DM exclus : un webhook vise un salon de l'espace.
	private webhookDenied<T>(actor: Actor, channelId: string): Result<T> | null {
		if (!this.channelRow(channelId) || this.dmMembers(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		return has(actor.perms, P.MANAGE_COMMANDS) ? null : err(403, DENIED);
	}

	// --- Invités ---

	// Participants des groupes de l'invité, lui compris ; vide s'il n'en a plus.
	guestContacts(userId: string): string[] {
		const contacts = new Set<string>();
		for (const members of this.dmMap().values()) {
			if (members.includes(userId)) {
				members.forEach((id) => contacts.add(id));
			}
		}
		return [...contacts];
	}

	// Groupe seulement ; un invité déjà entré doit en faire encore partie.
	guestConversation(channelId: string, userId: string | null): DirectConversation | null {
		const conversation = directById(this.sql, channelId, this.dmMap());
		if (!conversation?.group || (userId !== null && !conversation.memberIds.includes(userId))) {
			return null;
		}
		return conversation;
	}

	guestJoin(channelId: string, userId: string): Result<DirectConversation> {
		const current = this.guestConversation(channelId, null);
		if (!current) {
			return err(404, 'Conversation introuvable');
		}
		if (current.memberIds.length >= DM_MAX_MEMBERS) {
			return err(400, `${DM_MAX_MEMBERS} participants maximum`);
		}
		this.ctx.storage.transactionSync(() => {
			changeDirect(this.sql, channelId, { add: [userId] });
			this.sql.exec('INSERT OR IGNORE INTO guests (user_id) VALUES (?)', userId);
		});
		this.dmCache = null;
		// Historique lisible, pas compté comme non lu.
		const { max } = this.sql.exec<{ max: number | null }>('SELECT MAX(id) AS max FROM messages WHERE channel_id = ?', channelId).one();
		if (max !== null) {
			this.setRead(userId, channelId, max);
		}
		const conversation = directById(this.sql, channelId, this.dmMap())!;
		this.sendTo(conversation.memberIds, { t: 'dm', conversation });
		this.broadcast({ t: 'members_changed' });
		return ok(conversation);
	}

	// --- Canevas ---

	// Droits d'un canevas : ceux du salon rattaché, sinon tout membre non invité.
	canvasAccess(actor: Actor, channelIds: Array<string | null>): Array<'write' | 'read' | null> {
		return channelIds.map((id) => {
			if (id === null) {
				return actor.guest ? null : 'write';
			}
			if (!this.channelRow(id) || !this.can(actor, id, P.VIEW_CHANNEL)) {
				return null;
			}
			return this.can(actor, id, P.SEND_MESSAGES) ? 'write' : 'read';
		});
	}

	private isGuest(userId: string): boolean {
		return this.sql.exec('SELECT 1 FROM guests WHERE user_id = ?', userId).toArray().length > 0;
	}

	// Évènements d'espace transmis à un invité : liste blanche.
	private guestHears(userId: string, event: ServerEvent): boolean {
		if (event.t === 'members_changed' || event.t === 'workspace_deleted' || event.t === 'emojis_changed') {
			return true;
		}
		return event.t === 'presence' && this.guestContacts(userId).includes(event.userId);
	}

	private onlineFor(actor: Actor): string[] {
		if (!actor.guest) {
			return this.onlineIds();
		}
		const contacts = new Set(this.guestContacts(actor.id));
		return this.onlineIds().filter((id) => contacts.has(id));
	}

	// --- Partage de mail ---

	// Accès au fil vérifié par le Worker ; ici seulement le droit d'écrire.
	mailShare(actor: Actor, channelId: string, card: MailCard, comment: string): Result<Message> {
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		if (!this.can(actor, channelId, P.SEND_MESSAGES)) {
			return err(403, 'Tu ne peux pas écrire dans ce salon');
		}
		const text = comment.trim();
		if (text.length > LIMITS.messageLength) {
			return err(400, `Message trop long (${LIMITS.messageLength} caractères max)`);
		}
		const newId = this.ctx.storage.transactionSync(() => {
			const row = this.sql
				.exec<{ id: number }>('INSERT INTO messages (channel_id, user_id, body, mail_card, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id', channelId, actor.id, text, JSON.stringify(card), Date.now())
				.one();
			this.saveMentions(row.id, text);
			this.saveEveryone(actor, channelId, row.id, text);
			return row.id;
		});
		this.setRead(actor.id, channelId, newId);
		const message = this.message(newId)!;
		this.broadcastIn(channelId, { t: 'message', message });
		this.notifyMessage(actor, message, mentionedUsers(text));
		return ok(message);
	}

	// --- IA hors mail ---
	// Lectures pour l'IA : mêmes règles de visibilité que l'affichage, invités compris.

	aiSince(actor: Actor, channelId: string, after: number | null): Result<Message[]> {
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		const from = after ?? this.sql.exec<{ id: number }>('SELECT last_read_id AS id FROM reads WHERE user_id = ? AND channel_id = ?', actor.id, channelId).toArray()[0]?.id ?? 0;
		const rows = this.sql
			.exec<MessageRow>(`${MESSAGE_SELECT} WHERE m.channel_id = ? AND m.id > ? AND ${IN_CHANNEL} ORDER BY m.id DESC LIMIT ?`, channelId, from, AI_CHAT_LIMITS.catchup)
			.toArray();
		return ok(rows.reverse().map(toMessage));
	}

	aiMessage(actor: Actor, id: number): Result<Message> {
		const row = this.sql.exec<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = ?`, id).toArray()[0];
		if (!row || !this.can(actor, row.channel_id, P.VIEW_CHANNEL)) {
			return err(404, 'Message introuvable');
		}
		return ok(toMessage(row));
	}

	// Un mot suffit (OU), meilleurs scores d'abord.
	aiSearch(actor: Actor, words: string[]): Message[] {
		const terms = words.slice(0, 8).map((word) => `"${word.replace(/"/g, '""')}"*`);
		const visible = [...this.visibleIds(actor)];
		if (terms.length === 0 || visible.length === 0) {
			return [];
		}
		return this.sql
			.exec<MessageRow>(
				`${MESSAGE_SELECT} JOIN messages_fts ON messages_fts.rowid = m.id
				WHERE messages_fts MATCH ? AND m.channel_id IN (${visible.map(() => '?').join(',')})
				ORDER BY messages_fts.rank LIMIT ?`,
				terms.join(' OR '),
				...visible,
				AI_CHAT_LIMITS.sources,
			)
			.toArray()
			.map(toMessage);
	}

	// Emojis d'espace : la liste vit dans D1, le client la relit.
	emojisChanged(): void {
		this.broadcast({ t: 'emojis_changed' });
	}

	// --- Brouillons et messages programmés ---

	draftsList(actor: Actor): Draft[] {
		const visible = this.visibleIds(actor);
		return readDrafts(this.sql, actor.id).filter((d) => visible.has(d.channelId));
	}

	draftSave(actor: Actor, channelId: string, threadRoot: number, body: string, attachments: Attachment[]): Result<Draft | null> {
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		if (threadRoot && !this.sql.exec('SELECT 1 FROM messages WHERE id = ? AND channel_id = ? AND thread_root IS NULL', threadRoot, channelId).toArray().length) {
			return err(404, 'Fil introuvable');
		}
		if (body.length > LIMITS.messageLength) {
			return err(400, `Message trop long (${LIMITS.messageLength} caractères max)`);
		}
		const draft = writeDraft(this.sql, actor.id, channelId, threadRoot, body, attachments);
		this.sendTo([actor.id], { t: 'draft', channelId, threadRoot, draft });
		return ok(draft);
	}

	draftDelete(actor: Actor, channelId: string, threadRoot: number): void {
		if (dropDraft(this.sql, actor.id, channelId, threadRoot)) {
			this.sendTo([actor.id], { t: 'draft', channelId, threadRoot, draft: null });
		}
	}

	private draftSent(userId: string, channelId: string, threadRoot: number): void {
		if (!this.deliveringScheduled && dropDraft(this.sql, userId, channelId, threadRoot)) {
			this.sendTo([userId], { t: 'draft', channelId, threadRoot, draft: null });
		}
	}

	scheduledList(actor: Actor): ScheduledMessage[] {
		return listScheduled(this.sql, actor.id).map(publicScheduled);
	}

	async scheduleMessage(actor: Actor, workspaceId: string, input: ScheduleInput): Promise<Result<ScheduledMessage>> {
		const when = checkSendAt(input.sendAt);
		if (!when.ok) {
			return err(when.status, when.error);
		}
		const { channelId, threadRoot, replyTo, attachments } = input;
		if (!this.channelRow(channelId) || !this.can(actor, channelId, P.VIEW_CHANNEL)) {
			return err(404, 'Salon introuvable');
		}
		if (!this.can(actor, channelId, P.SEND_MESSAGES)) {
			return err(403, 'Tu ne peux pas écrire dans ce salon');
		}
		if (attachments.length && !this.can(actor, channelId, P.ATTACH_FILES)) {
			return err(403, 'Tu ne peux pas joindre de fichier ici');
		}
		const body = input.body.trim();
		if (!body && !attachments.length) {
			return err(400, 'Message vide');
		}
		if (body.length > LIMITS.messageLength) {
			return err(400, `Message trop long (${LIMITS.messageLength} caractères max)`);
		}
		if (threadRoot && attachments.length > 1) {
			return err(400, 'Un seul fichier par réponse de fil');
		}
		const target = threadRoot || replyTo;
		if (target && !this.sql.exec('SELECT 1 FROM messages WHERE id = ? AND channel_id = ?', target, channelId).toArray().length) {
			return err(400, threadRoot ? 'Fil introuvable' : 'Message cité introuvable');
		}
		if (countScheduled(this.sql, actor.id) >= DRAFT_LIMITS.scheduledPerUser) {
			return err(409, `${DRAFT_LIMITS.scheduledPerUser} messages programmés au plus`);
		}
		const row = this.ctx.storage.transactionSync(() => {
			const created = insertScheduled(this.sql, workspaceId, actor.id, { ...input, body, sendAt: when.value });
			this.draftSent(actor.id, channelId, threadRoot);
			return created;
		});
		await this.armAlarm();
		this.pushScheduled(actor.id);
		return ok(publicScheduled(row));
	}

	async scheduledMove(actor: Actor, id: number, sendAt: unknown): Promise<Result<ScheduledMessage>> {
		if (!this.ownScheduled(actor, id)) {
			return err(404, 'Message programmé introuvable');
		}
		const when = checkSendAt(sendAt);
		if (!when.ok) {
			return err(when.status, when.error);
		}
		moveScheduled(this.sql, id, when.value);
		await this.armAlarm();
		this.pushScheduled(actor.id);
		return ok(publicScheduled(getScheduled(this.sql, id)!));
	}

	async scheduledCancel(actor: Actor, id: number): Promise<Result<null>> {
		if (!this.ownScheduled(actor, id)) {
			return err(404, 'Message programmé introuvable');
		}
		deleteScheduled(this.sql, id);
		await this.armAlarm();
		this.pushScheduled(actor.id);
		return ok(null);
	}

	// Droits de l'acteur de la requête ; en cas d'échec le message reste programmé.
	async scheduledSendNow(actor: Actor, id: number): Promise<Result<Message>> {
		const row = this.ownScheduled(actor, id);
		if (!row) {
			return err(404, 'Message programmé introuvable');
		}
		const sent = this.deliverScheduled(actor, row);
		if (sent.ok) {
			deleteScheduled(this.sql, id);
			await this.armAlarm();
			this.pushScheduled(actor.id);
		}
		return sent;
	}

	sentMessages(actor: Actor, before: number | null): SentPage {
		const visible = [...this.visibleIds(actor)];
		if (!visible.length) {
			return { messages: [], next: null };
		}
		const rows = this.sql
			.exec<MessageRow>(
				`${MESSAGE_SELECT} WHERE m.user_id = ? AND m.id < ? AND m.channel_id IN (${visible.map(() => '?').join(',')}) ORDER BY m.id DESC LIMIT ?`,
				actor.id,
				before ?? Number.MAX_SAFE_INTEGER,
				...visible,
				DRAFT_LIMITS.sentPage + 1,
			)
			.toArray();
		const messages = decorate(this.sql, rows.slice(0, DRAFT_LIMITS.sentPage).map(toMessage));
		return { messages, next: rows.length > DRAFT_LIMITS.sentPage ? messages.at(-1)!.id : null };
	}

	async alarm(): Promise<void> {
		await this.sendDueScheduled(Date.now());
		await this.armAlarm();
	}

	// Une seule alarme par DO : chaque source ajoute ici sa prochaine échéance.
	private async armAlarm(): Promise<void> {
		const wakes = [nextScheduledAt(this.sql)].filter((at): at is number => at !== null);
		if (!wakes.length) {
			await this.ctx.storage.deleteAlarm();
			return;
		}
		const next = Math.min(...wakes);
		if ((await this.ctx.storage.getAlarm()) !== next) {
			await this.ctx.storage.setAlarm(next);
		}
	}

	private async sendDueScheduled(now: number): Promise<void> {
		for (const due of dueScheduled(this.sql, now)) {
			// Membre et grades relus en D1 à l'heure de l'envoi.
			const actor = await loadActor(this.env.DB, due.workspaceId, due.userId);
			const row = getScheduled(this.sql, due.id);
			// Supprimé, déplacé ou envoyé pendant la lecture D1.
			if (!row || row.status !== 'pending' || row.sendAt > now) {
				continue;
			}
			const sent: Result<Message> = actor ? this.deliverScheduled(actor, row) : err(403, 'Tu n’es plus membre de cet espace');
			if (sent.ok) {
				deleteScheduled(this.sql, row.id);
			} else {
				failScheduled(this.sql, row.id, sent.error);
				const where = this.channelRow(row.channelId);
				this.pushNotification({
					userId: row.userId,
					kind: 'scheduled',
					channelId: null,
					title: where && where.kind !== 'dm' ? `Message programmé non envoyé dans #${where.name}` : 'Message programmé non envoyé',
					body: `${sent.error}. ${row.body}`,
					link: `/w/${row.workspaceId}/brouillons`,
				});
			}
			this.pushScheduled(row.userId);
		}
	}

	private deliverScheduled(actor: Actor, row: ScheduledFull): Result<Message> {
		this.deliveringScheduled = true;
		try {
			return row.threadRoot
				? this.threadReply(actor, row.threadRoot, row.body, row.attachments[0] ?? null, false)
				: this.postMessage(actor, row.channelId, row.body, row.attachments, row.replyTo);
		} finally {
			this.deliveringScheduled = false;
		}
	}

	private ownScheduled(actor: Actor, id: number): ScheduledFull | null {
		const row = getScheduled(this.sql, id);
		return row?.userId === actor.id ? row : null;
	}

	private pushScheduled(userId: string): void {
		this.sendTo([userId], { t: 'scheduled', items: listScheduled(this.sql, userId).map(publicScheduled) });
	}

	// --- Listes ---

	// Droits par salon rattaché (null = liste d'espace), dans l'ordre reçu.
	listRights(actor: Actor, channelIds: Array<string | null>): Array<{ view: boolean; manage: boolean }> {
		return channelIds.map((channelId) => {
			if (!channelId) {
				return { view: !actor.guest, manage: !actor.guest && (actor.owner || has(actor.perms, P.MANAGE_CHANNELS)) };
			}
			// Salon supprimé : la liste reste fermée plutôt que de devenir publique.
			if (!this.roomRow(channelId)) {
				return { view: false, manage: false };
			}
			return { view: this.can(actor, channelId, P.VIEW_CHANNEL), manage: this.can(actor, channelId, P.MANAGE_CHANNELS) };
		});
	}

	listChanged(listId: string, channelId: string | null): void {
		const event: ServerEvent = { t: 'list_changed', listId, channelId };
		for (const ws of this.ctx.getWebSockets()) {
			const conn = this.conn(ws);
			if (conn && !conn.actor.guest && (!channelId || this.can(conn.actor, channelId, P.VIEW_CHANNEL))) {
				this.send(ws, event);
			}
		}
	}

	listAssigned(actor: Actor, userIds: string[], input: { workspaceId: string; listId: string; itemId: string; channelId: string | null; listTitle: string; itemTitle: string }): void {
		for (const userId of new Set(userIds)) {
			this.pushNotification({
				userId,
				kind: 'list',
				channelId: input.channelId && this.roomRow(input.channelId) ? input.channelId : null,
				actorId: actor.id,
				title: `${actor.name} t’a attribué un élément`,
				body: `${input.itemTitle || 'Sans titre'} · ${input.listTitle}`,
				link: `/w/${input.workspaceId}/listes/${input.listId}?element=${input.itemId}`,
			});
		}
	}

	// --- Favoris ---

	// Salons filtrés ici ; canevas et listes, rangés en D1, filtrés par la route.
	favorites(actor: Actor): FavoriteRow[] {
		return favoriteRows(this.sql, actor.id).filter((f) => f.kind !== 'channel' || this.seesChannel(actor, f.refId));
	}

	setFavorite(actor: Actor, ref: FavoriteRef, favorite: boolean): Result<null> {
		if (favorite && ref.kind === 'channel' && !this.seesChannel(actor, ref.refId)) {
			return err(404, 'Salon introuvable');
		}
		if (!favorite) {
			deleteFavorite(this.sql, actor.id, ref);
		} else if (!insertFavorite(this.sql, actor.id, ref)) {
			return err(400, `${FAVORITES_MAX} favoris maximum`);
		}
		this.sendTo([actor.id], { t: 'favorites' });
		return ok(null);
	}

	orderFavorites(actor: Actor, refs: FavoriteRef[]): Result<null> {
		this.ctx.storage.transactionSync(() => reorderFavorites(this.sql, actor.id, refs));
		this.sendTo([actor.id], { t: 'favorites' });
		return ok(null);
	}

	private seesChannel(actor: Actor, channelId: string): boolean {
		return this.channelRow(channelId) !== null && this.can(actor, channelId, P.VIEW_CHANNEL);
	}

	// --- Pages ---

	// Mention dans un commentaire de page : seulement pour qui voit la page.
	async pageMentioned(actor: Actor, userIds: string[], input: { workspaceId: string; scope: string | null; pageId: string; threadId: string; title: string; body: string }): Promise<void> {
		for (const userId of new Set(userIds)) {
			const target = await loadActor(this.env.DB, input.workspaceId, userId);
			const [access] = target ? this.canvasAccess(target, [input.scope]) : [null];
			if (!access) {
				continue;
			}
			this.pushNotification({
				userId,
				kind: 'mention',
				channelId: null,
				actorId: actor.id,
				title: `${actor.name} t’a mentionné dans une page`,
				body: `${input.title} · ${input.body}`,
				link: `/w/${input.workspaceId}/canevas/${input.pageId}?commentaire=${input.threadId}`,
			});
		}
	}
}
