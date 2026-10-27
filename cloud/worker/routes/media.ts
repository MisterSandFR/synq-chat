import { Hono } from 'hono';

import { fail, type AppEnv } from '../http';
import { unfurl } from '../media';

export const mediaRoutes = new Hono<AppEnv>();

mediaRoutes.get('/w/:wid/unfurl', async (c) => {
	const result = await unfurl(c.req.query('url') ?? '', (promise) => c.executionCtx.waitUntil(promise));
	if (!result.ok) {
		return fail(c, result.status, result.error);
	}
	c.header('Cache-Control', 'private, max-age=3600');
	return c.json(result.value);
});
