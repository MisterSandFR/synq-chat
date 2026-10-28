import type { CanvasMeta } from '../shared/canvas';
import {
	BASE_LIMITS,
	CARD_LIMITS,
	CARD_REMINDERS,
	COVER_GRADIENTS,
	DATE_RE,
	TIME_RE,
	defaultCardFace,
	LIST_TEMPLATES,
	LIST_VIEW_KINDS,
	STATUS_COLORS,
	defaultViewConfig,
	type CheckItem,
	type Checklist,
	type ListAttachment,
	type ListColumn,
	type ListItem,
	type ListLabel,
	type ListRule,
	type ListSavedView,
	type CardFace,
	type CardReminder,
	type CoverMode,
	type EstimateUnit,
	type ListTemplate,
	type ListValue,
	type RuleAction,
	type RuleTrigger,
	type ViewConfig,
	type ViewFilter,
} from '../shared/lists';
import { toMeta } from './canvases';
import { loadActor } from './grades';
import { workspaceStub } from './http';
import type { ListRow } from './lists';
import { err, ok, type Result } from './result';

const parse = <T>(raw: string | null | undefined, fallback: T): T => {
	try {
		return raw ? (JSON.parse(raw) as T) : fallback;
	} catch {
		return fallback;
	}
};

const isId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,40}$/.test(value);
const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const isUser = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '');

async function areMembers(db: D1Database, workspaceId: string, ids: string[]): Promise<boolean> {
	const unique = [...new Set(ids)];
	if (!unique.length) {
		return true;
	}
	const { results } = await db
		.prepare(`SELECT user_id FROM members WHERE workspace_id = ? AND role != 'guest' AND user_id IN (${unique.map(() => '?').join(',')})`)
		.bind(workspaceId, ...unique)
		.all<{ user_id: string }>();
	return results.length === unique.length;
}

// --- Étiquettes ---

export const labelsOf = (row: ListRow): ListLabel[] => parse<ListLabel[]>(row.labels, []);

export function cleanLabels(raw: unknown): Result<ListLabel[]> {
	if (!Array.isArray(raw) || raw.length > BASE_LIMITS.labels) {
		return err(400, 'Étiquettes invalides');
	}
	const seen = new Set<string>();
	const out: ListLabel[] = [];
	for (const [i, entry] of (raw as Array<Partial<ListLabel>>).entries()) {
		const name = text(entry?.name, BASE_LIMITS.labelName);
		if (!entry || !isId(entry.id) || seen.has(entry.id)) {
			return err(400, 'Étiquette invalide');
		}
		seen.add(entry.id);
		out.push({ id: entry.id, name, color: isColor(entry.color) ? entry.color : STATUS_COLORS[i % STATUS_COLORS.length]! });
	}
	return ok(out);
}

// --- Champs natifs d'un élément ---

export type ItemFields = {
	labels: string[];
	cover: string | null;
	startDate: string | null;
	dueDate: string | null;
	done: boolean;
	icon: string;
	coverMode: CoverMode;
	coverY: number;
	members: string[];
	startTime: string | null;
	dueTime: string | null;
	reminder: CardReminder | null;
	estimate: number | null;
	estimateUnit: EstimateUnit;
	archivedAt: number | null;
	template: boolean;
};

export const fieldsOf = (item: ListItem | null): ItemFields => ({
	labels: item?.labels ?? [],
	cover: item?.cover ?? null,
	startDate: item?.startDate ?? null,
	dueDate: item?.dueDate ?? null,
	done: item?.done ?? false,
	icon: item?.icon ?? '',
	coverMode: item?.coverMode ?? 'top',
	coverY: item?.coverY ?? 50,
	members: item?.members ?? [],
	startTime: item?.startTime ?? null,
	dueTime: item?.dueTime ?? null,
	reminder: item?.reminder ?? null,
	estimate: item?.estimate ?? null,
	estimateUnit: item?.estimateUnit ?? 'pts',
	archivedAt: item?.archivedAt ?? null,
	template: item?.template ?? false,
});

export type CardInput = {
	labels?: unknown;
	cover?: unknown;
	startDate?: unknown;
	dueDate?: unknown;
	done?: unknown;
	icon?: unknown;
	coverMode?: unknown;
	coverY?: unknown;
	members?: unknown;
	startTime?: unknown;
	dueTime?: unknown;
	reminder?: unknown;
	estimate?: unknown;
	estimateUnit?: unknown;
	archived?: unknown;
	template?: unknown;
};

const cleanTime = (raw: unknown, current: string | null): Result<string | null> =>
	raw === undefined ? ok(current) : raw === null || raw === '' ? ok(null) : typeof raw === 'string' && TIME_RE.test(raw) ? ok(raw) : err(400, 'Heure invalide');

