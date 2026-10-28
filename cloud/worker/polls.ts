import { emojiByChar } from '../shared/emoji';
import { CUSTOM_REACTION_RE } from '../shared/emojis';
import { POLL_DURATIONS, POLL_LIMITS, pollClosed, type Poll, type PollInput } from '../shared/polls';
import type { Message } from '../shared/types';
import { err, ok, type Result } from './result';

export const POLLS_MIGRATION = `CREATE TABLE polls (
		message_id INTEGER PRIMARY KEY,
		question TEXT NOT NULL,
		options TEXT NOT NULL,
		multiple INTEGER NOT NULL DEFAULT 0,
		anonymous INTEGER NOT NULL DEFAULT 0,
		allow_add INTEGER NOT NULL DEFAULT 0,
		closes_at INTEGER,
		closed_at INTEGER
	);
	CREATE INDEX polls_open ON polls (closes_at) WHERE closed_at IS NULL AND closes_at IS NOT NULL;
	CREATE TABLE poll_votes (
		message_id INTEGER NOT NULL,
		option_id TEXT NOT NULL,
		user_id TEXT NOT NULL,
		voted_at INTEGER NOT NULL,
		PRIMARY KEY (message_id, user_id, option_id)
	);
	CREATE TRIGGER polls_message_ad AFTER DELETE ON messages BEGIN
		DELETE FROM polls WHERE message_id = old.id;
		DELETE FROM poll_votes WHERE message_id = old.id;
	END;`;

type StoredOption = { id: string; text: string; emoji: string };

export type PollSpec = {
	question: string;
	options: StoredOption[];
	multiple: boolean;
	anonymous: boolean;
	allowAdd: boolean;
	closesAt: number | null;
	threadRoot: number | null;
};

export type PollRow = {
	message_id: number;
	question: string;
	options: string;
	multiple: number;
	anonymous: number;
	allow_add: number;
	closes_at: number | null;
	closed_at: number | null;
};

const newOptionId = () => crypto.randomUUID().slice(0, 8);

function cleanEmoji(raw: unknown): Result<string> {
	const emoji = typeof raw === 'string' ? raw.trim() : '';
	if (emoji && !emojiByChar.has(emoji) && !CUSTOM_REACTION_RE.test(emoji)) {
		return err(400, 'Emoji inconnu');
	}
	return ok(emoji);
}

export function cleanOption(raw: unknown, taken: StoredOption[]): Result<StoredOption> {
	const input = raw && typeof raw === 'object' ? (raw as { text?: unknown; emoji?: unknown }) : {};
	const text = typeof input.text === 'string' ? input.text.trim().replace(/\s+/g, ' ') : '';
	if (!text) {
		return err(400, 'Option vide');
	}
	if (text.length > POLL_LIMITS.option) {
		return err(400, `Option trop longue (${POLL_LIMITS.option} caractères max)`);
	}
	if (taken.some((o) => o.text.toLowerCase() === text.toLowerCase())) {
		return err(409, 'Option déjà proposée');
	}
	const emoji = cleanEmoji(input.emoji);
	return emoji.ok ? ok({ id: newOptionId(), text, emoji: emoji.value }) : emoji;
}

export function cleanPoll(raw: Partial<PollInput>, now: number): Result<PollSpec> {
	const question = typeof raw.question === 'string' ? raw.question.trim() : '';
	if (!question) {
		return err(400, 'Question requise');
	}
	if (question.length > POLL_LIMITS.question) {
		return err(400, `Question trop longue (${POLL_LIMITS.question} caractères max)`);
	}
	const list = Array.isArray(raw.options) ? raw.options : [];
	if (list.length < POLL_LIMITS.minOptions || list.length > POLL_LIMITS.maxOptions) {
		return err(400, `De ${POLL_LIMITS.minOptions} à ${POLL_LIMITS.maxOptions} options`);
	}
	const options: StoredOption[] = [];
	for (const item of list) {
		const option = cleanOption(item, options);
		if (!option.ok) {
			return option;
		}
		options.push(option.value);
	}
	const duration = raw.duration ?? null;
	if (!POLL_DURATIONS.some((d) => d.value === duration)) {
		return err(400, 'Durée invalide');
	}
	const threadRoot = typeof raw.threadRoot === 'number' && Number.isInteger(raw.threadRoot) && raw.threadRoot > 0 ? raw.threadRoot : null;
	return ok({
		question,
		options,
		multiple: raw.multiple === true,
		anonymous: raw.anonymous === true,
		allowAdd: raw.allowAdd === true,
		closesAt: duration === null ? null : now + duration,
		threadRoot,
	});
}

export function insertPoll(sql: SqlStorage, messageId: number, spec: PollSpec): void {
	sql.exec(
		'INSERT INTO polls (message_id, question, options, multiple, anonymous, allow_add, closes_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
		messageId,
		spec.question,
		JSON.stringify(spec.options),
		spec.multiple ? 1 : 0,
		spec.anonymous ? 1 : 0,
		spec.allowAdd ? 1 : 0,
		spec.closesAt,
	);
}

export const pollRow = (sql: SqlStorage, messageId: number): PollRow | null =>
	sql.exec<PollRow>('SELECT * FROM polls WHERE message_id = ?', messageId).toArray()[0] ?? null;

