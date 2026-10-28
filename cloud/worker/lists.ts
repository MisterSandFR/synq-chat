import {
	CARD_REMINDERS,
	COVER_GRADIENTS,
	DATE_RE,
	LIST_COLUMN_TYPES,
	LIST_LIMITS,
	LIST_TEMPLATES,
	PRIORITIES,
	STATUS_COLORS,
	type ActivityChange,
	type CommentReaction,
	type ListActivity,
	type ListColumn,
	type ListComment,
	type ListItem,
	type ListLabel,
	type ListOption,
	type ListSummary,
	type ListTemplate,
	type ListValue,
} from '../shared/lists';
import { fieldsOf, templateStatements, type ItemFields } from './lists-bases';
import { err, ok, type Result } from './result';

export type ListRow = {
	id: string;
	workspace_id: string;
	channel_id: string | null;
	title: string;
	description: string;
	columns: string;
	labels: string;
	created_by: string;
	created_at: number;
	updated_at: number;
	item_count?: number;
	restricted?: number;
};

type ItemRow = {
	id: string;
	list_id: string;
	position: number;
	title: string;
	description: string;
	vals: string;
	created_by: string;
	created_at: number;
	updated_at: number;
	comments?: number;
	labels: string;
	cover: string | null;
	start_date: string | null;
	due_date: string | null;
	done: number;
	checks_total?: number;
	checks_done?: number;
	attachments?: number;
	page_id?: string | null;
	icon: string;
	cover_mode: string;
	cover_y: number;
	members: string;
	start_time: string | null;
	due_time: string | null;
	reminder: string | null;
	estimate: number | null;
	estimate_unit: string;
	archived_at: number | null;
	template: number;
};

const parse = <T>(raw: string, fallback: T): T => {
	try {
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
};

export const toSummary = (row: ListRow): ListSummary => ({
	id: row.id,
	workspaceId: row.workspace_id,
	channelId: row.channel_id,
	title: row.title,
	description: row.description,
	createdBy: row.created_by,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	itemCount: row.item_count ?? 0,
});

export const columnsOf = (row: ListRow) => parse<ListColumn[]>(row.columns, []);

const toItem = (row: ItemRow): ListItem => ({
	id: row.id,
	listId: row.list_id,
	position: row.position,
	title: row.title,
	description: row.description,
	values: parse<Record<string, ListValue>>(row.vals, {}),
	createdBy: row.created_by,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	comments: row.comments ?? 0,
	labels: parse<string[]>(row.labels, []),
	cover: row.cover,
	startDate: row.start_date,
	dueDate: row.due_date,
	done: Boolean(row.done),
	checks: { done: row.checks_done ?? 0, total: row.checks_total ?? 0 },
	attachments: row.attachments ?? 0,
	pageId: row.page_id ?? null,
	icon: row.icon ?? '',
	coverMode: row.cover_mode === 'full' ? 'full' : 'top',
	coverY: row.cover_y ?? 50,
	members: parse<string[]>(row.members ?? '[]', []),
	startTime: row.start_time ?? null,
	dueTime: row.due_time ?? null,
	reminder: row.reminder === '1d' || row.reminder === '1h' ? row.reminder : null,
	estimate: row.estimate ?? null,
	estimateUnit: row.estimate_unit === 'h' ? 'h' : 'pts',
	archivedAt: row.archived_at ?? null,
	template: Boolean(row.template),
});

const LIST_SELECT = 'SELECT l.*, (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id) AS item_count FROM lists l';
const ITEM_SELECT = `SELECT i.*, (SELECT COUNT(*) FROM list_comments c WHERE c.item_id = i.id) AS comments,
	(SELECT COUNT(*) FROM list_checks k WHERE k.item_id = i.id) AS checks_total,
	(SELECT COUNT(*) FROM list_checks k WHERE k.item_id = i.id AND k.done = 1) AS checks_done,
	(SELECT COUNT(*) FROM list_attachments a WHERE a.item_id = i.id) AS attachments,
	(SELECT canvas_id FROM list_item_pages p WHERE p.item_id = i.id) AS page_id
	FROM list_items i`;

export async function workspaceLists(db: D1Database, workspaceId: string): Promise<ListRow[]> {
	const { results } = await db.prepare(`${LIST_SELECT} WHERE l.workspace_id = ? ORDER BY l.updated_at DESC`).bind(workspaceId).all<ListRow>();
	return results;
}

export async function listRow(db: D1Database, workspaceId: string, id: string): Promise<ListRow | null> {
	return db.prepare(`${LIST_SELECT} WHERE l.id = ? AND l.workspace_id = ?`).bind(id, workspaceId).first<ListRow>();
}

export async function listItems(db: D1Database, listId: string): Promise<ListItem[]> {
	const { results } = await db.prepare(`${ITEM_SELECT} WHERE i.list_id = ? AND i.archived_at IS NULL ORDER BY i.position, i.created_at`).bind(listId).all<ItemRow>();
	return results.map(toItem);
}

export async function archivedItems(db: D1Database, listId: string): Promise<ListItem[]> {
	const { results } = await db.prepare(`${ITEM_SELECT} WHERE i.list_id = ? AND i.archived_at IS NOT NULL ORDER BY i.archived_at DESC LIMIT 200`).bind(listId).all<ItemRow>();
	return results.map(toItem);
}

export async function itemRow(db: D1Database, listId: string, id: string): Promise<ListItem | null> {
	const row = await db.prepare(`${ITEM_SELECT} WHERE i.id = ? AND i.list_id = ?`).bind(id, listId).first<ItemRow>();
	return row ? toItem(row) : null;
}

const cleanText = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const isId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,40}$/.test(value);

