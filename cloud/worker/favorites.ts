import { FAVORITES_MAX, type FavoriteKind, type FavoriteRef } from '../shared/favorites';

export const FAVORITES_MIGRATION = `CREATE TABLE favorites (
	user_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	ref_id TEXT NOT NULL,
	position INTEGER NOT NULL,
	PRIMARY KEY (user_id, kind, ref_id)
);`;

export type FavoriteRow = FavoriteRef & { position: number };

const refKey = (ref: FavoriteRef) => `${ref.kind}:${ref.refId}`;

export function favoriteRows(sql: SqlStorage, userId: string): FavoriteRow[] {
	return sql
		.exec<{ kind: FavoriteKind; ref_id: string; position: number }>('SELECT kind, ref_id, position FROM favorites WHERE user_id = ? ORDER BY position, rowid', userId)
		.toArray()
		.map((row) => ({ kind: row.kind, refId: row.ref_id, position: row.position }));
}

// Déjà favori : rien ne bouge ; false au plafond.
export function insertFavorite(sql: SqlStorage, userId: string, ref: FavoriteRef): boolean {
	if (sql.exec('SELECT 1 FROM favorites WHERE user_id = ? AND kind = ? AND ref_id = ?', userId, ref.kind, ref.refId).toArray().length) {
		return true;
	}
	const { n, top } = sql.exec<{ n: number; top: number | null }>('SELECT COUNT(*) AS n, MAX(position) AS top FROM favorites WHERE user_id = ?', userId).one();
	if (n >= FAVORITES_MAX) {
		return false;
	}
	sql.exec('INSERT INTO favorites (user_id, kind, ref_id, position) VALUES (?, ?, ?, ?)', userId, ref.kind, ref.refId, (top ?? -1) + 1);
	return true;
}

export function deleteFavorite(sql: SqlStorage, userId: string, ref: FavoriteRef): void {
	sql.exec('DELETE FROM favorites WHERE user_id = ? AND kind = ? AND ref_id = ?', userId, ref.kind, ref.refId);
}

// Ordre reçu d'abord ; les favoris absents de la liste (masqués côté client) suivent dans leur ordre.
export function reorderFavorites(sql: SqlStorage, userId: string, refs: FavoriteRef[]): void {
	const current = favoriteRows(sql, userId);
	const byKey = new Map(current.map((row) => [refKey(row), row]));
	const wanted = [...new Set(refs.map(refKey))].filter((key) => byKey.has(key));
	const rest = current.map(refKey).filter((key) => !wanted.includes(key));
	[...wanted, ...rest].forEach((key, position) => {
		const row = byKey.get(key)!;
		sql.exec('UPDATE favorites SET position = ? WHERE user_id = ? AND kind = ? AND ref_id = ?', position, userId, row.kind, row.refId);
	});
}