// Icône, bannière, membres, heures, rappel, estimation, archivage et modèle.
async function cleanCard(db: D1Database, list: ListRow, next: ItemFields, input: CardInput): Promise<Result<ItemFields>> {
	if (input.icon !== undefined) {
		if (typeof input.icon !== 'string' || [...input.icon].length > CARD_LIMITS.icon || /\s/.test(input.icon)) {
			return err(400, 'Icône invalide');
		}
		next.icon = input.icon;
	}
	if (input.coverMode !== undefined) {
		if (input.coverMode !== 'top' && input.coverMode !== 'full') {
			return err(400, 'Affichage de bannière invalide');
		}
		next.coverMode = input.coverMode;
	}
	if (input.coverY !== undefined) {
		if (typeof input.coverY !== 'number' || !Number.isFinite(input.coverY)) {
			return err(400, 'Recadrage invalide');
		}
		next.coverY = Math.round(Math.min(100, Math.max(0, input.coverY)));
	}
	if (input.members !== undefined) {
		if (!Array.isArray(input.members) || input.members.length > CARD_LIMITS.members || !input.members.every(isUser) || !(await areMembers(db, list.workspace_id, input.members as string[]))) {
			return err(400, 'Personne hors de l’espace');
		}
		next.members = [...new Set(input.members as string[])];
	}
	for (const key of ['startTime', 'dueTime'] as const) {
		const time = cleanTime(input[key], next[key]);
		if (!time.ok) {
			return time;
		}
		next[key] = time.value;
	}
	// Une heure sans date n'a pas de sens : elle suit sa date.
	next.startTime = next.startDate ? next.startTime : null;
	next.dueTime = next.dueDate ? next.dueTime : null;
	if (input.reminder !== undefined) {
		if (input.reminder !== null && !CARD_REMINDERS.some((r) => r.id === input.reminder)) {
			return err(400, 'Rappel invalide');
		}
		next.reminder = input.reminder as CardReminder | null;
	}
	if (next.reminder && !next.dueDate) {
		if (input.reminder) {
			return err(400, 'Un rappel demande une échéance');
		}
		next.reminder = null;
	}
	if (input.estimate !== undefined) {
		if (input.estimate !== null && (typeof input.estimate !== 'number' || !Number.isFinite(input.estimate) || input.estimate < 0 || input.estimate > CARD_LIMITS.estimate)) {
			return err(400, 'Estimation invalide');
		}
		next.estimate = input.estimate === null ? null : Math.round(input.estimate * 100) / 100;
	}
	if (input.estimateUnit !== undefined) {
		if (input.estimateUnit !== 'pts' && input.estimateUnit !== 'h') {
			return err(400, 'Unité invalide');
		}
		next.estimateUnit = input.estimateUnit;
	}
	for (const key of ['archived', 'template'] as const) {
		if (input[key] !== undefined && typeof input[key] !== 'boolean') {
			return err(400, 'Valeur invalide');
		}
	}
	if (input.archived !== undefined) {
		next.archivedAt = input.archived ? (next.archivedAt ?? Date.now()) : null;
	}
	if (input.template !== undefined) {
		next.template = input.template as boolean;
	}
	return ok(next);
}

const cleanDate = (raw: unknown, current: string | null): Result<string | null> =>
	raw === undefined ? ok(current) : raw === null || raw === '' ? ok(null) : typeof raw === 'string' && DATE_RE.test(raw) ? ok(raw) : err(400, 'Date invalide');

export async function cleanFields(db: D1Database, list: ListRow, item: ListItem | null, input: CardInput): Promise<Result<ItemFields>> {
	const next = fieldsOf(item);
	if (input.labels !== undefined) {
		const known = new Set(labelsOf(list).map((l) => l.id));
		if (!Array.isArray(input.labels) || input.labels.some((id) => !known.has(id as string))) {
			return err(400, 'Étiquette inconnue');
		}
		next.labels = [...new Set(input.labels as string[])];
	}
	if (input.cover !== undefined) {
		if (input.cover === null || input.cover === '') {
			next.cover = null;
		} else if (isColor(input.cover)) {
			next.cover = input.cover.toLowerCase();
		} else if (typeof input.cover === 'string' && input.cover.startsWith('grad:') && COVER_GRADIENTS.some((g) => `grad:${g.id}` === input.cover)) {
			next.cover = input.cover;
		} else if (typeof input.cover === 'string' && input.cover.startsWith('file:') && item) {
			const file = await db.prepare('SELECT type, size FROM list_attachments WHERE id = ? AND item_id = ?').bind(input.cover.slice(5), item.id).first<{ type: string; size: number }>();
			if (!file) {
				return err(400, 'Image de couverture introuvable');
			}
			if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) {
				return err(400, 'La bannière doit être une image');
			}
			if (file.size > CARD_LIMITS.bannerSize) {
				return err(413, 'Image trop lourde pour une bannière (10 Mo max)');
			}
			next.cover = input.cover;
		} else {
			return err(400, 'Couverture invalide');
		}
	}
	const start = cleanDate(input.startDate, next.startDate);
	const due = cleanDate(input.dueDate, next.dueDate);
	if (!start.ok) {
		return start;
	}
	if (!due.ok) {
		return due;
	}
	if (start.value && due.value && start.value > due.value) {
		return err(400, 'Le début doit précéder l’échéance');
	}
	next.startDate = start.value;
	next.dueDate = due.value;
	if (input.done !== undefined) {
		if (typeof input.done !== 'boolean') {
			return err(400, 'Valeur « terminé » invalide');
		}
		next.done = input.done;
	}
	return cleanCard(db, list, next, input);
}

