import type { Category, Layout } from '../shared/categories';
import { LIMITS, type ChannelInput, type ChannelOverrides } from '../shared/types';

type Sql = SqlStorage;

export const cleanCategoryName = (raw: unknown) => (typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, LIMITS.categoryLength) : '');

export const listCategories = (sql: Sql): Category[] =>
	sql.exec<{ id: string; name: string; position: number }>('SELECT id, name, position FROM categories ORDER BY position, name').toArray();

const categoryExists = (sql: Sql, id: string) => sql.exec('SELECT 1 FROM categories WHERE id = ?', id).toArray().length > 0;

export const nextPosition = (sql: Sql, categoryId: string | null) =>
	(sql.exec<{ max: number | null }>('SELECT MAX(position) AS max FROM channels WHERE category_id IS ?', categoryId).one().max ?? -1) + 1;

export function insertCategory(sql: Sql, name: string): Category {
	const { max } = sql.exec<{ max: number | null }>('SELECT MAX(position) AS max FROM categories').one();
	const category = { id: crypto.randomUUID(), name, position: (max ?? -1) + 1 };
	sql.exec('INSERT INTO categories (id, name, position) VALUES (?, ?, ?)', category.id, category.name, category.position);
	return category;
}

export function renameCategory(sql: Sql, id: string, name: string): Category | null {
	sql.exec('UPDATE categories SET name = ? WHERE id = ?', name, id);
	return listCategories(sql).find((c) => c.id === id) ?? null;
}

// Salons conservés, rangés après ceux sans catégorie.
export function removeCategory(sql: Sql, id: string): void {
	const offset = nextPosition(sql, null);
	sql.exec('UPDATE channels SET category_id = NULL, synced = 0, position = position + ? WHERE category_id = ?', offset, id);
	sql.exec('DELETE FROM category_overrides WHERE category_id = ?', id);
	sql.exec('DELETE FROM categories WHERE id = ?', id);
}

// undefined : catégorie inconnue. Un nom libre (ancien champ texte) retrouve ou crée la catégorie.
export function resolveCategory(sql: Sql, input: ChannelInput, fallback: string | null): string | null | undefined {
	if (input.categoryId !== undefined) {
		if (input.categoryId === null) {
			return null;
		}
		return typeof input.categoryId === 'string' && categoryExists(sql, input.categoryId) ? input.categoryId : undefined;
	}
	if (typeof input.category === 'string') {
		const name = cleanCategoryName(input.category);
		if (!name) {
			return null;
		}
		const found = sql.exec<{ id: string }>('SELECT id FROM categories WHERE name = ? COLLATE NOCASE', name).toArray()[0];
		return found?.id ?? insertCategory(sql, name).id;
	}
	return fallback;
}

export function readCategoryOverrides(sql: Sql, id: string): ChannelOverrides {
	const rows = sql.exec<{ subject_id: string; allow: number; deny: number }>('SELECT subject_id, allow, deny FROM category_overrides WHERE category_id = ?', id).toArray();
	return Object.fromEntries(rows.map((row) => [row.subject_id, { allow: row.allow, deny: row.deny }]));
}

export function copyCategoryOverrides(sql: Sql, categoryId: string, channelId: string): void {
	sql.exec('DELETE FROM channel_overrides WHERE channel_id = ?', channelId);
	sql.exec(
		'INSERT INTO channel_overrides (channel_id, grade_id, allow, deny) SELECT ?, subject_id, allow, deny FROM category_overrides WHERE category_id = ?',
		channelId,
		categoryId,
	);
}

// Surcharges déjà masquées par l'appelant ; propagées aux salons synchronisés.
export function writeCategoryOverrides(sql: Sql, id: string, overrides: ChannelOverrides): void {
	sql.exec('DELETE FROM category_overrides WHERE category_id = ?', id);
	for (const [subject, override] of Object.entries(overrides)) {
		if (override.allow || override.deny) {
			sql.exec('INSERT INTO category_overrides (category_id, subject_id, allow, deny) VALUES (?, ?, ?, ?)', id, subject, override.allow, override.deny);
		}
	}
	for (const { id: channelId } of sql.exec<{ id: string }>('SELECT id FROM channels WHERE category_id = ? AND synced = 1', id).toArray()) {
		copyCategoryOverrides(sql, id, channelId);
	}
}

const sameSet = (values: unknown[], known: Set<string>) => new Set(values).size === values.length && values.every((v) => typeof v === 'string' && known.has(v));

// Toutes les catégories exactement une fois ; salons facultatifs (un gestionnaire ne les voit pas forcément tous).
export function validLayout(sql: Sql, layout: Partial<Layout>): Layout | null {
	const categories = new Set(listCategories(sql).map((c) => c.id));
	const channels = new Set(sql.exec<{ id: string }>('SELECT id FROM channels').toArray().map((row) => row.id));
	if (!Array.isArray(layout.categories) || !Array.isArray(layout.channels) || layout.categories.length !== categories.size || !sameSet(layout.categories, categories)) {
		return null;
	}
	const moves = layout.channels.filter((m) => m && typeof m === 'object');
	if (moves.length !== layout.channels.length || !sameSet(moves.map((m) => m.id), channels)) {
		return null;
	}
	if (!moves.every((m) => m.categoryId === null || (typeof m.categoryId === 'string' && categories.has(m.categoryId)))) {
		return null;
	}
	return { categories: layout.categories, channels: moves.map(({ id, categoryId }) => ({ id, categoryId })) };
}

// Un salon synchronisé qui change de catégorie prend les permissions de la nouvelle.
export function applyLayout(sql: Sql, layout: Layout): void {
	layout.categories.forEach((id, index) => sql.exec('UPDATE categories SET position = ? WHERE id = ?', index, id));
	const counters = new Map<string | null, number>();
	for (const { id, categoryId } of layout.channels) {
		const position = counters.get(categoryId) ?? 0;
		counters.set(categoryId, position + 1);
		const row = sql.exec<{ category_id: string | null; synced: number }>('SELECT category_id, synced FROM channels WHERE id = ?', id).one();
		const moved = row.category_id !== categoryId;
		sql.exec('UPDATE channels SET category_id = ?, position = ?, synced = ? WHERE id = ?', categoryId, position, moved && !categoryId ? 0 : row.synced, id);
		if (moved && categoryId && row.synced === 1) {
			copyCategoryOverrides(sql, categoryId, id);
		}
	}
}
