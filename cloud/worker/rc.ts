import { RC_LIMITS, type Announcement } from '../shared/rc';
import { err, ok, type Result } from './result';

// Destinataire fictif d'un @all : compte pour chaque lecteur du salon.
export const EVERYONE = '*';

export function insertMentions(sql: SqlStorage, messageId: number, userIds: string[]): void {
	for (const userId of userIds) {
		sql.exec('INSERT OR IGNORE INTO mentions (message_id, user_id) VALUES (?, ?)', messageId, userId);
	}
}

export function savedRows(sql: SqlStorage, userId: string): Array<{ message_id: number; created_at: number }> {
	return sql
		.exec<{ message_id: number; created_at: number }>('SELECT message_id, created_at FROM saved WHERE user_id = ? ORDER BY created_at DESC, message_id DESC LIMIT ?', userId, RC_LIMITS.saved)
		.toArray();
}

export function writeSaved(sql: SqlStorage, userId: string, messageId: number, saved: boolean): Result<{ saved: boolean }> {
	if (!saved) {
		sql.exec('DELETE FROM saved WHERE user_id = ? AND message_id = ?', userId, messageId);
		return ok({ saved });
	}
	if (sql.exec('SELECT 1 FROM saved WHERE user_id = ? AND message_id = ?', userId, messageId).toArray().length) {
		return ok({ saved });
	}
	const { n } = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM saved WHERE user_id = ?', userId).one();
	if (n >= RC_LIMITS.saved) {
		return err(400, `Limite de ${RC_LIMITS.saved} messages enregistrés atteinte`);
	}
	sql.exec('INSERT INTO saved (user_id, message_id, created_at) VALUES (?, ?, ?)', userId, messageId, Date.now());
	return ok({ saved });
}

export function readAnnouncement(sql: SqlStorage, channelId: string): Announcement {
	const row = sql
		.exec<{ text: string; updated_by: string; updated_at: number }>('SELECT text, updated_by, updated_at FROM announcements WHERE channel_id = ?', channelId)
		.toArray()[0];
	return { channelId, text: row?.text ?? '', updatedBy: row?.updated_by ?? null, updatedAt: row?.updated_at ?? null };
}

export function writeAnnouncement(sql: SqlStorage, channelId: string, text: string, userId: string): Announcement {
	if (text) {
		sql.exec(
			'INSERT INTO announcements (channel_id, text, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (channel_id) DO UPDATE SET text = excluded.text, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
			channelId,
			text,
			userId,
			Date.now(),
		);
	} else {
		sql.exec('DELETE FROM announcements WHERE channel_id = ?', channelId);
	}
	return readAnnouncement(sql, channelId);
}