// --- Vues enregistrées ---

type ViewRow = { id: string; list_id: string; name: string; kind: string; config: string; position: number };

const toView = (row: ViewRow): ListSavedView => ({
	id: row.id,
	listId: row.list_id,
	name: row.name,
	kind: (LIST_VIEW_KINDS.some((k) => k.id === row.kind) ? row.kind : 'table') as ListSavedView['kind'],
	config: (() => {
		const config = { ...defaultViewConfig(), ...parse<Partial<ViewConfig>>(row.config, {}) };
		return { ...config, card: { ...defaultCardFace(), ...config.card } };
	})(),
	position: row.position,
});

export async function listViews(db: D1Database, listId: string): Promise<ListSavedView[]> {
	const { results } = await db.prepare('SELECT * FROM list_views WHERE list_id = ? ORDER BY position, created_at').bind(listId).all<ViewRow>();
	return results.map(toView);
}

const FILTER_OPS = ['is', 'not', 'empty', 'filled'];

export function cleanConfig(raw: unknown, current: ViewConfig = defaultViewConfig()): Result<ViewConfig> {
	if (raw === undefined) {
		return ok(current);
	}
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return err(400, 'Réglages de vue invalides');
	}
	const input = raw as Partial<Record<keyof ViewConfig, unknown>>;
	const next: ViewConfig = { ...current };
	if (input.filters !== undefined) {
		if (!Array.isArray(input.filters) || input.filters.length > BASE_LIMITS.filters) {
			return err(400, 'Filtres invalides');
		}
		const filters: ViewFilter[] = [];
		for (const f of input.filters as Array<Partial<ViewFilter>>) {
			if (!f || !isId(f.field) || !FILTER_OPS.includes(f.op as string) || (f.value !== undefined && (typeof f.value !== 'string' || f.value.length > 100))) {
				return err(400, 'Filtre invalide');
			}
			filters.push({ field: f.field, op: f.op!, ...(f.value !== undefined && { value: f.value }) });
		}
		next.filters = filters;
	}
	if (input.sort !== undefined) {
		const sort = input.sort as { id?: unknown; dir?: unknown } | null;
		if (sort !== null && (!sort || !isId(sort.id) || (sort.dir !== 1 && sort.dir !== -1))) {
			return err(400, 'Tri invalide');
		}
		next.sort = sort ? { id: sort.id as string, dir: sort.dir as 1 | -1 } : null;
	}
	for (const key of ['groupBy', 'boardBy'] as const) {
		if (input[key] !== undefined) {
			if (input[key] !== null && !isId(input[key])) {
				return err(400, 'Regroupement invalide');
			}
			next[key] = input[key] as string | null;
		}
	}
	if (input.hidden !== undefined) {
		if (!Array.isArray(input.hidden) || input.hidden.length > 40 || !input.hidden.every(isId)) {
			return err(400, 'Colonnes masquées invalides');
		}
		next.hidden = [...new Set(input.hidden as string[])];
	}
	if (input.dateField !== undefined) {
		if (!isId(input.dateField)) {
			return err(400, 'Champ de date invalide');
		}
		next.dateField = input.dateField;
	}
	if (input.card !== undefined) {
		const card = input.card as Partial<Record<keyof CardFace, unknown>> | null;
		if (!card || typeof card !== 'object' || Array.isArray(card)) {
			return err(400, 'Face de carte invalide');
		}
		const face: CardFace = { ...defaultCardFace(), ...current.card };
		for (const key of ['cover', 'labels', 'members', 'dates', 'checklist', 'counts'] as const) {
			if (card[key] !== undefined) {
				if (typeof card[key] !== 'boolean') {
					return err(400, 'Face de carte invalide');
				}
				face[key] = card[key];
			}
		}
		if (card.props !== undefined) {
			if (!Array.isArray(card.props) || card.props.length > CARD_LIMITS.faceProps || !card.props.every(isId)) {
				return err(400, 'Propriétés de carte invalides');
			}
			face.props = [...new Set(card.props as string[])];
		}
		next.card = face;
	}
	return ok(next);
}

