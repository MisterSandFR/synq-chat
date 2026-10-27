import {
	DEFAULT_NOTIFY_LEVEL,
	NOTIFICATION_LIMITS,
	type NotificationFilter,
	type NotificationItem,
	type NotificationKind,
	type NotificationPage,
	type NotifyInput,
	type NotifyLevel,
} from '../shared/notifications';

export const NOTIFICATIONS_MIGRATION = `CREATE TABLE notifications (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL,
		kind TEXT NOT NULL,
		channel_id TEXT,
		message_id INTEGER,
		actor_id TEXT,
		title TEXT NOT NULL,
		body TEXT NOT NULL DEFAULT '',
		link TEXT,
		created_at INTEGER NOT NULL,
		read_at INTEGER
	);
	CREATE INDEX notifications_user ON notifications (user_id, id);
	CREATE INDEX notifications_message ON notifications (message_id);
	CREATE TABLE notification_prefs (
		user_id TEXT NOT NULL,
		channel_id TEXT NOT NULL,
		level TEXT NOT NULL,
		PRIMARY KEY (user_id, channel_id)
	);
	CREATE INDEX notification_prefs_channel ON notification_prefs (channel_id, level);
	CREATE TRIGGER notifications_message_ad AFTER DELETE ON messages BEGIN
		DELETE FROM notifications WHERE message_id = old.id;
	END;
	CREATE TRIGGER notifications_channel_ad AFTER DELETE ON channels BEGIN
		DELETE FROM notifications WHERE channel_id = old.id;
		DELETE FROM notification_prefs WHERE channel_id = old.id;
	END;`;

type NotificationRow = {
	id: number;
	user_id: string;
	kind: NotificationKind;
	channel_id: string | null;
	message_id: number | null;
	actor_id: string | null;
	title: string;
	body: string;
	link: string | null;
	created_at: number;
	read_at: number | null;
};

// Lot lu avant filtrage par visibilité : borne le travail d'une page.
const SCAN = 200;

const MENTION_KINDS: NotificationKind[] = ['mention', 'reply'];

const toItem = (row: NotificationRow): NotificationItem => ({
	id: row.id,
	kind: row.kind,
	channelId: row.channel_id,
	messageId: row.message_id,
	actorId: row.actor_id,
	title: row.title,
	body: row.body,
	link: row.link,
	createdAt: row.created_at,
	readAt: row.read_at,
});

// Hors salon (calendrier, mail) : toujours visible.
const visibleTo = (visible: Set<string>) => (row: { channel_id: string | null }) => row.channel_id === null || visible.has(row.channel_id);

export function notifyLevel(sql: SqlStorage, userId: string, channelId: string): NotifyLevel {
	return sql.exec<{ level: NotifyLevel }>('SELECT level FROM notification_prefs WHERE user_id = ? AND channel_id = ?', userId, channelId).toArray()[0]?.level ?? DEFAULT_NOTIFY_LEVEL;
}

/**
 * Point d'entrée de toutes les sources (mentions, réponses, DM, fils, réactions, calendrier, mail).
 * Applique la préférence du salon ; renvoie null si filtrée. L'appelant pousse l'élément en temps réel.
 */
export function notify(sql: SqlStorage, input: NotifyInput, now = Date.now()): NotificationItem | null {
	const channelId = input.channelId ?? null;
	if (input.actorId && input.actorId === input.userId) {
		return null;
	}
	if (channelId) {
		const level = notifyLevel(sql, input.userId, channelId);
		if (level === 'none' || (input.kind === 'message' && level !== 'all')) {
			return null;
		}
	}
	const row = sql
		.exec<NotificationRow>(
			'INSERT INTO notifications (user_id, kind, channel_id, message_id, actor_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
			input.userId,
			input.kind,
			channelId,
			input.messageId ?? null,
			input.actorId ?? null,
			input.title.slice(0, NOTIFICATION_LIMITS.titleLength),
			(input.body ?? '').slice(0, NOTIFICATION_LIMITS.bodyLength),
			input.link ?? null,
			now,
		)
		.one();
	sql.exec(
		'DELETE FROM notifications WHERE user_id = ?1 AND id <= (SELECT id FROM notifications WHERE user_id = ?1 ORDER BY id DESC LIMIT 1 OFFSET ?2)',
		input.userId,
		NOTIFICATION_LIMITS.keep,
	);
	return toItem(row);
}

