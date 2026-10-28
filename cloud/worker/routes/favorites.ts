import { Hono } from 'hono';

import { FAVORITE_KINDS, FAVORITES_MAX, type Favorite, type FavoriteRef } from '../../shared/favorites';
import { pageAccess, readableBases } from '../access';
import type { FavoriteRow } from '../favorites';
import { fail, readJson, stub, unwrap, type AppEnv, type Ctx } from '../http';
import { listRow } from '../lists';

export const favoriteRoutes = new Hono<AppEnv>();

const isRef = (value: unknown): value is FavoriteRef => {
	const ref = value as FavoriteRef | null;
	return typeof ref === 'object' && ref !== null && FAVORITE_KINDS.includes(ref.kind) && typeof ref.refId === 'string' && ref.refId.length > 0 && ref.refId.length <= 64;
};

const TABLES = [
	['canvas', 'canvases'],
	['list', 'lists'],
] as const;

// Canevas et listes rangés en D1 : titre et droit relus ici, invisible = absent de la réponse.
async function described(c: Ctx, rows: FavoriteRow[]): Promise<Favorite[]> {
	const actor = c.get('actor');
	const titles = new Map<string, string>();
	for (const [kind, table] of TABLES) {
		const ids = rows.filter((row) => row.kind === kind).map((row) => row.refId);
		if (!ids.length) {
			continue;
		}
		const { results } = await c.env.DB.prepare(`SELECT id, title, channel_id, created_by, restricted FROM ${table} WHERE workspace_id = ? AND id IN (${ids.map(() => '?').join(', ')})`)
			.bind(c.get('workspaceId'), ...ids)
			.all<{ id: string; title: string; channel_id: string | null; created_by: string; restricted: number }>();
		const readable = kind === 'canvas' ? new Set((await pageAccess(c.env, c.get('workspaceId'), actor)).levels.keys()) : await readableBases(c.env, c.get('workspaceId'), actor, results);
		results.forEach((row) => readable.has(row.id) && titles.set(`${kind}:${row.id}`, row.title));
	}
	return rows.flatMap((row) => {
		if (row.kind === 'channel') {
			return [{ ...row, title: '' }];
		}
		const title = titles.get(`${row.kind}:${row.refId}`);
		return title === undefined ? [] : [{ ...row, title }];
	});
}

// Salons vérifiés par le DO ; canevas et listes comme leurs routes (introuvable plutôt qu'interdit).
async function visible(c: Ctx, ref: FavoriteRef): Promise<boolean> {
	if (ref.kind === 'channel') {
		return true;
	}
	const actor = c.get('actor');
	if (ref.kind === 'canvas') {
		return (await pageAccess(c.env, c.get('workspaceId'), actor)).levels.has(ref.refId);
	}
	const row = await listRow(c.env.DB, c.get('workspaceId'), ref.refId);
	return Boolean(row && (await readableBases(c.env, c.get('workspaceId'), actor, [row])).has(row.id));
}

favoriteRoutes.get('/w/:wid/favorites', async (c) => c.json(await described(c, await stub(c).favorites(c.get('actor')))));

favoriteRoutes.put('/w/:wid/favorites', async (c) => {
	const body = await readJson<FavoriteRef & { favorite: boolean }>(c);
	const { favorite } = body;
	if (!isRef(body) || typeof favorite !== 'boolean') {
		return fail(c, 400, 'Requête invalide');
	}
	const ref: FavoriteRef = { kind: body.kind, refId: body.refId };
	if (favorite && !(await visible(c, ref))) {
		return fail(c, 404, 'Élément introuvable');
	}
	return unwrap(c, await stub(c).setFavorite(c.get('actor'), ref, favorite));
});

favoriteRoutes.put('/w/:wid/favorites/order', async (c) => {
	const { items } = await readJson<{ items: FavoriteRef[] }>(c);
	if (!Array.isArray(items) || items.length > FAVORITES_MAX || !items.every(isRef)) {
		return fail(c, 400, 'Requête invalide');
	}
	return unwrap(c, await stub(c).orderFavorites(c.get('actor'), items.map((ref) => ({ kind: ref.kind, refId: ref.refId }))));
});