export function cleanColumns(raw: unknown): Result<ListColumn[]> {
	if (!Array.isArray(raw) || raw.length > LIST_LIMITS.columns) {
		return err(400, 'Colonnes invalides');
	}
	const seen = new Set<string>();
	const out: ListColumn[] = [];
	for (const entry of raw as Array<Partial<ListColumn>>) {
		const name = cleanText(entry?.name, LIST_LIMITS.columnName);
		if (!entry || !isId(entry.id) || seen.has(entry.id) || !name || !LIST_COLUMN_TYPES.some((t) => t.id === entry.type)) {
			return err(400, 'Colonne invalide');
		}
		seen.add(entry.id);
		const column: ListColumn = { id: entry.id, name, type: entry.type! };
		if (typeof entry.width === 'number' && Number.isFinite(entry.width)) {
			column.width = Math.round(Math.min(LIST_LIMITS.maxWidth, Math.max(LIST_LIMITS.minWidth, entry.width)));
		}
		if (column.type === 'status') {
			const options = Array.isArray(entry.options) ? entry.options.slice(0, LIST_LIMITS.options) : [];
			const ids = new Set<string>();
			column.options = [];
			for (const [i, option] of (options as Array<Partial<ListOption>>).entries()) {
				const label = cleanText(option?.label, LIST_LIMITS.columnName);
				if (!option || !isId(option.id) || ids.has(option.id) || !label) {
					return err(400, 'Option de statut invalide');
				}
				ids.add(option.id);
				column.options.push({ id: option.id, label, color: isColor(option.color) ? option.color : STATUS_COLORS[i % STATUS_COLORS.length]! });
			}
		}
		out.push(column);
	}
	return ok(out);
}

// Valeur nulle ou vide = effacement de la cellule.
export function cleanValue(column: ListColumn, raw: unknown): Result<ListValue | null> {
	if (raw === null || raw === undefined || raw === '') {
		return ok(null);
	}
	const bad = err(400, `Valeur invalide pour « ${column.name} »`);
	switch (column.type) {
		case 'text':
			return typeof raw === 'string' ? ok(raw.slice(0, LIST_LIMITS.textLength)) : bad;
		case 'status':
			return typeof raw === 'string' && (column.options ?? []).some((o) => o.id === raw) ? ok(raw) : bad;
		case 'priority':
			return typeof raw === 'string' && PRIORITIES.some((p) => p.id === raw) ? ok(raw) : bad;
		case 'person':
			return typeof raw === 'string' && /^[0-9a-f-]{36}$/.test(raw) ? ok(raw) : bad;
		case 'date':
			return typeof raw === 'string' && DATE_RE.test(raw) ? ok(raw) : bad;
		case 'checkbox':
			return typeof raw === 'boolean' ? ok(raw) : bad;
		case 'number':
			return typeof raw === 'number' && Number.isFinite(raw) ? ok(raw) : bad;
		case 'link':
			if (typeof raw !== 'string' || raw.length > LIST_LIMITS.linkLength) {
				return bad;
			}
			try {
				const url = new URL(raw.trim());
				return url.protocol === 'https:' || url.protocol === 'http:' ? ok(url.toString()) : bad;
			} catch {
				return bad;
			}
	}
}