// Destinataires d'un nouveau message : mentions, auteur cité, puis abonnés « tout ».
export function messageRecipients(
	sql: SqlStorage,
	input: { channelId: string; authorId: string; mentioned: string[]; replyAuthor: string | null },
): Array<{ userId: string; kind: NotificationKind }> {
	const seen = new Set([input.authorId]);
	const out: Array<{ userId: string; kind: NotificationKind }> = [];
	const add = (userId: string, kind: NotificationKind) => {
		if (!seen.has(userId)) {
			seen.add(userId);
			out.push({ userId, kind });
		}
	};
	input.mentioned.forEach((id) => add(id, 'mention'));
	if (input.replyAuthor) {
		add(input.replyAuthor, 'reply');
	}
	for (const { user_id } of sql.exec<{ user_id: string }>("SELECT user_id FROM notification_prefs WHERE channel_id = ? AND level = 'all'", input.channelId).toArray()) {
		add(user_id, 'message');
	}
	return out;
}

export function unreadCount(sql: SqlStorage, userId: string, visible: Set<string>): number {
	return sql
		.exec<{ channel_id: string | null; n: number }>('SELECT channel_id, COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL GROUP BY channel_id', userId)
		.toArray()
		.filter(visibleTo(visible))
		.reduce((sum, row) => sum + row.n, 0);
}

export function listNotifications(sql: SqlStorage, userId: string, visible: Set<string>, filter: NotificationFilter, before: number | null): NotificationPage {
	const clauses = ['user_id = ?', 'id < ?'];
	const params: Array<string | number> = [userId, before ?? Number.MAX_SAFE_INTEGER];
	if (filter === 'unread') {
		clauses.push('read_at IS NULL');
	} else if (filter === 'mentions') {
		clauses.push(`kind IN (${MENTION_KINDS.map(() => '?').join(', ')})`);
		params.push(...MENTION_KINDS);
	}
	const rows = sql.exec<NotificationRow>(`SELECT * FROM notifications WHERE ${clauses.join(' AND ')} ORDER BY id DESC LIMIT ?`, ...params, SCAN).toArray();
	const shown = rows.filter(visibleTo(visible));
	const items = shown.slice(0, NOTIFICATION_LIMITS.page).map(toItem);
	const next = shown.length > NOTIFICATION_LIMITS.page ? items.at(-1)!.id : rows.length === SCAN ? rows.at(-1)!.id : null;
	return { items, next, unread: unreadCount(sql, userId, visible) };
}

// Ne marque que ce que l'utilisateur voit ; renvoie le nombre de lignes touchées.
export function markNotificationsRead(sql: SqlStorage, userId: string, visible: Set<string>, ids: number[] | 'all', now = Date.now()): number {
	const rows = sql
		.exec<{ id: number; channel_id: string | null }>('SELECT id, channel_id FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)
		.toArray()
		.filter(visibleTo(visible));
	const wanted = ids === 'all' ? null : new Set(ids);
	const targets = rows.filter((row) => !wanted || wanted.has(row.id)).map((row) => row.id);
	for (let i = 0; i < targets.length; i += 50) {
		const chunk = targets.slice(i, i + 50);
		sql.exec(`UPDATE notifications SET read_at = ? WHERE id IN (${chunk.map(() => '?').join(', ')})`, now, ...chunk);
	}
	return targets.length;
}

// Salon lu jusqu'à `messageId` : ses notifications de message le sont aussi.
export function markChannelNotificationsRead(sql: SqlStorage, userId: string, channelId: string, messageId: number, now = Date.now()): number {
	return sql.exec('UPDATE notifications SET read_at = ? WHERE user_id = ? AND channel_id = ? AND message_id <= ? AND read_at IS NULL', now, userId, channelId, messageId).rowsWritten;
}

export function notificationPrefs(sql: SqlStorage, userId: string, visible: Set<string>): Record<string, NotifyLevel> {
	return Object.fromEntries(
		sql
			.exec<{ channel_id: string; level: NotifyLevel }>('SELECT channel_id, level FROM notification_prefs WHERE user_id = ?', userId)
			.toArray()
			.filter((row) => visible.has(row.channel_id))
			.map((row) => [row.channel_id, row.level]),
	);
}

export function setNotifyLevel(sql: SqlStorage, userId: string, channelId: string, level: NotifyLevel): void {
	if (level === DEFAULT_NOTIFY_LEVEL) {
		sql.exec('DELETE FROM notification_prefs WHERE user_id = ? AND channel_id = ?', userId, channelId);
	} else {
		sql.exec(
			'INSERT INTO notification_prefs (user_id, channel_id, level) VALUES (?, ?, ?) ON CONFLICT (user_id, channel_id) DO UPDATE SET level = excluded.level',
			userId,
			channelId,
			level,
		);
	}
}

export function forgetNotifications(sql: SqlStorage, userId: string): void {
	sql.exec('DELETE FROM notifications WHERE user_id = ?', userId);
	sql.exec('DELETE FROM notification_prefs WHERE user_id = ?', userId);
}
