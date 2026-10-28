import { REMINDER_LIMITS, type Reminder } from '../shared/reminders';
import { err, ok, type Result } from './result';

// Pas de trigger sur messages : un rappel survit au message, affiché « indisponible ».
export const REMINDERS_MIGRATION = `CREATE TABLE reminders (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id TEXT NOT NULL,
	workspace_id TEXT NOT NULL,
	message_id INTEGER,
	text TEXT NOT NULL DEFAULT '',
	due_at INTEGER,
	fired_at INTEGER,
	done_at INTEGER,
	created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX reminders_message ON reminders (user_id, message_id);
CREATE INDEX reminders_due ON reminders (due_at) WHERE due_at IS NOT NULL AND fired_at IS NULL AND done_at IS NULL;`;

type Row = { id: number; user_id: string; workspace_id: string; message_id: number | null; text: string; due_at: number | null; fired_at: number | null; done_at: number | null; created_at: number };

export type ReminderFull = Reminder & { userId: string; workspaceId: string };

const toReminder = (row: Row): ReminderFull => ({
	id: row.id,
	userId: row.user_id,
	workspaceId: row.workspace_id,
	messageId: row.message_id,
	text: row.text,
	dueAt: row.due_at,
	firedAt: row.fired_at,
	doneAt: row.done_at,
	createdAt: row.created_at,
});

export const publicReminder = ({ userId: _u, workspaceId: _w, ...rest }: ReminderFull): Reminder => rest;

export const cleanReminderText = (raw: unknown) => (typeof raw === 'string' ? raw.trim().slice(0, REMINDER_LIMITS.text) : '');

export function checkDue(dueAt: number | null, now = Date.now()): Result<number | null> {
	if (dueAt === null) {
		return ok(null);
	}
	if (!Number.isSafeInteger(dueAt) || dueAt <= now) {
		return err(400, 'Échéance passée');
	}
	if (dueAt > now + REMINDER_LIMITS.horizon) {
		return err(400, 'Échéance trop lointaine');
	}
	return ok(dueAt);
}

export function userReminders(sql: SqlStorage, userId: string): ReminderFull[] {
	return sql.exec<Row>('SELECT * FROM reminders WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, REMINDER_LIMITS.perUser).toArray().map(toReminder);
}

export function getReminder(sql: SqlStorage, userId: string, id: number): ReminderFull | null {
	const row = sql.exec<Row>('SELECT * FROM reminders WHERE id = ? AND user_id = ?', id, userId).toArray()[0];
	return row ? toReminder(row) : null;
}

// Un seul rappel par message et par personne : le reposer remplace l'échéance.
export function upsertReminder(
	sql: SqlStorage,
	workspaceId: string,
	userId: string,
	input: { messageId: number | null; text: string; dueAt: number | null; done: boolean },
	now = Date.now(),
): Result<ReminderFull> {
	const existing =
		input.messageId === null ? undefined : sql.exec<{ id: number }>('SELECT id FROM reminders WHERE user_id = ? AND message_id = ?', userId, input.messageId).toArray()[0];
	if (existing) {
		sql.exec('UPDATE reminders SET due_at = ?, fired_at = NULL, done_at = ? WHERE id = ?', input.dueAt, input.done ? now : null, existing.id);
		return ok(getReminder(sql, userId, existing.id)!);
	}
	const { n } = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM reminders WHERE user_id = ?', userId).one();
	if (n >= REMINDER_LIMITS.perUser) {
		return err(400, `Limite de ${REMINDER_LIMITS.perUser} rappels atteinte`);
	}
	const row = sql
		.exec<Row>(
			'INSERT INTO reminders (user_id, workspace_id, message_id, text, due_at, done_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
			userId,
			workspaceId,
			input.messageId,
			input.text,
			input.dueAt,
			input.done ? now : null,
			now,
		)
		.one();
	return ok(toReminder(row));
}

export function patchReminder(sql: SqlStorage, reminder: ReminderFull, patch: { dueAt?: number | null; done?: boolean }, now = Date.now()): ReminderFull {
	if (patch.dueAt !== undefined) {
		sql.exec('UPDATE reminders SET due_at = ?, fired_at = NULL WHERE id = ?', patch.dueAt, reminder.id);
	}
	if (patch.done !== undefined) {
		sql.exec('UPDATE reminders SET done_at = ? WHERE id = ?', patch.done ? now : null, reminder.id);
	}
	return getReminder(sql, reminder.userId, reminder.id)!;
}

export function deleteReminder(sql: SqlStorage, id: number): void {
	sql.exec('DELETE FROM reminders WHERE id = ?', id);
}

export function deleteMessageReminder(sql: SqlStorage, userId: string, messageId: number): void {
	sql.exec('DELETE FROM reminders WHERE user_id = ? AND message_id = ?', userId, messageId);
}

export function dueReminders(sql: SqlStorage, now: number): ReminderFull[] {
	return sql
		.exec<Row>('SELECT * FROM reminders WHERE due_at IS NOT NULL AND due_at <= ? AND fired_at IS NULL AND done_at IS NULL ORDER BY due_at LIMIT 100', now)
		.toArray()
		.map(toReminder);
}

export function markFired(sql: SqlStorage, id: number, now: number): void {
	sql.exec('UPDATE reminders SET fired_at = ? WHERE id = ?', now, id);
}

export function nextReminderAt(sql: SqlStorage): number | null {
	return sql.exec<{ at: number | null }>('SELECT MIN(due_at) AS at FROM reminders WHERE due_at IS NOT NULL AND fired_at IS NULL AND done_at IS NULL').one().at;
}
