import type { DirectConversation } from '../shared/dm-threads';

type DirectRow = {
	id: string;
	created_at: number;
	dm_group: number;
	dm_name: string;
	members: string | null;
	last_user: string | null;
	last_body: string | null;
	last_at: number | null;
};

// Dernier message hors réponses de fil non diffusées.
const DIRECT_SELECT = `SELECT c.id, c.created_at, c.dm_group, c.dm_name,
		(SELECT group_concat(x.user_id) FROM dm_members x WHERE x.channel_id = c.id) AS members,
		l.user_id AS last_user, substr(l.body, 1, 200) AS last_body, l.created_at AS last_at
	FROM channels c
	LEFT JOIN messages l ON l.id = (SELECT MAX(id) FROM messages WHERE channel_id = c.id AND (thread_root IS NULL OR thread_broadcast = 1))`;

const toDirect = (row: DirectRow): DirectConversation => ({
	id: row.id,
	memberIds: (row.members ?? '').split(',').filter(Boolean),
	group: row.dm_group === 1,
	name: row.dm_name,
	createdAt: row.created_at,
	last: row.last_at === null || row.last_user === null ? null : { userId: row.last_user, body: row.last_body ?? '', createdAt: row.last_at },
});

export function loadDmMembers(sql: SqlStorage): Map<string, string[]> {
	const members = new Map<string, string[]>();
	for (const row of sql.exec<{ channel_id: string; user_id: string }>('SELECT channel_id, user_id FROM dm_members').toArray()) {
		members.set(row.channel_id, [...(members.get(row.channel_id) ?? []), row.user_id]);
	}
	return members;
}

const membersKey = (ids: string[]) => [...ids].sort().join(',');

// Même groupe de participants : la conversation existante est rouverte.
export function findDirect(dms: Map<string, string[]>, userIds: string[]): string | null {
	const key = membersKey(userIds);
	for (const [id, members] of dms) {
		if (membersKey(members) === key) {
			return id;
		}
	}
	return null;
}

// Rangée `channels` de type dm : messages, non-lus, fichiers, vocal et temps réel réutilisés tels quels.
export function createDirect(sql: SqlStorage, userIds: string[], name: string): string {
	const id = crypto.randomUUID();
	sql.exec(
		"INSERT INTO channels (id, name, kind, topic, category, position, created_at, dm_group, dm_name) VALUES (?, ?, 'dm', '', '', 0, ?, ?, ?)",
		id,
		`dm-${id}`,
		Date.now(),
		userIds.length > 2 || name ? 1 : 0,
		name,
	);
	for (const userId of userIds) {
		sql.exec('INSERT INTO dm_members (channel_id, user_id) VALUES (?, ?)', id, userId);
	}
	return id;
}

export function changeDirect(sql: SqlStorage, channelId: string, change: { add: string[]; remove?: string; name?: string }): void {
	for (const userId of change.add) {
		sql.exec('INSERT OR IGNORE INTO dm_members (channel_id, user_id) VALUES (?, ?)', channelId, userId);
	}
	if (change.remove !== undefined) {
		sql.exec('DELETE FROM dm_members WHERE channel_id = ? AND user_id = ?', channelId, change.remove);
	}
	if (change.name !== undefined) {
		sql.exec('UPDATE channels SET dm_name = ? WHERE id = ?', change.name, channelId);
	}
}

export function directById(sql: SqlStorage, channelId: string): DirectConversation | null {
	const row = sql.exec<DirectRow>(`${DIRECT_SELECT} WHERE c.id = ? AND c.kind = 'dm'`, channelId).toArray()[0];
	return row ? toDirect(row) : null;
}

export function listDirects(sql: SqlStorage, userId: string): DirectConversation[] {
	return sql
		.exec<DirectRow>(`${DIRECT_SELECT} JOIN dm_members d ON d.channel_id = c.id WHERE d.user_id = ? ORDER BY COALESCE(l.created_at, c.created_at) DESC`, userId)
		.toArray()
		.map(toDirect);
}

export function follow(sql: SqlStorage, userId: string, rootId: number, readUpTo: number | null): void {
	sql.exec(
		`INSERT INTO thread_follows (user_id, root_id, last_read_id) VALUES (?1, ?2, ?3)
		ON CONFLICT (user_id, root_id) DO UPDATE SET last_read_id = max(last_read_id, excluded.last_read_id)`,
		userId,
		rootId,
		readUpTo ?? 0,
	);
}

export function unfollow(sql: SqlStorage, userId: string, rootId: number): void {
	sql.exec('DELETE FROM thread_follows WHERE user_id = ? AND root_id = ?', userId, rootId);
}

export function isFollowing(sql: SqlStorage, userId: string, rootId: number): boolean {
	return sql.exec('SELECT 1 FROM thread_follows WHERE user_id = ? AND root_id = ?', userId, rootId).toArray().length > 0;
}

export function lastReplyId(sql: SqlStorage, rootId: number): number {
	return sql.exec<{ max: number | null }>('SELECT MAX(id) AS max FROM messages WHERE thread_root = ?', rootId).one().max ?? 0;
}

export function markThreadRead(sql: SqlStorage, userId: string, rootId: number): void {
	sql.exec('UPDATE thread_follows SET last_read_id = ? WHERE user_id = ? AND root_id = ?', lastReplyId(sql, rootId), userId, rootId);
}

export function followedRows(sql: SqlStorage, userId: string): Array<{ rootId: number; unread: number }> {
	return sql
		.exec<{ root_id: number; unread: number }>(
			`SELECT f.root_id,
				(SELECT COUNT(*) FROM messages t WHERE t.thread_root = f.root_id AND t.id > f.last_read_id AND t.user_id != ?1) AS unread
			FROM thread_follows f WHERE f.user_id = ?1`,
			userId,
		)
		.toArray()
		.map((row) => ({ rootId: row.root_id, unread: row.unread }));
}
