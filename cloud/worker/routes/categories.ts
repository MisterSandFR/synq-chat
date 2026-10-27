import { Hono } from 'hono';

import { isMemberKey, type Layout } from '../../shared/categories';
import type { ChannelOverrides } from '../../shared/types';
import { listGrades } from '../grades';
import { fail, readJson, stub, unwrap, type AppEnv, type Ctx } from '../http';

export const categoryRoutes = new Hono<AppEnv>();

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

categoryRoutes.delete('/w/:wid/categories/:id', async (c) => unwrap(c, await stub(c).deleteCategory(c.get('actor'), c.req.param('id'))));

categoryRoutes.get('/w/:wid/categories/:id/overrides', async (c) => unwrap(c, await stub(c).getCategoryOverrides(c.get('actor'), c.req.param('id'))));

categoryRoutes.put('/w/:wid/categories/:id/overrides', async (c) => {
	const clean = await cleanOverrides(c, (await readJson<{ overrides: ChannelOverrides }>(c)).overrides);
	if (!clean) {
		return fail(c, 400, 'Surcharges invalides');
	}
	return unwrap(c, await stub(c).setCategoryOverrides(c.get('actor'), c.req.param('id'), clean));
});

categoryRoutes.post('/w/:wid/channels/:cid/sync', async (c) => unwrap(c, await stub(c).syncChannel(c.get('actor'), c.req.param('cid'))));

categoryRoutes.put('/w/:wid/layout', async (c) => unwrap(c, await stub(c).setLayout(c.get('actor'), await readJson<Layout>(c))));
