import { Hono } from 'hono';

import { BANNER_SIZE, BANNER_TYPES, isMemberKey, type Layout } from '../../shared/categories';
import { P } from '../../shared/permissions';
import type { ChannelOverrides } from '../../shared/types';
import { listGrades } from '../grades';
import { reviseWorkspace } from '../access';
import { denyUnless, fail, readJson, stub, unwrap, type AppEnv, type Ctx } from '../http';
import type { Result } from '../result';

export const categoryRoutes = new Hono<AppEnv>();

// Droits de salon changés via sa catégorie : les pages et cartes ouvertes relisent les accès.
function revised<T>(c: Ctx, result: Result<T>) {
	if (result.ok) {
		c.executionCtx.waitUntil(reviseWorkspace(c.env, c.get('workspaceId')).catch(() => undefined));
	}
	return unwrap(c, result);
}

// Clés admises : grades de l'espace ou membres préfixés par @ ; null au moindre inconnu.
export async function cleanOverrides(c: Ctx, overrides: unknown): Promise<ChannelOverrides | null> {
	if (!overrides || typeof overrides !== 'object') {
		return null;
	}
	const workspaceId = c.get('workspaceId');
	const grades = new Set((await listGrades(c.env.DB, workspaceId)).map((g) => g.id));
	const { results } = await c.env.DB.prepare('SELECT user_id FROM members WHERE workspace_id = ?').bind(workspaceId).all<{ user_id: string }>();
	const members = new Set(results.map((row) => `@${row.user_id}`));
	const clean: ChannelOverrides = {};
	for (const [key, value] of Object.entries(overrides as Record<string, { allow?: unknown; deny?: unknown } | null>)) {
		const known = isMemberKey(key) ? members.has(key) : grades.has(key);
		if (!known || !value || !Number.isInteger(value.allow) || !Number.isInteger(value.deny)) {
			return null;
		}
		clean[key] = { allow: value.allow as number, deny: value.deny as number };
	}
	return clean;
}

categoryRoutes.get('/w/:wid/categories', async (c) => c.json(await stub(c).categories(c.get('actor'))));

categoryRoutes.post('/w/:wid/categories', async (c) => {
	const { name } = await readJson<{ name: string }>(c);
	const created = await stub(c).createCategory(c.get('actor'), typeof name === 'string' ? name : '');
	return created.ok ? c.json(created.value, 201) : fail(c, created.status, created.error);
});

categoryRoutes.patch('/w/:wid/categories/:id', async (c) => {
	const { name } = await readJson<{ name: string }>(c);
	return unwrap(c, await stub(c).updateCategory(c.get('actor'), c.req.param('id'), typeof name === 'string' ? name : ''));
});

categoryRoutes.delete('/w/:wid/categories/:id', async (c) => {
	const id = c.req.param('id');
	const banner = (await stub(c).categories(c.get('actor'))).find((k) => k.id === id)?.bannerKey;
	const removed = await stub(c).deleteCategory(c.get('actor'), id);
	if (removed.ok) {
		await dropBanner(c, id, banner);
	}
	return unwrap(c, removed);
});

const bannerObject = (workspaceId: string, categoryId: string, key: string) => `category-banners/${workspaceId}/${categoryId}/${key}`;

async function dropBanner(c: Ctx, categoryId: string, key: string | null | undefined): Promise<void> {
	if (key) {
		await c.env.FILES.delete(bannerObject(c.get('workspaceId'), categoryId, key));
	}
}

// Recadrée en 4:1 côté client ; le serveur ne vérifie que type et poids.
categoryRoutes.post('/w/:wid/categories/:id/banner', async (c) => {
	const denied = denyUnless(c, P.MANAGE_CHANNELS);
	if (denied) {
		return denied;
	}
	const type = c.req.header('Content-Type')?.split(';')[0]?.trim() ?? '';
	const size = Number(c.req.header('Content-Length'));
	if (!BANNER_TYPES.includes(type)) {
		return fail(c, 400, 'Image PNG, JPEG ou WebP attendue');
	}
	if (!Number.isInteger(size) || size <= 0 || !c.req.raw.body) {
		return fail(c, 400, 'Fichier vide ou taille inconnue');
	}
	if (size > BANNER_SIZE) {
		return fail(c, 413, 'Image trop lourde (2 Mo max)');
	}
	const categoryId = c.req.param('id');
	const key = crypto.randomUUID();
	const stream = new FixedLengthStream(size);
	await Promise.all([c.env.FILES.put(bannerObject(c.get('workspaceId'), categoryId, key), stream.readable, { httpMetadata: { contentType: type } }), c.req.raw.body.pipeTo(stream.writable)]);
	const saved = await stub(c).setCategoryBanner(c.get('actor'), categoryId, key);
	if (!saved.ok) {
		await dropBanner(c, categoryId, key);
		return fail(c, saved.status, saved.error);
	}
	await dropBanner(c, categoryId, saved.value.previous);
	return c.json({ bannerKey: key }, 201);
});

categoryRoutes.delete('/w/:wid/categories/:id/banner', async (c) => {
	const denied = denyUnless(c, P.MANAGE_CHANNELS);
	if (denied) {
		return denied;
	}
	const categoryId = c.req.param('id');
	const saved = await stub(c).setCategoryBanner(c.get('actor'), categoryId, null);
	if (!saved.ok) {
		return fail(c, saved.status, saved.error);
	}
	await dropBanner(c, categoryId, saved.value.previous);
	return c.json({ bannerKey: null });
});

// Session seule, comme les logos : clé neuve à chaque envoi.
categoryRoutes.get('/category-banners/:wid/:id/:key', async (c) => {
	const object = await c.env.FILES.get(bannerObject(c.req.param('wid'), c.req.param('id'), c.req.param('key')));
	if (!object) {
		return fail(c, 404, 'Bannière introuvable');
	}
	return new Response(object.body, {
		headers: {
			'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
			'Content-Length': String(object.size),
			'Content-Security-Policy': "default-src 'none'; sandbox",
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, max-age=31536000, immutable',
		},
	});
});

categoryRoutes.get('/w/:wid/categories/:id/overrides', async (c) => unwrap(c, await stub(c).getCategoryOverrides(c.get('actor'), c.req.param('id'))));

categoryRoutes.put('/w/:wid/categories/:id/overrides', async (c) => {
	const clean = await cleanOverrides(c, (await readJson<{ overrides: ChannelOverrides }>(c)).overrides);
	if (!clean) {
		return fail(c, 400, 'Surcharges invalides');
	}
	return revised(c, await stub(c).setCategoryOverrides(c.get('actor'), c.req.param('id'), clean));
});

categoryRoutes.post('/w/:wid/channels/:cid/sync', async (c) => revised(c, await stub(c).syncChannel(c.get('actor'), c.req.param('cid'))));

categoryRoutes.put('/w/:wid/layout', async (c) => revised(c, await stub(c).setLayout(c.get('actor'), await readJson<Layout>(c))));