// Fusion partielle ; les personnes doivent être membres de l'espace.
export async function mergeValues(db: D1Database, workspaceId: string, columns: ListColumn[], current: Record<string, ListValue>, raw: unknown): Promise<Result<Record<string, ListValue>>> {
	if (raw === undefined) {
		return ok(current);
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return err(400, 'Valeurs invalides');
	}
	const next: Record<string, ListValue> = {};
	for (const column of columns) {
		if (current[column.id] !== undefined) {
			next[column.id] = current[column.id]!;
		}
	}
	const people: string[] = [];
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const column = columns.find((c) => c.id === key);
		if (!column) {
			return err(400, 'Colonne inconnue');
		}
		const clean = cleanValue(column, value);
		if (!clean.ok) {
			return clean;
		}
		if (clean.value === null) {
			delete next[key];
		} else {
			next[key] = clean.value;
			if (column.type === 'person') {
				people.push(clean.value as string);
			}
		}
	}
	if (people.length) {
		const unique = [...new Set(people)];
		const { results } = await db
			.prepare(`SELECT user_id FROM members WHERE workspace_id = ? AND role != 'guest' AND user_id IN (${unique.map(() => '?').join(',')})`)
			.bind(workspaceId, ...unique)
			.all<{ user_id: string }>();
		if (results.length !== unique.length) {
			return err(400, 'Personne hors de l’espace');
		}
	}
	return ok(next);
}

// Personnes nouvellement attribuées, à notifier.
export function newlyAssigned(columns: ListColumn[], before: Record<string, ListValue>, after: Record<string, ListValue>): string[] {
	const out = new Set<string>();
	for (const column of columns) {
		const value = after[column.id];
		if (column.type === 'person' && typeof value === 'string' && before[column.id] !== value) {
			out.add(value);
		}
	}
	return [...out];
}

export function changedFields(columns: ListColumn[], before: ListItem, input: { title?: unknown; description?: unknown }, values: Record<string, ListValue>, fields: ItemFields = fieldsOf(before)): string[] {
	const names: string[] = [];
	const was = fieldsOf(before);
	for (const [key, label] of [['labels', 'Étiquettes'], ['cover', 'Couverture'], ['startDate', 'Début'], ['dueDate', 'Échéance'], ['done', 'Terminé']] as const) {
		if (JSON.stringify(was[key]) !== JSON.stringify(fields[key])) {
			names.push(label);
		}
	}
	if (typeof input.title === 'string' && input.title.trim() !== before.title) {
		names.push('Titre');
	}
	if (typeof input.description === 'string' && input.description !== before.description) {
		names.push('Description');
	}
	for (const column of columns) {
		if (JSON.stringify(before.values[column.id] ?? null) !== JSON.stringify(values[column.id] ?? null)) {
			names.push(column.name);
		}
	}
	return names;
}

const CHANGE_FIELDS = [
	['labels', 'Étiquettes'],
	['cover', 'Bannière'],
	['startDate', 'Début'],
	['dueDate', 'Échéance'],
	['done', 'Terminé'],
	['icon', 'Icône'],
	['coverMode', 'Affichage de la bannière'],
	['coverY', 'Recadrage'],
	['members', 'Membres'],
	['startTime', 'Heure de début'],
	['dueTime', 'Heure d’échéance'],
	['reminder', 'Rappel'],
	['estimate', 'Estimation'],
	['estimateUnit', 'Unité d’estimation'],
	['template', 'Modèle'],
] as const;

const clip = (value: string) => (value.length > 120 ? `${value.slice(0, 119)}…` : value);

