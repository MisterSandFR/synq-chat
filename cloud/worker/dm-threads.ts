import type { DirectConversation } from '../shared/dm-threads';
import type { Actor } from '../shared/types';

type DirectRow = {
	id: string;
	created_at: number;
	dm_group: number;
	dm_name: string;
	members: string | null;
	grades: string | null;
	last_user: string | null;
	last_body: string | null;
	last_at: number | null;
};

// Dernier message hors réponses de fil non diffusées.
const DIRECT_SELECT = `SELECT c.id, c.created_at, c.dm_group, c.dm_name,
		(SELECT group_concat(x.user_id) FROM dm_members x WHERE x.channel_id = c.id) AS members,
		(SELECT group_concat(g.grade_id) FROM dm_grades g WHERE g.channel_id = c.id) AS grades,
		l.user_id AS last_user, substr(l.body, 1, 200) AS last_body, l.created_at AS last_at
	FROM channels c
	LEFT JOIN messages l ON l.id = (SELECT MAX(id) FROM messages WHERE channel_id = c.id AND (thread_root IS NULL OR thread_broadcast = 1))`;

function toDirect(row: DirectRow, dms: Map<string, string[]>): DirectConversation {
	const addedIds = (row.members ?? '').split(',').filter(Boolean);
	return {
		id: row.id,
		memberIds: dms.get(row.id) ?? addedIds,
		addedIds,
		gradeIds: (row.grades ?? '').split(',').filter(Boolean),
		group: row.dm_group === 1,
		name: row.dm_name,
		createdAt: row.created_at,
		last: row.last_at === null || row.last_user === null ? null : { userId: row.last_user, body: row.last_body ?? '', createdAt: row.last_at },
	};
}

// Participants effectifs : ajoutés un à un, plus porteurs des grades liés (jamais d'invité, absent de `grade_holders`).
export function loadDmMembers(sql: SqlStorage): Map<string, string[]> {
	const members = new Map<string, Set<string>>();
	const rows = sql
		.exec<{ channel_id: string; user_id: string }>(
			'SELECT channel_id, user_id FROM dm_members UNION SELECT g.channel_id, h.user_id FROM dm_grades g JOIN grade_holders h ON h.grade_id = g.grade_id',
		)
		.toArray();
	for (const row of rows) {
		members.set(row.channel_id, (members.get(row.channel_id) ?? new Set<string>()).add(row.user_id));
	}
	return new Map([...members].map(([id, set]) => [id, [...set]]));
}

// Copie des porteurs de grade : le DO décide l'accès sans lire D1.
export function syncHolders(sql: SqlStorage, actors: Actor[]): void {
	sql.exec('DELETE FROM grade_holders');
	for (const actor of actors.filter((a) => !a.guest)) {
		for (const gradeId of actor.grades) {
			sql.exec('INSERT OR IGNORE INTO grade_holders (grade_id, user_id) VALUES (?, ?)', gradeId, actor.id);
		}
	}
}

const membersKey = (ids: string[]) => [...ids].sort().join(',');

// Même groupe de participants : la conversation existante est rouverte ; jamais un groupe lié à des grades.
export function findDirect(sql: SqlStorage, userIds: string[]): string | null {
	const key = membersKey(userIds);
	const rows = sql
		.exec<{ channel_id: string; members: string }>(
			'SELECT channel_id, group_concat(user_id) AS members FROM dm_members WHERE channel_id NOT IN (SELECT channel_id FROM dm_grades) GROUP BY channel_id',
		)
		.toArray();
	return rows.find((row) => membersKey(row.members.split(',')) === key)?.channel_id ?? null;
}

// Rangée `channels` de type dm : messages, non-lus, fichiers, vocal et temps réel réutilisés tels quels.
export function createDirect(sql: SqlStorage, userIds: string[], name: string, gradeIds: string[] = [], forceGroup = false): string {
	const id = crypto.randomUUID();
	sql.exec(
		"INSERT INTO channels (id, name, kind, topic, category, position, created_at, dm_group, dm_name) VALUES (?, ?, 'dm', '', '', 0, ?, ?, ?)",
		id,
		`dm-${id}`,
		Date.now(),
		forceGroup || userIds.length > 2 || name || gradeIds.length ? 1 : 0,
		name,
	);
	for (const userId of userIds) {
		sql.exec('INSERT INTO dm_members (channel_id, user_id) VALUES (?, ?)', id, userId);
	}
	for (const gradeId of gradeIds) {
		sql.exec('INSERT INTO dm_grades (channel_id, grade_id) VALUES (?, ?)', id, gradeId);
	}
	return id;
}

export function changeDirect(sql: SqlStorage, channelId: string, change: { add: string[]; remove?: string; name?: string; addGrades?: string[]; removeGrade?: string }): void {
	for (const userId of change.add) {
		sql.exec('INSERT OR IGNORE INTO dm_members (channel_id, user_id) VALUES (?, ?)', channelId, userId);
	}
	if (change.remove !== undefined) {
		sql.exec('DELETE FROM dm_members WHERE channel_id = ? AND user_id = ?', channelId, change.remove);
	}
	if (change.name !== undefined) {
		sql.exec('UPDATE channels SET dm_name = ? WHERE id = ?', change.name, channelId);
	}
	for (const gradeId of change.addGrades ?? []) {
		sql.exec('INSERT OR IGNORE INTO dm_grades (channel_id, grade_id) VALUES (?, ?)', channelId, gradeId);
	}
	if (change.removeGrade !== undefined) {
		sql.exec('DELETE FROM dm_grades WHERE channel_id = ? AND grade_id = ?', channelId, change.removeGrade);
	}
}

export function directById(sql: SqlStorage, channelId: string, dms: Map<string, string[]>): DirectConversation | null {
	const row = sql.exec<DirectRow>(`${DIRECT_SELECT} WHERE c.id = ? AND c.kind = 'dm'`, channelId).toArray()[0];
	return row ? toDirect(row, dms) : null;
}

export function listDirects(sql: SqlStorage, userId: string, dms: Map<string, string[]>): DirectConversation[] {
	return sql
		.exec<DirectRow>(`${DIRECT_SELECT} WHERE c.kind = 'dm' ORDER BY COALESCE(l.created_at, c.created_at) DESC`)
		.toArray()
		.filter((row) => dms.get(row.id)?.includes(userId))
		.map((row) => toDirect(row, dms));
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
