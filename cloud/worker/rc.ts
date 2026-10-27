import { FORWARD_EXCERPT, RC_LIMITS, WEBHOOK_LIMITS, type Announcement, type ForwardRef, type Webhook } from '../shared/rc';
import type { Message } from '../shared/types';
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

// Transfert d'un transfert sans ajout : on cite l'original.
export function forwardRef(source: Message): ForwardRef {
	if (source.forward && !source.body && !source.attachments.length) {
		return source.forward;
	}
	return { id: source.id, channelId: source.channelId, userId: source.userId, body: source.body.slice(0, FORWARD_EXCERPT), files: source.attachments.length, createdAt: source.createdAt };
}

type WebhookRow = { id: string; channel_id: string; name: string; created_by: string; created_at: number; last_used_at: number | null };

const WEBHOOK_COLUMNS = 'id, channel_id, name, created_by, created_at, last_used_at';

const toWebhook = (row: WebhookRow): Webhook => ({ id: row.id, channelId: row.channel_id, name: row.name, createdBy: row.created_by, createdAt: row.created_at, lastUsedAt: row.last_used_at });

export const cleanHookName = (raw: unknown) => (typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, WEBHOOK_LIMITS.name) : '');

export function listWebhooks(sql: SqlStorage, channelId: string): Webhook[] {
	return sql.exec<WebhookRow>(`SELECT ${WEBHOOK_COLUMNS} FROM webhooks WHERE channel_id = ? ORDER BY created_at`, channelId).toArray().map(toWebhook);
}

export function webhookById(sql: SqlStorage, id: string): Webhook | null {
	const row = sql.exec<WebhookRow>(`SELECT ${WEBHOOK_COLUMNS} FROM webhooks WHERE id = ?`, id).toArray()[0];
	return row ? toWebhook(row) : null;
}

export function insertWebhook(sql: SqlStorage, channelId: string, name: string, secretHash: string, userId: string): Result<Webhook> {
	const { n } = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM webhooks WHERE channel_id = ?', channelId).one();
	if (n >= WEBHOOK_LIMITS.perChannel) {
		return err(400, `Limite de ${WEBHOOK_LIMITS.perChannel} webhooks par salon atteinte`);
	}
	const id = crypto.randomUUID();
	sql.exec('INSERT INTO webhooks (id, channel_id, name, secret_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, channelId, name, secretHash, userId, Date.now());
	return ok(webhookById(sql, id)!);
}

export function rotateWebhookSecret(sql: SqlStorage, id: string, secretHash: string): void {
	sql.exec('UPDATE webhooks SET secret_hash = ? WHERE id = ?', secretHash, id);
}

export function removeWebhook(sql: SqlStorage, id: string): void {
	sql.exec('DELETE FROM webhooks WHERE id = ?', id);
}

// Comparaison sur le haché : le secret clair n'est jamais stocké.
export function matchWebhook(sql: SqlStorage, id: string, secretHash: string): Webhook | null {
	const row = sql.exec<WebhookRow>(`SELECT ${WEBHOOK_COLUMNS} FROM webhooks WHERE id = ? AND secret_hash = ?`, id, secretHash).toArray()[0];
	if (!row) {
		return null;
	}
	sql.exec('UPDATE webhooks SET last_used_at = ? WHERE id = ?', Date.now(), id);
	return toWebhook(row);
}
