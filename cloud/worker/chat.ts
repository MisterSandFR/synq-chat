import { MAX_PINS, MAX_REACTIONS, type PinInfo, type Reaction } from '../shared/chat';
import { emojiByChar } from '../shared/emoji';
import type { Message } from '../shared/types';
import { err, ok, type Result } from './result';

// json_each : un seul paramètre lié, quelle que soit la taille de la page.
function reactionMap(sql: SqlStorage, ids: number[]): Map<number, Reaction[]> {
	const out = new Map<number, Reaction[]>();
	const rows = sql.exec<{ message_id: number; emoji: string; users: string }>(
		`SELECT message_id, emoji, json_group_array(user_id) AS users FROM (
			SELECT rowid AS seq, * FROM reactions WHERE message_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, seq
		) GROUP BY message_id, emoji ORDER BY MIN(created_at), MIN(seq)`,
		JSON.stringify(ids),
	);
	for (const row of rows) {
		const list = out.get(row.message_id) ?? [];
		list.push({ emoji: row.emoji, users: JSON.parse(row.users) as string[] });
		out.set(row.message_id, list);
	}
	return out;
}

export function decorate(sql: SqlStorage, messages: Message[]): Message[] {
	if (!messages.length) {
		return messages;
	}
	const ids = messages.map((m) => m.id);
	const reactions = reactionMap(sql, ids);
	const pins = new Map(
		sql
			.exec<{ message_id: number; pinned_by: string; pinned_at: number }>(
				'SELECT message_id, pinned_by, pinned_at FROM pins WHERE message_id IN (SELECT value FROM json_each(?))',
				JSON.stringify(ids),
			)
			.toArray()
			.map((row) => [row.message_id, { by: row.pinned_by, at: row.pinned_at }] as const),
	);
	return messages.map((m) => ({ ...m, reactions: reactions.get(m.id) ?? [], pinned: pins.get(m.id) ?? null }));
}

export function toggleReaction(sql: SqlStorage, messageId: number, userId: string, emoji: string, add: boolean): Result<Reaction[]> {
	if (!emojiByChar.has(emoji)) {
		return err(400, 'Emoji inconnu');
	}
	if (add) {
		const present = sql.exec<{ emoji: string }>('SELECT DISTINCT emoji FROM reactions WHERE message_id = ?', messageId).toArray();
		if (present.length >= MAX_REACTIONS && !present.some((r) => r.emoji === emoji)) {
			return err(400, `${MAX_REACTIONS} réactions différentes au maximum`);
		}
		sql.exec('INSERT OR IGNORE INTO reactions (message_id, emoji, user_id, created_at) VALUES (?, ?, ?, ?)', messageId, emoji, userId, Date.now());
	} else {
		sql.exec('DELETE FROM reactions WHERE message_id = ? AND emoji = ? AND user_id = ?', messageId, emoji, userId);
	}
	return ok(reactionMap(sql, [messageId]).get(messageId) ?? []);
}

export function setPin(sql: SqlStorage, message: Message, userId: string, pinned: boolean): Result<PinInfo | null> {
	if (!pinned) {
		sql.exec('DELETE FROM pins WHERE message_id = ?', message.id);
		return ok(null);
	}
	if (message.pinned) {
		return ok(message.pinned);
	}
	const { n } = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM pins WHERE channel_id = ?', message.channelId).one();
	if (n >= MAX_PINS) {
		return err(400, `${MAX_PINS} messages épinglés au maximum par salon`);
	}
	const at = Date.now();
	sql.exec('INSERT INTO pins (message_id, channel_id, pinned_by, pinned_at) VALUES (?, ?, ?, ?)', message.id, message.channelId, userId, at);
	return ok({ by: userId, at });
}

export function dropExtras(sql: SqlStorage, messageId: number | null): void {
	sql.exec('DELETE FROM reactions WHERE message_id = ?', messageId);
	sql.exec('DELETE FROM pins WHERE message_id = ?', messageId);
}

export function dropChannelExtras(sql: SqlStorage, channelId: string): void {
	sql.exec('DELETE FROM reactions WHERE message_id IN (SELECT id FROM messages WHERE channel_id = ?)', channelId);
	sql.exec('DELETE FROM pins WHERE channel_id = ?', channelId);
}