export async function createView(db: D1Database, list: ListRow, userId: string, input: { name?: unknown; kind?: unknown; config?: unknown }): Promise<Result<ListSavedView>> {
	const kind = LIST_VIEW_KINDS.find((k) => k.id === input.kind);
	if (!kind) {
		return err(400, 'Type de vue inconnu');
	}
	const config = cleanConfig(input.config);
	if (!config.ok) {
		return config;
	}
	const stats = await db.prepare('SELECT COUNT(*) AS n, MAX(position) AS p FROM list_views WHERE list_id = ?').bind(list.id).first<{ n: number; p: number | null }>();
	if ((stats?.n ?? 0) >= BASE_LIMITS.views) {
		return err(409, 'Trop de vues');
	}
	const row: ViewRow = { id: crypto.randomUUID(), list_id: list.id, name: text(input.name, BASE_LIMITS.viewName) || kind.label, kind: kind.id, config: JSON.stringify(config.value), position: (stats?.p ?? 0) + 1 };
	await db
		.prepare('INSERT INTO list_views (id, list_id, name, kind, config, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(row.id, row.list_id, row.name, row.kind, row.config, row.position, userId, Date.now())
		.run();
	return ok(toView(row));
}

export async function updateView(db: D1Database, list: ListRow, viewId: string, input: { name?: unknown; config?: unknown; position?: unknown }): Promise<Result<ListSavedView>> {
	const row = await db.prepare('SELECT * FROM list_views WHERE id = ? AND list_id = ?').bind(viewId, list.id).first<ViewRow>();
	if (!row) {
		return err(404, 'Vue introuvable');
	}
	const config = cleanConfig(input.config, toView(row).config);
	if (!config.ok) {
		return config;
	}
	const name = input.name === undefined ? row.name : text(input.name, BASE_LIMITS.viewName);
	if (!name) {
		return err(400, 'Nom requis');
	}
	const position = typeof input.position === 'number' && Number.isFinite(input.position) ? input.position : row.position;
	const next = { ...row, name, config: JSON.stringify(config.value), position };
	await db.prepare('UPDATE list_views SET name = ?, config = ?, position = ? WHERE id = ?').bind(next.name, next.config, next.position, row.id).run();
	return ok(toView(next));
}

export async function deleteView(db: D1Database, list: ListRow, viewId: string): Promise<Result<null>> {
	const count = await db.prepare('SELECT COUNT(*) AS n FROM list_views WHERE list_id = ?').bind(list.id).first<{ n: number }>();
	if ((count?.n ?? 0) <= 1) {
		return err(409, 'Une base garde au moins une vue');
	}
	const done = await db.prepare('DELETE FROM list_views WHERE id = ? AND list_id = ?').bind(viewId, list.id).run();
	return done.meta.changes ? ok(null) : err(404, 'Vue introuvable');
}

// Vues, étiquettes et règles d'un modèle, insérées avec la base.
export function templateStatements(db: D1Database, listId: string, userId: string, template: ListTemplate): D1PreparedStatement[] {
	const spec = LIST_TEMPLATES[template];
	const now = Date.now();
	return [
		...spec.views.map((v, i) =>
			db
				.prepare('INSERT INTO list_views (id, list_id, name, kind, config, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
				.bind(crypto.randomUUID(), listId, v.name, v.kind, JSON.stringify({ ...defaultViewConfig(), ...v.config }), i + 1, userId, now),
		),
		...(spec.rules ?? []).map((r) =>
			db
				.prepare('INSERT INTO list_rules (id, list_id, trigger, action, enabled, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
				.bind(crypto.randomUUID(), listId, JSON.stringify(r.trigger), JSON.stringify(r.action), userId, now),
		),
	];
}

// --- Checklists ---

type ChecklistRow = { id: string; item_id: string; title: string; position: number };
type CheckRow = { id: string; checklist_id: string; item_id: string; text: string; done: number; assignee: string | null; due: string | null; position: number };

const toCheck = (row: CheckRow): CheckItem => ({ id: row.id, text: row.text, done: Boolean(row.done), assignee: row.assignee, due: row.due, position: row.position });

export async function checklistsOf(db: D1Database, itemId: string): Promise<Checklist[]> {
	const [lists, checks] = await db.batch([
		db.prepare('SELECT * FROM list_checklists WHERE item_id = ? ORDER BY position, created_at').bind(itemId),
		db.prepare('SELECT * FROM list_checks WHERE item_id = ? ORDER BY position, created_at').bind(itemId),
	]);
	const rows = checks!.results as CheckRow[];
	return (lists!.results as ChecklistRow[]).map((l) => ({ id: l.id, title: l.title, position: l.position, items: rows.filter((c) => c.checklist_id === l.id).map(toCheck) }));
}

export async function addChecklist(db: D1Database, itemId: string, raw: unknown): Promise<Result<Checklist>> {
	const stats = await db.prepare('SELECT COUNT(*) AS n, MAX(position) AS p FROM list_checklists WHERE item_id = ?').bind(itemId).first<{ n: number; p: number | null }>();
	if ((stats?.n ?? 0) >= BASE_LIMITS.checklists) {
		return err(409, 'Trop de checklists');
	}
	const checklist: Checklist = { id: crypto.randomUUID(), title: text(raw, BASE_LIMITS.checkText) || 'Checklist', position: (stats?.p ?? 0) + 1, items: [] };
	await db.prepare('INSERT INTO list_checklists (id, item_id, title, position, created_at) VALUES (?, ?, ?, ?, ?)').bind(checklist.id, itemId, checklist.title, checklist.position, Date.now()).run();
	return ok(checklist);
}

export async function renameChecklist(db: D1Database, itemId: string, id: string, raw: unknown): Promise<Result<null>> {
	const title = text(raw, BASE_LIMITS.checkText);
	if (!title) {
		return err(400, 'Titre requis');
	}
	const done = await db.prepare('UPDATE list_checklists SET title = ? WHERE id = ? AND item_id = ?').bind(title, id, itemId).run();
	return done.meta.changes ? ok(null) : err(404, 'Checklist introuvable');
}

export async function removeChecklist(db: D1Database, itemId: string, id: string): Promise<Result<null>> {
	const done = await db.prepare('DELETE FROM list_checklists WHERE id = ? AND item_id = ?').bind(id, itemId).run();
	return done.meta.changes ? ok(null) : err(404, 'Checklist introuvable');
}

type CheckInput = { text?: unknown; done?: unknown; assignee?: unknown; due?: unknown; position?: unknown };

async function cleanCheck(db: D1Database, workspaceId: string, current: CheckItem, input: CheckInput): Promise<Result<CheckItem>> {
	const next = { ...current };
	if (input.text !== undefined) {
		next.text = text(input.text, BASE_LIMITS.checkText);
		if (!next.text) {
			return err(400, 'Texte requis');
		}
	}
	if (input.done !== undefined) {
		if (typeof input.done !== 'boolean') {
			return err(400, 'Case invalide');
		}
		next.done = input.done;
	}
	if (input.assignee !== undefined) {
		if (input.assignee !== null && (!isUser(input.assignee) || !(await areMembers(db, workspaceId, [input.assignee])))) {
			return err(400, 'Personne hors de l’espace');
		}
		next.assignee = input.assignee as string | null;
	}
	const due = cleanDate(input.due, next.due);
	if (!due.ok) {
		return due;
	}
	next.due = due.value;
	if (typeof input.position === 'number' && Number.isFinite(input.position)) {
		next.position = input.position;
	}
	return ok(next);
}

export async function addCheck(db: D1Database, workspaceId: string, itemId: string, checklistId: string, input: CheckInput): Promise<Result<CheckItem>> {
	const owner = await db.prepare('SELECT id FROM list_checklists WHERE id = ? AND item_id = ?').bind(checklistId, itemId).first();
	if (!owner) {
		return err(404, 'Checklist introuvable');
	}
	const stats = await db.prepare('SELECT COUNT(*) AS n, MAX(position) AS p FROM list_checks WHERE item_id = ?').bind(itemId).first<{ n: number; p: number | null }>();
	if ((stats?.n ?? 0) >= BASE_LIMITS.checks) {
		return err(409, 'Trop d’éléments de checklist');
	}
	const clean = await cleanCheck(db, workspaceId, { id: crypto.randomUUID(), text: '', done: false, assignee: null, due: null, position: (stats?.p ?? 0) + 1 }, { ...input, text: input.text ?? '' });
	if (!clean.ok) {
		return clean;
	}
	const c = clean.value;
	await db
		.prepare('INSERT INTO list_checks (id, checklist_id, item_id, text, done, assignee, due, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(c.id, checklistId, itemId, c.text, Number(c.done), c.assignee, c.due, c.position, Date.now())
		.run();
	return ok(c);
}

export async function updateCheck(db: D1Database, workspaceId: string, itemId: string, id: string, input: CheckInput): Promise<Result<{ check: CheckItem; assigned: string | null }>> {
	const row = await db.prepare('SELECT * FROM list_checks WHERE id = ? AND item_id = ?').bind(id, itemId).first<CheckRow>();
	if (!row) {
		return err(404, 'Élément de checklist introuvable');
	}
	const clean = await cleanCheck(db, workspaceId, toCheck(row), input);
	if (!clean.ok) {
		return clean;
	}
	const c = clean.value;
	await db.prepare('UPDATE list_checks SET text = ?, done = ?, assignee = ?, due = ?, position = ? WHERE id = ?').bind(c.text, Number(c.done), c.assignee, c.due, c.position, id).run();
	return ok({ check: c, assigned: c.assignee && c.assignee !== row.assignee ? c.assignee : null });
}

export async function removeCheck(db: D1Database, itemId: string, id: string): Promise<Result<null>> {
	const done = await db.prepare('DELETE FROM list_checks WHERE id = ? AND item_id = ?').bind(id, itemId).run();
	return done.meta.changes ? ok(null) : err(404, 'Élément de checklist introuvable');
}

// --- Pièces jointes ---

type FileRow = { id: string; item_id: string; list_id: string; name: string; size: number; type: string; created_by: string; created_at: number };

export const fileKey = (workspaceId: string, listId: string, fileId: string) => `w/${workspaceId}/lists/${listId}/${fileId}`;

const toFile = (workspaceId: string, row: FileRow): ListAttachment => ({
	id: row.id,
	name: row.name,
	size: row.size,
	type: row.type,
	createdBy: row.created_by,
	createdAt: row.created_at,
	url: `/api/w/${workspaceId}/lists/${row.list_id}/files/${row.id}`,
});

export async function filesOf(db: D1Database, workspaceId: string, itemId: string): Promise<ListAttachment[]> {
	const { results } = await db.prepare('SELECT * FROM list_attachments WHERE item_id = ? ORDER BY created_at DESC').bind(itemId).all<FileRow>();
	return results.map((r) => toFile(workspaceId, r));
}

export async function insertFile(db: D1Database, workspaceId: string, row: FileRow): Promise<ListAttachment> {
	await db
		.prepare('INSERT INTO list_attachments (id, item_id, list_id, name, size, type, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(row.id, row.item_id, row.list_id, row.name, row.size, row.type, row.created_by, row.created_at)
		.run();
	return toFile(workspaceId, row);
}

export async function fileRow(db: D1Database, listId: string, id: string): Promise<FileRow | null> {
	return db.prepare('SELECT * FROM list_attachments WHERE id = ? AND list_id = ?').bind(id, listId).first<FileRow>();
}

export async function fileKeys(db: D1Database, workspaceId: string, where: { listId: string; itemId?: string }): Promise<string[]> {
	const { results } = await (where.itemId
		? db.prepare('SELECT id, list_id FROM list_attachments WHERE item_id = ?').bind(where.itemId)
		: db.prepare('SELECT id, list_id FROM list_attachments WHERE list_id = ?').bind(where.listId)
	).all<{ id: string; list_id: string }>();
	return results.map((r) => fileKey(workspaceId, r.list_id, r.id));
}

// --- Automatisations ---

type RuleRow = { id: string; list_id: string; trigger: string; action: string; enabled: number; created_by: string; created_at: number };

const toRule = (row: RuleRow): ListRule => ({
	id: row.id,
	listId: row.list_id,
	trigger: parse<RuleTrigger>(row.trigger, { kind: 'due_soon' }),
	action: parse<RuleAction>(row.action, { kind: 'done' }),
	enabled: Boolean(row.enabled),
	createdBy: row.created_by,
	createdAt: row.created_at,
});

export async function rulesOf(db: D1Database, listId: string): Promise<ListRule[]> {
	const { results } = await db.prepare('SELECT * FROM list_rules WHERE list_id = ? ORDER BY created_at').bind(listId).all<RuleRow>();
	return results.map(toRule);
}

const statusOption = (columns: ListColumn[], column: unknown, option: unknown) => columns.some((c) => c.id === column && c.type === 'status' && (c.options ?? []).some((o) => o.id === option));

export async function cleanRule(db: D1Database, list: ListRow, columns: ListColumn[], raw: { trigger?: unknown; action?: unknown }): Promise<Result<{ trigger: RuleTrigger; action: RuleAction }>> {
	const t = raw.trigger as Partial<{ kind: string; column: string; option: string }> | undefined;
	const a = raw.action as Partial<{ kind: string; column: string; option: string; user: string | null; label: string }> | undefined;
	let trigger: RuleTrigger;
	if (t?.kind === 'status' && statusOption(columns, t.column, t.option)) {
		trigger = { kind: 'status', column: t.column!, option: t.option! };
	} else if (t?.kind === 'due_soon') {
		trigger = { kind: 'due_soon' };
	} else {
		return err(400, 'Déclencheur invalide');
	}
	let action: RuleAction;
	switch (a?.kind) {
		case 'done':
			action = { kind: 'done' };
			break;
		case 'assign':
			if (!columns.some((c) => c.id === a.column && c.type === 'person') || !isUser(a.user) || !(await areMembers(db, list.workspace_id, [a.user]))) {
				return err(400, 'Attribution invalide');
			}
			action = { kind: 'assign', column: a.column!, user: a.user };
			break;
		case 'label':
			if (!labelsOf(list).some((l) => l.id === a.label)) {
				return err(400, 'Étiquette inconnue');
			}
			action = { kind: 'label', label: a.label! };
			break;
		case 'notify':
			if (a.user !== null && a.user !== undefined && (!isUser(a.user) || !(await areMembers(db, list.workspace_id, [a.user])))) {
				return err(400, 'Personne hors de l’espace');
			}
			action = { kind: 'notify', user: a.user ?? null };
			break;
		case 'move':
			if (!statusOption(columns, a.column, a.option)) {
				return err(400, 'Déplacement invalide');
			}
			action = { kind: 'move', column: a.column!, option: a.option! };
			break;
		default:
			return err(400, 'Action invalide');
	}
	// L'échéance qui approche ne fait que notifier.
	if (trigger.kind === 'due_soon' && action.kind !== 'notify') {
		return err(400, 'Une échéance proche déclenche une notification');
	}
	return ok({ trigger, action });
}

export async function createRule(db: D1Database, list: ListRow, columns: ListColumn[], userId: string, input: { trigger?: unknown; action?: unknown }): Promise<Result<ListRule>> {
	const clean = await cleanRule(db, list, columns, input);
	if (!clean.ok) {
		return clean;
	}
	const count = await db.prepare('SELECT COUNT(*) AS n FROM list_rules WHERE list_id = ?').bind(list.id).first<{ n: number }>();
	if ((count?.n ?? 0) >= BASE_LIMITS.rules) {
		return err(409, 'Trop d’automatisations');
	}
	const row: RuleRow = { id: crypto.randomUUID(), list_id: list.id, trigger: JSON.stringify(clean.value.trigger), action: JSON.stringify(clean.value.action), enabled: 1, created_by: userId, created_at: Date.now() };
	await db
		.prepare('INSERT INTO list_rules (id, list_id, trigger, action, enabled, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
		.bind(row.id, row.list_id, row.trigger, row.action, row.enabled, row.created_by, row.created_at)
		.run();
	return ok(toRule(row));
}

export async function setRuleEnabled(db: D1Database, list: ListRow, id: string, enabled: unknown): Promise<Result<null>> {
	if (typeof enabled !== 'boolean') {
		return err(400, 'Valeur invalide');
	}
	const done = await db.prepare('UPDATE list_rules SET enabled = ? WHERE id = ? AND list_id = ?').bind(Number(enabled), id, list.id).run();
	return done.meta.changes ? ok(null) : err(404, 'Automatisation introuvable');
}

export async function deleteRule(db: D1Database, list: ListRow, id: string): Promise<Result<null>> {
	const done = await db.prepare('DELETE FROM list_rules WHERE id = ? AND list_id = ?').bind(id, list.id).run();
	return done.meta.changes ? ok(null) : err(404, 'Automatisation introuvable');
}

export type ItemState = { values: Record<string, ListValue>; fields: ItemFields };
export type Notice = { user: string | null; text: string };

// Une seule passe sur le changement de la personne : les effets d'une règle ne redéclenchent rien.
export function applyRules(rules: ListRule[], columns: ListColumn[], before: Record<string, ListValue>, state: ItemState): { state: ItemState; fired: number; notices: Notice[] } {
	const values = { ...state.values };
	const fields = { ...state.fields, labels: [...state.fields.labels] };
	const notices: Notice[] = [];
	let fired = 0;
	for (const rule of rules) {
		const t = rule.trigger;
		if (!rule.enabled || t.kind !== 'status' || state.values[t.column] !== t.option || before[t.column] === t.option) {
			continue;
		}
		const a = rule.action;
		const column = columns.find((c) => c.id === t.column);
		fired++;
		if (a.kind === 'done') {
			fields.done = true;
		} else if (a.kind === 'assign' && columns.some((c) => c.id === a.column && c.type === 'person')) {
			values[a.column] = a.user;
		} else if (a.kind === 'label' && !fields.labels.includes(a.label)) {
			fields.labels.push(a.label);
		} else if (a.kind === 'move' && statusOption(columns, a.column, a.option)) {
			values[a.column] = a.option;
		} else if (a.kind === 'notify') {
			notices.push({ user: a.user, text: `${column?.name ?? 'Statut'} : ${column?.options?.find((o) => o.id === t.option)?.label ?? ''}` });
		}
	}
	return { state: { values, fields }, fired, notices };
}

export const itemPeople = (columns: ListColumn[], values: Record<string, ListValue>) =>
	columns.filter((c) => c.type === 'person' && typeof values[c.id] === 'string').map((c) => values[c.id] as string);

// Destinataires relus en D1 ; le DO vérifie l'accès au salon de la base.
export async function sendNotice(env: Env, list: ListRow, actorId: string | null, userIds: string[], item: { id: string; title: string }, title: string): Promise<void> {
	const unique = [...new Set(userIds)].filter((id) => id !== actorId);
	if (!unique.length) {
		return;
	}
	const actors = (await Promise.all(unique.map((id) => loadActor(env.DB, list.workspace_id, id)))).filter((a) => a !== null);
	if (actors.length) {
		await workspaceStub(env, list.workspace_id).listNotice(actors, {
			actorId,
			workspaceId: list.workspace_id,
			listId: list.id,
			itemId: item.id,
			channelId: list.channel_id,
			title,
			body: `${item.title || 'Sans titre'} · ${list.title}`,
		});
	}
}

// Jour civil à Paris : l'échéance « demain » suit le calendrier des membres.
const parisDay = (at: number) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

type DueRow = ListRow & { item_id: string; item_title: string; vals: string; due_date: string; item_by: string; rule_action: string };

// Appelé par le cron : échéance demain ou aujourd'hui, une notification par date.
export async function sendDueSoon(env: Env, now: number): Promise<number> {
	const today = parisDay(now);
	const tomorrow = parisDay(now + 86_400_000);
	const { results } = await env.DB.prepare(
		`SELECT l.*, i.id AS item_id, i.title AS item_title, i.vals, i.due_date, i.created_by AS item_by,
			(SELECT r.action FROM list_rules r WHERE r.list_id = l.id AND r.enabled = 1 AND json_extract(r.trigger, '$.kind') = 'due_soon' LIMIT 1) AS rule_action
		FROM list_items i JOIN lists l ON l.id = i.list_id
		WHERE i.done = 0 AND i.archived_at IS NULL AND i.due_date IN (?, ?) AND (i.due_notified IS NULL OR i.due_notified != i.due_date) AND rule_action IS NOT NULL
		LIMIT 200`,
	)
		.bind(today, tomorrow)
		.all<DueRow>();
	let sent = 0;
	for (const row of results) {
		const claimed = await env.DB.prepare('UPDATE list_items SET due_notified = due_date WHERE id = ? AND due_date = ? AND (due_notified IS NULL OR due_notified != due_date)')
			.bind(row.item_id, row.due_date)
			.run();
		if (!claimed.meta.changes) {
			continue;
		}
		const action = parse<RuleAction>(row.rule_action, { kind: 'notify', user: null });
		const columns = parse<ListColumn[]>(row.columns, []);
		const { results: checks } = await env.DB.prepare('SELECT DISTINCT assignee FROM list_checks WHERE item_id = ? AND assignee IS NOT NULL AND done = 0').bind(row.item_id).all<{ assignee: string }>();
		const people = action.kind === 'notify' && action.user ? [action.user] : [...itemPeople(columns, parse(row.vals, {})), ...checks.map((c) => c.assignee)];
		await sendNotice(env, row, null, people.length ? people : [row.item_by], { id: row.item_id, title: row.item_title }, row.due_date === today ? 'Échéance aujourd’hui' : 'Échéance demain');
		sent++;
	}
	return sent;
}

// --- Document de l'élément ---

// Le document vit dans un DO CanvasDoc sans ligne « canvases » : les droits restent ceux de la base.
export async function itemDocId(db: D1Database, itemId: string, create: boolean): Promise<string | null> {
	const found = await db.prepare('SELECT canvas_id FROM list_item_pages WHERE item_id = ?').bind(itemId).first<{ canvas_id: string }>();
	if (found || !create) {
		return found?.canvas_id ?? null;
	}
	await db.prepare('INSERT OR IGNORE INTO list_item_pages (item_id, canvas_id, created_at) VALUES (?, ?, ?)').bind(itemId, crypto.randomUUID(), Date.now()).run();
	return itemDocId(db, itemId, false);
}

export const itemDocMeta = (list: ListRow, item: ListItem, docId: string, write: boolean): CanvasMeta =>
	toMeta(
		{ id: docId, workspace_id: list.workspace_id, channel_id: list.channel_id, title: item.title || 'Sans titre', excerpt: '', editors: '[]', created_by: item.createdBy, created_at: item.createdAt, updated_at: item.updatedAt, parent_id: null, icon: '', cover_key: null, position: 0, archived_at: null },
		write ? 'write' : 'read',
	);
