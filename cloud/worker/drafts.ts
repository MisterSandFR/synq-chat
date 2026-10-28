import { DRAFT_LIMITS, type Draft, type ScheduledMessage, type ScheduledStatus } from '../shared/drafts';
import type { Attachment } from '../shared/types';
import { err, ok, type Result } from './result';

export const DRAFTS_MIGRATION = `CREATE TABLE drafts (
		user_id TEXT NOT NULL,
		channel_id TEXT NOT NULL,
		thread_root INTEGER NOT NULL DEFAULT 0,
		body TEXT NOT NULL DEFAULT '',
		attachments TEXT,
		updated_at INTEGER NOT NULL,
		PRIMARY KEY (user_id, channel_id, thread_root)
	);
	CREATE TABLE scheduled_messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		workspace_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		channel_id TEXT NOT NULL,
		thread_root INTEGER NOT NULL DEFAULT 0,
		body TEXT NOT NULL DEFAULT '',
		attachments TEXT,
		reply_to INTEGER,
		send_at INTEGER NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		error TEXT,
		created_at INTEGER NOT NULL
	);
	CREATE INDEX scheduled_due ON scheduled_messages (status, send_at);
	CREATE INDEX scheduled_user ON scheduled_messages (user_id, send_at);
	CREATE INDEX messages_user ON messages (user_id, id);
	CREATE TRIGGER drafts_channel_ad AFTER DELETE ON channels BEGIN
		DELETE FROM drafts WHERE channel_id = old.id;
	END;`;

type DraftRow = { channel_id: string; thread_root: number; body: string; attachments: string | null; updated_at: number };

type ScheduledRow = {
	id: number;
	workspace_id: string;
	user_id: string;
	channel_id: string;
	thread_root: number;
	body: string;
	attachments: string | null;
	reply_to: number | null;
	send_at: number;
	status: ScheduledStatus;
	error: string | null;
	created_at: number;
};

export type ScheduledFull = ScheduledMessage & { workspaceId: string; userId: string };

export type ScheduleInput = {
	channelId: string;
	threadRoot: number;
	body: string;
	attachments: Attachment[];
	replyTo: number | null;
	sendAt: number;
};

const files = (raw: string | null): Attachment[] => (raw ? (JSON.parse(raw) as Attachment[]) : []);

const toDraft = (row: DraftRow): Draft => ({
	channelId: row.channel_id,
	threadRoot: row.thread_root,
	body: row.body,
	attachments: files(row.attachments),
	updatedAt: row.updated_at,
});

const toScheduled = (row: ScheduledRow): ScheduledFull => ({
	id: row.id,
	workspaceId: row.workspace_id,
	userId: row.user_id,
	channelId: row.channel_id,
	threadRoot: row.thread_root,
	body: row.body,
	attachments: files(row.attachments),
	replyTo: row.reply_to,
	sendAt: row.send_at,
	status: row.status,
	error: row.error,
	createdAt: row.created_at,
});

export const publicScheduled = ({ workspaceId: _w, userId: _u, ...rest }: ScheduledFull): ScheduledMessage => rest;

export function readDrafts(sql: SqlStorage, userId: string): Draft[] {
	return sql.exec<DraftRow>('SELECT channel_id, thread_root, body, attachments, updated_at FROM drafts WHERE user_id = ? ORDER BY updated_at DESC', userId).toArray().map(toDraft);
}

// Brouillon vide = supprimé.
export function writeDraft(sql: SqlStorage, userId: string, channelId: string, threadRoot: number, body: string, attachments: Attachment[], now = Date.now()): Draft | null {
	if (!body.trim() && !attachments.length) {
		sql.exec('DELETE FROM drafts WHERE user_id = ? AND channel_id = ? AND thread_root = ?', userId, channelId, threadRoot);
		return null;
	}
	const row = sql
		.exec<DraftRow>(
			`INSERT INTO drafts (user_id, channel_id, thread_root, body, attachments, updated_at) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (user_id, channel_id, thread_root) DO UPDATE SET body = excluded.body, attachments = excluded.attachments, updated_at = excluded.updated_at
			RETURNING channel_id, thread_root, body, attachments, updated_at`,
			userId,
			channelId,
			threadRoot,
			body,
			attachments.length ? JSON.stringify(attachments) : null,
			now,
		)
		.one();
	return toDraft(row);
}

export function dropDraft(sql: SqlStorage, userId: string, channelId: string, threadRoot: number): boolean {
	return sql.exec('DELETE FROM drafts WHERE user_id = ? AND channel_id = ? AND thread_root = ?', userId, channelId, threadRoot).rowsWritten > 0;
}

export function checkSendAt(sendAt: unknown, now = Date.now()): Result<number> {
	if (typeof sendAt !== 'number' || !Number.isInteger(sendAt)) {
		return err(400, 'Heure d’envoi invalide');
	}
	if (sendAt <= now) {
		return err(400, 'Choisis une heure à venir');
	}
	if (sendAt > now + DRAFT_LIMITS.scheduleAhead) {
		return err(400, 'Programmation limitée à 120 jours');
	}
	return ok(sendAt);
}

export function listScheduled(sql: SqlStorage, userId: string): ScheduledFull[] {
	return sql.exec<ScheduledRow>('SELECT * FROM scheduled_messages WHERE user_id = ? ORDER BY send_at, id', userId).toArray().map(toScheduled);
}

export function countScheduled(sql: SqlStorage, userId: string): number {
	return sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM scheduled_messages WHERE user_id = ?', userId).one().n;
}

export function getScheduled(sql: SqlStorage, id: number): ScheduledFull | null {
	const row = sql.exec<ScheduledRow>('SELECT * FROM scheduled_messages WHERE id = ?', id).toArray()[0];
	return row ? toScheduled(row) : null;
}

export function insertScheduled(sql: SqlStorage, workspaceId: string, userId: string, input: ScheduleInput, now = Date.now()): ScheduledFull {
	const row = sql
		.exec<ScheduledRow>(
			`INSERT INTO scheduled_messages (workspace_id, user_id, channel_id, thread_root, body, attachments, reply_to, send_at, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
			workspaceId,
			userId,
			input.channelId,
			input.threadRoot,
			input.body,
			input.attachments.length ? JSON.stringify(input.attachments) : null,
			input.replyTo,
			input.sendAt,
			now,
		)
		.one();
	return toScheduled(row);
}

export function moveScheduled(sql: SqlStorage, id: number, sendAt: number): void {
	sql.exec("UPDATE scheduled_messages SET send_at = ?, status = 'pending', error = NULL WHERE id = ?", sendAt, id);
}

export function failScheduled(sql: SqlStorage, id: number, error: string): void {
	sql.exec("UPDATE scheduled_messages SET status = 'failed', error = ? WHERE id = ?", error.slice(0, 200), id);
}

export function deleteScheduled(sql: SqlStorage, id: number): void {
	sql.exec('DELETE FROM scheduled_messages WHERE id = ?', id);
}

export function dueScheduled(sql: SqlStorage, now: number): ScheduledFull[] {
	return sql.exec<ScheduledRow>("SELECT * FROM scheduled_messages WHERE status = 'pending' AND send_at <= ? ORDER BY send_at, id LIMIT 50", now).toArray().map(toScheduled);
}

export function nextScheduledAt(sql: SqlStorage): number | null {
	return sql.exec<{ at: number | null }>("SELECT MIN(send_at) AS at FROM scheduled_messages WHERE status = 'pending'").one().at;
}