export const storedOptions = (row: PollRow) => JSON.parse(row.options) as StoredOption[];

export const isClosed = (row: PollRow, now = Date.now()) => pollClosed({ closesAt: row.closes_at, closedAt: row.closed_at }, now);

// `viewerId` nul : résumé commun, sans « mes votes ».
export function pollSummaries(sql: SqlStorage, messageIds: number[], viewerId: string | null): Map<number, Poll> {
	const out = new Map<number, Poll>();
	if (!messageIds.length) {
		return out;
	}
	const ids = JSON.stringify(messageIds);
	const rows = sql.exec<PollRow>('SELECT * FROM polls WHERE message_id IN (SELECT value FROM json_each(?))', ids).toArray();
	if (!rows.length) {
		return out;
	}
	const votes = sql
		.exec<{ message_id: number; option_id: string; user_id: string }>(
			'SELECT message_id, option_id, user_id FROM poll_votes WHERE message_id IN (SELECT value FROM json_each(?)) ORDER BY voted_at',
			ids,
		)
		.toArray();
	for (const row of rows) {
		const cast = votes.filter((v) => v.message_id === row.message_id);
		const anonymous = row.anonymous === 1;
		const options = storedOptions(row);
		const chosen = new Set(cast.filter((v) => v.user_id === viewerId).map((v) => v.option_id));
		out.set(row.message_id, {
			question: row.question,
			options: options.map((o) => {
				const voters = cast.filter((v) => v.option_id === o.id).map((v) => v.user_id);
				return { ...o, count: voters.length, ...(anonymous ? {} : { voters: voters.slice(0, POLL_LIMITS.votersShown) }) };
			}),
			multiple: row.multiple === 1,
			anonymous,
			allowAdd: row.allow_add === 1,
			closesAt: row.closes_at,
			closedAt: row.closed_at,
			voters: new Set(cast.map((v) => v.user_id)).size,
			mine: viewerId === null ? null : options.filter((o) => chosen.has(o.id)).map((o) => o.id),
		});
	}
	return out;
}

export function attachPolls(sql: SqlStorage, messages: Message[], viewerId: string | null): Message[] {
	const polls = pollSummaries(sql, messages.map((m) => m.id), viewerId);
	return polls.size ? messages.map((m) => (polls.has(m.id) ? { ...m, poll: polls.get(m.id)! } : m)) : messages;
}

// Remplace les votes du lecteur ; liste vide = vote retiré.
export function setVotes(sql: SqlStorage, row: PollRow, userId: string, raw: unknown, now: number): Result<null> {
	const optionIds = Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === 'string'))] : null;
	if (!optionIds) {
		return err(400, 'Options requises');
	}
	const known = new Set(storedOptions(row).map((o) => o.id));
	if (optionIds.some((id) => !known.has(id))) {
		return err(400, 'Option inconnue');
	}
	if (row.multiple !== 1 && optionIds.length > 1) {
		return err(400, 'Un seul choix possible');
	}
	sql.exec('DELETE FROM poll_votes WHERE message_id = ? AND user_id = ?', row.message_id, userId);
	for (const id of optionIds) {
		sql.exec('INSERT INTO poll_votes (message_id, option_id, user_id, voted_at) VALUES (?, ?, ?, ?)', row.message_id, id, userId, now);
	}
	return ok(null);
}

export function addOption(sql: SqlStorage, row: PollRow, raw: unknown): Result<null> {
	const options = storedOptions(row);
	if (options.length >= POLL_LIMITS.maxOptions) {
		return err(409, `${POLL_LIMITS.maxOptions} options au maximum`);
	}
	const option = cleanOption(raw, options);
	if (!option.ok) {
		return option;
	}
	sql.exec('UPDATE polls SET options = ? WHERE message_id = ?', JSON.stringify([...options, option.value]), row.message_id);
	return ok(null);
}

export const closePollRow = (sql: SqlStorage, messageId: number, now: number) =>
	sql.exec('UPDATE polls SET closed_at = ? WHERE message_id = ? AND closed_at IS NULL', now, messageId).rowsWritten > 0;

export const nextPollClose = (sql: SqlStorage): number | null =>
	sql.exec<{ at: number | null }>('SELECT MIN(closes_at) AS at FROM polls WHERE closed_at IS NULL AND closes_at IS NOT NULL').one().at;

export const duePolls = (sql: SqlStorage, now: number): number[] =>
	sql
		.exec<{ message_id: number }>('SELECT message_id FROM polls WHERE closed_at IS NULL AND closes_at IS NOT NULL AND closes_at <= ? ORDER BY closes_at LIMIT 100', now)
		.toArray()
		.map((r) => r.message_id);

// Texte de la notification de clôture : jamais de votant.
export function closingText(poll: Poll): string {
	const top = Math.max(0, ...poll.options.map((o) => o.count));
	if (!top) {
		return `${poll.question} Aucun vote.`;
	}
	const winners = poll.options.filter((o) => o.count === top).map((o) => o.text);
	const votes = `${top} vote${top > 1 ? 's' : ''}`;
	return winners.length > 1 ? `${poll.question} Ex aequo : ${winners.join(', ')} (${votes}).` : `${poll.question} Gagnant : ${winners[0]} (${votes}).`;
}