function fieldText(list: ListRow, key: (typeof CHANGE_FIELDS)[number][0], value: unknown): string | null {
	if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
		return null;
	}
	switch (key) {
		case 'labels': {
			const labels = parse<ListLabel[]>(list.labels, []);
			return (value as string[]).map((id) => labels.find((l) => l.id === id)?.name ?? '?').join(', ');
		}
		case 'cover': {
			const cover = String(value);
			return cover.startsWith('file:') ? 'Image' : cover.startsWith('grad:') ? `Dégradé ${COVER_GRADIENTS.find((g) => `grad:${g.id}` === cover)?.label ?? ''}`.trim() : cover;
		}
		case 'done':
		case 'template':
			return value ? 'Oui' : 'Non';
		case 'coverMode':
			return value === 'full' ? 'Pleine carte' : 'En haut';
		case 'coverY':
			return `${value} %`;
		case 'members':
			return (value as string[]).join(',');
		case 'reminder':
			return CARD_REMINDERS.find((r) => r.id === value)?.label ?? null;
		case 'estimateUnit':
			return value === 'h' ? 'Heures' : 'Points';
		default:
			return clip(String(value));
	}
}

function cellText(column: ListColumn, value: ListValue | undefined): string | null {
	if (value === undefined) {
		return null;
	}
	if (column.type === 'status') {
		return column.options?.find((o) => o.id === value)?.label ?? null;
	}
	if (column.type === 'priority') {
		return PRIORITIES.find((p) => p.id === value)?.label ?? null;
	}
	if (column.type === 'checkbox') {
		return value ? 'Oui' : 'Non';
	}
	return clip(String(value));
}

// Ancienne et nouvelle valeur lisibles, pour l'activité détaillée.
export function fieldChanges(list: ListRow, before: ListItem, input: { title?: unknown; description?: unknown }, values: Record<string, ListValue>, fields: ItemFields): ActivityChange[] {
	const out: ActivityChange[] = [];
	const was = fieldsOf(before);
	for (const [key, field] of CHANGE_FIELDS) {
		if (JSON.stringify(was[key]) !== JSON.stringify(fields[key])) {
			out.push({ field, from: fieldText(list, key, was[key]), to: fieldText(list, key, fields[key]), ...(key === 'members' && { kind: 'people' as const }) });
		}
	}
	if (typeof input.title === 'string' && input.title.trim() !== before.title) {
		out.push({ field: 'Titre', from: before.title || null, to: clip(input.title.trim()) || null });
	}
	if (typeof input.description === 'string' && input.description !== before.description) {
		out.push({ field: 'Description', from: null, to: null });
	}
	for (const column of columnsOf(list)) {
		if (JSON.stringify(before.values[column.id] ?? null) !== JSON.stringify(values[column.id] ?? null)) {
			out.push({ field: column.name, from: cellText(column, before.values[column.id]), to: cellText(column, values[column.id]), ...(column.type === 'person' && { kind: 'people' as const }) });
		}
	}
	return out;
}

