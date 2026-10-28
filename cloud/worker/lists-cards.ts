import { CARD_LIMITS, CARD_REMINDERS, LIST_LIMITS, type CardLink, type ListColumn, type ListItem, type ListValue } from '../shared/lists';
import { listCanvasRows, scopeOf } from './canvases';
import { columnsOf, createItem, itemRow, logActivity, touchList, type ListRow } from './lists';
import { checklistsOf, fieldsOf, fileKey, itemPeople, labelsOf, sendNotice } from './lists-bases';
import { err, ok, type Result } from './result';

const parse = <T>(raw: string | null | undefined, fallback: T): T => {
	try {
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
};

// --- Dupliquer, modèles ---

async function positionAfter(db: D1Database, listId: string, position: number): Promise<number> {
	const next = await db.prepare('SELECT MIN(position) AS p FROM list_items WHERE list_id = ? AND position > ?').bind(listId, position).first<{ p: number | null }>();
	return next?.p != null ? (position + next.p) / 2 : position + 1;
}

// Copie champs, valeurs et checklists ; ni commentaires ni pièces jointes. Une carte tirée d'un modèle repart de cases vides.
export async function duplicateCard(db: D1Database, list: ListRow, item: ListItem, userId: string, opts: { title: string; template: boolean; values: Record<string, ListValue> }): Promise<Result<ListItem>> {
	if ((list.item_count ?? 0) >= LIST_LIMITS.items) {
		return err(409, 'Base pleine');
	}
	const id = crypto.randomUUID();
	const now = Date.now();
	const fresh = item.template && !opts.template;
	const fields = fieldsOf(item);
	const cover = item.cover?.startsWith('file:') ? null : item.cover;
	const statements = [
		db
			.prepare(
				`INSERT INTO list_items (id, list_id, position, title, description, vals, labels, cover, start_date, due_date, done, created_by, created_at, updated_at,
					icon, cover_mode, cover_y, members, start_time, due_time, reminder, estimate, estimate_unit, template) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				id,
				list.id,
				await positionAfter(db, list.id, item.position),
				opts.title.trim().slice(0, LIST_LIMITS.titleLength),
				item.description,
				JSON.stringify(opts.values),
				JSON.stringify(fields.labels),
				cover,
				fields.startDate,
				fields.dueDate,
				fresh ? 0 : Number(fields.done),
				userId,
				now,
				now,
				fields.icon,
				fields.coverMode,
				fields.coverY,
				JSON.stringify(fields.members),
				fields.startTime,
				fields.dueTime,
				fields.reminder,
				fields.estimate,
				fields.estimateUnit,
				Number(opts.template),
			),
	];
	for (const checklist of await checklistsOf(db, item.id)) {
		const clid = crypto.randomUUID();
		statements.push(db.prepare('INSERT INTO list_checklists (id, item_id, title, position, created_at) VALUES (?, ?, ?, ?, ?)').bind(clid, id, checklist.title, checklist.position, now));
		for (const c of checklist.items) {
			statements.push(
				db
					.prepare('INSERT INTO list_checks (id, checklist_id, item_id, text, done, assignee, due, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
					.bind(crypto.randomUUID(), clid, id, c.text, fresh ? 0 : Number(c.done), c.assignee, c.due, c.position, now),
			);
		}
	}
	statements.push(logActivity(db, id, userId, fresh ? `a créé la carte depuis le modèle « ${item.title || 'Sans titre'} »` : `a dupliqué « ${item.title || 'Sans titre'} »`), touchList(db, list.id));
	await db.batch(statements);
	return ok((await itemRow(db, list.id, id))!);
}

// --- Déplacer vers une autre base ---

// Colonnes rapprochées par id puis par nom, statuts par libellé.
export function mapValues(source: ListColumn[], target: ListColumn[], values: Record<string, ListValue>): Record<string, ListValue> {
	const out: Record<string, ListValue> = {};
	for (const column of target) {
		const from = source.find((c) => c.id === column.id && c.type === column.type) ?? source.find((c) => c.type === column.type && c.name.toLowerCase() === column.name.toLowerCase());
		const value = from ? values[from.id] : undefined;
		if (value === undefined) {
			continue;
		}
		if (column.type === 'status') {
			const label = from!.options?.find((o) => o.id === value)?.label.toLowerCase();
			const option = column.options?.find((o) => o.label.toLowerCase() === label);
			if (option) {
				out[column.id] = option.id;
			}
		} else {
			out[column.id] = value;
		}
	}
	return out;
}

export async function moveCard(env: Env, from: ListRow, to: ListRow, item: ListItem, userId: string): Promise<Result<{ item: ListItem; stale: string[] }>> {
	if (from.id === to.id) {
		return err(400, 'La carte est déjà dans cette base');
	}
	if ((to.item_count ?? 0) >= LIST_LIMITS.items) {
		return err(409, 'Base pleine');
	}
	const db = env.DB;
	const source = labelsOf(from);
	const target = labelsOf(to);
	const labels = item.labels
		.map((id) => source.find((l) => l.id === id)?.name.toLowerCase())
		.map((name) => target.find((l) => l.name.toLowerCase() === name)?.id)
		.filter((id): id is string => Boolean(id));
	const last = await db.prepare('SELECT MAX(position) AS p FROM list_items WHERE list_id = ?').bind(to.id).first<{ p: number | null }>();
	const { results: files } = await db.prepare('SELECT id FROM list_attachments WHERE item_id = ?').bind(item.id).all<{ id: string }>();
	// Clés R2 rangées par base : copie avant bascule, ancienne clé supprimée ensuite.
	for (const file of files) {
		const object = await env.FILES.get(fileKey(from.workspace_id, from.id, file.id));
		if (object) {
			await env.FILES.put(fileKey(to.workspace_id, to.id, file.id), object.body, { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata });
		}
	}
	await db.batch([
		db
			.prepare('UPDATE list_items SET list_id = ?, position = ?, vals = ?, labels = ?, updated_at = ? WHERE id = ?')
			.bind(to.id, (last?.p ?? 0) + 1, JSON.stringify(mapValues(columnsOf(from), columnsOf(to), item.values)), JSON.stringify(labels), Date.now(), item.id),
		db.prepare('UPDATE list_attachments SET list_id = ? WHERE item_id = ?').bind(to.id, item.id),
		logActivity(db, item.id, userId, `a déplacé la carte de « ${from.title} » vers « ${to.title} »`, [{ field: 'Base', from: from.title, to: to.title }]),
		touchList(db, from.id),
		touchList(db, to.id),
	]);
	return ok({ item: (await itemRow(db, to.id, item.id))!, stale: files.map((f) => fileKey(from.workspace_id, from.id, f.id)) });
}

// --- Convertir un élément de checklist en carte ---

export async function checkToCard(db: D1Database, list: ListRow, item: ListItem, checkId: string, userId: string): Promise<Result<ListItem>> {
	const check = await db.prepare('SELECT text, done, assignee, due FROM list_checks WHERE id = ? AND item_id = ?').bind(checkId, item.id).first<{ text: string; done: number; assignee: string | null; due: string | null }>();
	if (!check) {
		return err(404, 'Élément de checklist introuvable');
	}
	// La nouvelle carte rejoint la colonne de sa carte d'origine.
	const values = Object.fromEntries(columnsOf(list).filter((c) => c.type === 'status' && item.values[c.id] !== undefined).map((c) => [c.id, item.values[c.id]!]));
	const created = await createItem(db, list, userId, { title: check.text }, values, { ...fieldsOf(null), members: check.assignee ? [check.assignee] : [], dueDate: check.due, done: Boolean(check.done) });
	if (!created.ok) {
		return created;
	}
	await db.batch([db.prepare('DELETE FROM list_checks WHERE id = ?').bind(checkId), logActivity(db, item.id, userId, `a converti « ${check.text} » en carte`)]);
	return created;
}

// --- Suivre ---

export async function setFollow(db: D1Database, itemId: string, userId: string, on: boolean): Promise<void> {
	await (on
		? db.prepare('INSERT OR IGNORE INTO list_follows (item_id, user_id, created_at) VALUES (?, ?, ?)').bind(itemId, userId, Date.now())
		: db.prepare('DELETE FROM list_follows WHERE item_id = ? AND user_id = ?').bind(itemId, userId)
	).run();
}

export async function followersOf(db: D1Database, itemId: string): Promise<string[]> {
	const { results } = await db.prepare('SELECT user_id FROM list_follows WHERE item_id = ?').bind(itemId).all<{ user_id: string }>();
	return results.map((r) => r.user_id);
}

// --- Liens vers des cartes et des pages ---

export type ScopedLink = CardLink & { scope: string | null };

export async function addLink(db: D1Database, workspaceId: string, item: ListItem, userId: string, input: { kind?: unknown; id?: unknown }): Promise<Result<null>> {
	if ((input.kind !== 'card' && input.kind !== 'page') || typeof input.id !== 'string' || !/^[\w-]{1,64}$/.test(input.id)) {
		return err(400, 'Lien invalide');
	}
	if (input.kind === 'card' && input.id === item.id) {
		return err(400, 'Une carte ne se lie pas à elle-même');
	}
	const target =
		input.kind === 'card'
			? await db.prepare('SELECT i.id FROM list_items i JOIN lists l ON l.id = i.list_id WHERE i.id = ? AND l.workspace_id = ?').bind(input.id, workspaceId).first()
			: await db.prepare('SELECT id FROM canvases WHERE id = ? AND workspace_id = ?').bind(input.id, workspaceId).first();
	if (!target) {
		return err(404, 'Cible introuvable');
	}
	const count = await db.prepare('SELECT COUNT(*) AS n FROM list_item_links WHERE item_id = ?').bind(item.id).first<{ n: number }>();
	if ((count?.n ?? 0) >= CARD_LIMITS.links) {
		return err(409, 'Trop de liens');
	}
	await db.prepare('INSERT OR IGNORE INTO list_item_links (item_id, kind, ref_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(item.id, input.kind, input.id, userId, Date.now()).run();
	return ok(null);
}

export async function removeLink(db: D1Database, itemId: string, kind: string, refId: string): Promise<Result<null>> {
	const done = await db.prepare('DELETE FROM list_item_links WHERE item_id = ? AND kind = ? AND ref_id = ?').bind(itemId, kind, refId).run();
	return done.meta.changes ? ok(null) : err(404, 'Lien introuvable');
}

type CardRef = { id: string; title: string; icon: string; done: number; list_id: string; list_title: string; channel_id: string | null };

const toCardLink = (r: CardRef): ScopedLink => ({ kind: 'card', id: r.id, title: r.title, icon: r.icon, listId: r.list_id, listTitle: r.list_title, done: Boolean(r.done), scope: r.channel_id });

// Portée renvoyée pour que la route filtre avec les droits existants.
export async function resolveLinks(db: D1Database, workspaceId: string, itemId: string): Promise<ScopedLink[]> {
	const { results } = await db.prepare('SELECT kind, ref_id FROM list_item_links WHERE item_id = ? ORDER BY created_at').bind(itemId).all<{ kind: string; ref_id: string }>();
	if (!results.length) {
		return [];
	}
	const { results: cards } = await db
		.prepare(
			`SELECT i.id, i.title, i.icon, i.done, l.id AS list_id, l.title AS list_title, l.channel_id FROM list_item_links k
			JOIN list_items i ON i.id = k.ref_id JOIN lists l ON l.id = i.list_id WHERE k.item_id = ? AND k.kind = 'card' AND l.workspace_id = ?`,
		)
		.bind(itemId, workspaceId)
		.all<CardRef>();
	const pages = results.some((r) => r.kind === 'page') ? await listCanvasRows(db, workspaceId) : [];
	const byId = new Map(pages.map((p) => [p.id, p]));
	return results.flatMap((r): ScopedLink[] => {
		if (r.kind === 'card') {
			const card = cards.find((c) => c.id === r.ref_id);
			return card ? [toCardLink(card)] : [];
		}
		const page = byId.get(r.ref_id);
		return page && !page.archived_at ? [{ kind: 'page', id: page.id, title: page.title, icon: page.icon ?? '', scope: scopeOf(page, byId) }] : [];
	});
}

export async function searchTargets(db: D1Database, workspaceId: string, query: string, exclude: string): Promise<ScopedLink[]> {
	const needle = query.trim().toLowerCase().slice(0, 60);
	const like = `%${needle.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
	const { results: cards } = await db
		.prepare(
			`SELECT i.id, i.title, i.icon, i.done, l.id AS list_id, l.title AS list_title, l.channel_id FROM list_items i JOIN lists l ON l.id = i.list_id
			WHERE l.workspace_id = ? AND i.id != ? AND i.archived_at IS NULL AND lower(i.title) LIKE ? ESCAPE '\\' ORDER BY i.updated_at DESC LIMIT 15`,
		)
		.bind(workspaceId, exclude, like)
		.all<CardRef>();
	const pages = await listCanvasRows(db, workspaceId);
	const byId = new Map(pages.map((p) => [p.id, p]));
	const found = pages
		.filter((p) => !p.archived_at && p.title.toLowerCase().includes(needle))
		.slice(0, 15)
		.map((p): ScopedLink => ({ kind: 'page', id: p.id, title: p.title, icon: p.icon ?? '', scope: scopeOf(p, byId) }));
	return [...cards.map(toCardLink), ...found];
}

// --- Réactions aux commentaires ---

export async function toggleReaction(db: D1Database, itemId: string, commentId: string, userId: string, raw: unknown): Promise<Result<null>> {
	const emoji = typeof raw === 'string' ? raw.trim() : '';
	if (!emoji || emoji.length > CARD_LIMITS.emoji || /\s/.test(emoji)) {
		return err(400, 'Réaction invalide');
	}
	const comment = await db.prepare('SELECT id FROM list_comments WHERE id = ? AND item_id = ?').bind(commentId, itemId).first();
	if (!comment) {
		return err(404, 'Commentaire introuvable');
	}
	const removed = await db.prepare('DELETE FROM list_comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?').bind(commentId, userId, emoji).run();
	if (removed.meta.changes) {
		return ok(null);
	}
	const kinds = await db.prepare('SELECT COUNT(DISTINCT emoji) AS n, SUM(emoji = ?) AS same FROM list_comment_reactions WHERE comment_id = ?').bind(emoji, commentId).first<{ n: number; same: number | null }>();
	if ((kinds?.n ?? 0) >= 20 && !kinds?.same) {
		return err(409, 'Trop de réactions différentes');
	}
	await db.prepare('INSERT INTO list_comment_reactions (comment_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').bind(commentId, userId, emoji, Date.now()).run();
	return ok(null);
}

// --- Rappels d'échéance ---

const parisDay = (at: number) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

function parisOffset(at: number): number {
	const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(at);
	const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
	return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - Math.floor(at / 60_000) * 60_000;
}

// Échéance sans heure : 9 h, heure de Paris.
export function parisInstant(day: string, time: string | null): number {
	const [y, m, d] = day.split('-').map(Number) as [number, number, number];
	const [h, mi] = (time ?? '09:00').split(':').map(Number) as [number, number];
	const guess = Date.UTC(y, m - 1, d, h, mi);
	return guess - parisOffset(guess);
}

type ReminderRow = ListRow & { item_id: string; item_title: string; vals: string; item_members: string; due_date: string; due_time: string | null; reminder: string; item_by: string };

// Appelé par le cron : un envoi par couple échéance et rappel.
export async function sendCardReminders(env: Env, now: number): Promise<number> {
	const { results } = await env.DB.prepare(
		`SELECT l.*, i.id AS item_id, i.title AS item_title, i.vals, i.members AS item_members, i.due_date, i.due_time, i.reminder, i.created_by AS item_by
		FROM list_items i JOIN lists l ON l.id = i.list_id
		WHERE i.reminder IS NOT NULL AND i.done = 0 AND i.archived_at IS NULL AND i.due_date BETWEEN ? AND ?
			AND (i.reminder_sent IS NULL OR i.reminder_sent != i.due_date || ' ' || COALESCE(i.due_time, '') || ' ' || i.reminder)
		LIMIT 200`,
	)
		.bind(parisDay(now), parisDay(now + 2 * 86_400_000))
		.all<ReminderRow>();
	let sent = 0;
	for (const row of results) {
		const rule = CARD_REMINDERS.find((r) => r.id === row.reminder);
		const due = parisInstant(row.due_date, row.due_time);
		if (!rule || now < due - rule.ms || now >= due) {
			continue;
		}
		const key = `${row.due_date} ${row.due_time ?? ''} ${row.reminder}`;
		const claimed = await env.DB.prepare('UPDATE list_items SET reminder_sent = ? WHERE id = ? AND (reminder_sent IS NULL OR reminder_sent != ?)').bind(key, row.item_id, key).run();
		if (!claimed.meta.changes) {
			continue;
		}
		const people = [...parse<string[]>(row.item_members, []), ...itemPeople(columnsOf(row), parse(row.vals, {})), ...(await followersOf(env.DB, row.item_id))];
		await sendNotice(env, row, null, people.length ? people : [row.item_by], { id: row.item_id, title: row.item_title }, rule.id === '1h' ? 'Rappel : échéance dans 1 heure' : 'Rappel : échéance demain');
		sent++;
	}
	return sent;
}