export async function createList(db: D1Database, workspaceId: string, userId: string, input: { title?: unknown; template?: unknown; channelId?: string | null }): Promise<Result<ListRow>> {
	const key = (typeof input.template === 'string' && input.template in LIST_TEMPLATES ? input.template : 'blank') as ListTemplate;
	const template = LIST_TEMPLATES[key];
	const title = cleanText(input.title, LIST_LIMITS.titleLength) || template.title;
	const now = Date.now();
	const id = crypto.randomUUID();
	await db.batch([
		db
			.prepare('INSERT INTO lists (id, workspace_id, channel_id, title, columns, labels, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
			.bind(id, workspaceId, input.channelId ?? null, title, JSON.stringify(template.columns), JSON.stringify(template.labels ?? []), userId, now, now),
		...templateStatements(db, id, userId, key),
	]);
	return ok((await listRow(db, workspaceId, id))!);
}

export async function updateList(db: D1Database, row: ListRow, input: { title?: unknown; description?: unknown; columns?: unknown }, labels: string = row.labels): Promise<Result<null>> {
	const title = input.title === undefined ? row.title : cleanText(input.title, LIST_LIMITS.titleLength);
	if (!title) {
		return err(400, 'Titre requis');
	}
	const description = typeof input.description === 'string' ? input.description.slice(0, LIST_LIMITS.descriptionLength) : row.description;
	let columns = row.columns;
	if (input.columns !== undefined) {
		const clean = cleanColumns(input.columns);
		if (!clean.ok) {
			return clean;
		}
		columns = JSON.stringify(clean.value);
	}
	await db.prepare('UPDATE lists SET title = ?, description = ?, columns = ?, labels = ?, updated_at = ? WHERE id = ?').bind(title, description, columns, labels, Date.now(), row.id).run();
	return ok(null);
}

export const touchList = (db: D1Database, id: string) => db.prepare('UPDATE lists SET updated_at = ? WHERE id = ?').bind(Date.now(), id);

export const logActivity = (db: D1Database, itemId: string, userId: string, action: string, changes?: ActivityChange[]) =>
	db.prepare('INSERT INTO list_activity (item_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)').bind(itemId, userId, action, changes?.length ? JSON.stringify(changes) : null, Date.now());

export async function createItem(db: D1Database, list: ListRow, userId: string, input: { title?: unknown; position?: unknown }, values: Record<string, ListValue>, fields: ItemFields = fieldsOf(null)): Promise<Result<ListItem>> {
	if ((list.item_count ?? 0) >= LIST_LIMITS.items) {
		return err(409, 'Liste pleine');
	}
	let position = typeof input.position === 'number' && Number.isFinite(input.position) ? input.position : null;
	if (position === null) {
		const last = await db.prepare('SELECT MAX(position) AS p FROM list_items WHERE list_id = ?').bind(list.id).first<{ p: number | null }>();
		position = (last?.p ?? 0) + 1;
	}
	const id = crypto.randomUUID();
	const now = Date.now();
	await db.batch([
		db
			.prepare(
				`INSERT INTO list_items (id, list_id, position, title, vals, labels, cover, start_date, due_date, done, created_by, created_at, updated_at,
					icon, cover_mode, cover_y, members, start_time, due_time, reminder, estimate, estimate_unit, template) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				id,
				list.id,
				position,
				cleanText(input.title, LIST_LIMITS.titleLength),
				JSON.stringify(values),
				JSON.stringify(fields.labels),
				fields.cover,
				fields.startDate,
				fields.dueDate,
				Number(fields.done),
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
				Number(fields.template),
			),
		logActivity(db, id, userId, 'a créé l’élément'),
		touchList(db, list.id),
	]);
	return ok((await itemRow(db, list.id, id))!);
}

export async function updateItem(
	db: D1Database,
	list: ListRow,
	item: ListItem,
	userId: string,
	input: { title?: unknown; description?: unknown; position?: unknown },
	values: Record<string, ListValue>,
	fields: ItemFields = fieldsOf(item),
	automated = 0,
): Promise<ListItem> {
	const title = typeof input.title === 'string' ? cleanText(input.title, LIST_LIMITS.titleLength) : item.title;
	const description = typeof input.description === 'string' ? input.description.slice(0, LIST_LIMITS.descriptionLength) : item.description;
	const position = typeof input.position === 'number' && Number.isFinite(input.position) ? input.position : item.position;
	const changes = fieldChanges(list, item, input, values, fields);
	const statements = [
		db
			.prepare(
				`UPDATE list_items SET title = ?, description = ?, position = ?, vals = ?, labels = ?, cover = ?, start_date = ?, due_date = ?, done = ?, updated_at = ?,
					icon = ?, cover_mode = ?, cover_y = ?, members = ?, start_time = ?, due_time = ?, reminder = ?, estimate = ?, estimate_unit = ?, archived_at = ?, template = ? WHERE id = ?`,
			)
			.bind(
				title,
				description,
				position,
				JSON.stringify(values),
				JSON.stringify(fields.labels),
				fields.cover,
				fields.startDate,
				fields.dueDate,
				Number(fields.done),
				Date.now(),
				fields.icon,
				fields.coverMode,
				fields.coverY,
				JSON.stringify(fields.members),
				fields.startTime,
				fields.dueTime,
				fields.reminder,
				fields.estimate,
				fields.estimateUnit,
				fields.archivedAt,
				Number(fields.template),
				item.id,
			),
		touchList(db, list.id),
	];
	if (changes.length) {
		statements.push(logActivity(db, item.id, userId, `a modifié ${changes.map((c) => c.field).join(', ')}`, changes));
	}
	if (fields.archivedAt !== item.archivedAt) {
		statements.push(logActivity(db, item.id, userId, fields.archivedAt ? 'a archivé la carte' : 'a restauré la carte'));
	}
	if (automated) {
		statements.push(logActivity(db, item.id, userId, automated > 1 ? `a déclenché ${automated} automatisations` : 'a déclenché une automatisation'));
	}
	await db.batch(statements);
	return (await itemRow(db, list.id, item.id))!;
}

export async function itemHistory(db: D1Database, itemId: string): Promise<{ comments: ListComment[]; activity: ListActivity[] }> {
	const [comments, activity, reactions] = await db.batch([
		db.prepare('SELECT id, item_id AS itemId, user_id AS userId, body, created_at AS createdAt FROM list_comments WHERE item_id = ? ORDER BY created_at').bind(itemId),
		db.prepare('SELECT id, user_id AS userId, action, detail, created_at AS createdAt FROM list_activity WHERE item_id = ? ORDER BY id DESC LIMIT 50').bind(itemId),
		db.prepare('SELECT r.comment_id, r.user_id, r.emoji FROM list_comment_reactions r JOIN list_comments c ON c.id = r.comment_id WHERE c.item_id = ? ORDER BY r.created_at').bind(itemId),
	]);
	const byComment = new Map<string, CommentReaction[]>();
	for (const r of reactions!.results as Array<{ comment_id: string; user_id: string; emoji: string }>) {
		const list = byComment.get(r.comment_id) ?? [];
		const entry = list.find((x) => x.emoji === r.emoji);
		if (entry) {
			entry.users.push(r.user_id);
		} else {
			list.push({ emoji: r.emoji, users: [r.user_id] });
		}
		byComment.set(r.comment_id, list);
	}
	return {
		comments: (comments!.results as Omit<ListComment, 'reactions'>[]).map((c) => ({ ...c, reactions: byComment.get(c.id) ?? [] })),
		activity: (activity!.results as Array<Omit<ListActivity, 'changes'> & { detail: string | null }>).map(({ detail, ...a }) => ({ ...a, changes: detail ? parse<ActivityChange[]>(detail, []) : [] })),
	};
}

export async function addComment(db: D1Database, list: ListRow, itemId: string, userId: string, raw: unknown): Promise<Result<ListComment>> {
	const body = typeof raw === 'string' ? raw.trim().slice(0, LIST_LIMITS.comment) : '';
	if (!body) {
		return err(400, 'Commentaire vide');
	}
	const comment: ListComment = { id: crypto.randomUUID(), itemId, userId, body, createdAt: Date.now(), reactions: [] };
	await db.batch([
		db.prepare('INSERT INTO list_comments (id, item_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(comment.id, itemId, userId, body, comment.createdAt),
		logActivity(db, itemId, userId, 'a commenté'),
		touchList(db, list.id),
	]);
	return ok(comment);
}

// Neutralise les formules à l'ouverture dans un tableur.
const csvCell = (value: string) => {
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(columns: ListColumn[], items: ListItem[], names: Map<string, string>): string {
	const format = (column: ListColumn, value: ListValue | undefined): string => {
		if (value === undefined) {
			return '';
		}
		switch (column.type) {
			case 'status':
				return column.options?.find((o) => o.id === value)?.label ?? '';
			case 'priority':
				return PRIORITIES.find((p) => p.id === value)?.label ?? '';
			case 'person':
				return names.get(value as string) ?? '';
			case 'checkbox':
				return value ? 'Oui' : 'Non';
			default:
				return String(value);
		}
	};
	const lines = [['Titre', ...columns.map((c) => c.name), 'Description'].map(csvCell).join(',')];
	for (const item of items) {
		lines.push([item.title, ...columns.map((c) => format(c, item.values[c.id])), item.description].map(csvCell).join(','));
	}
	return `﻿${lines.join('\r\n')}\r\n`;
}
