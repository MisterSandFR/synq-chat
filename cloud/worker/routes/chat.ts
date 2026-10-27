import { Hono } from 'hono';

import { stub, unwrap, type AppEnv } from '../http';

export const chatRoutes = new Hono<AppEnv>();

chatRoutes.put('/w/:wid/messages/:mid/reactions/:emoji', async (c) =>
	unwrap(c, await stub(c).react(c.get('actor'), Number(c.req.param('mid')), c.req.param('emoji'), true)),
);

chatRoutes.delete('/w/:wid/messages/:mid/reactions/:emoji', async (c) =>
	unwrap(c, await stub(c).react(c.get('actor'), Number(c.req.param('mid')), c.req.param('emoji'), false)),
);

chatRoutes.get('/w/:wid/channels/:cid/pins', async (c) => unwrap(c, await stub(c).pins(c.get('actor'), c.req.param('cid'))));

chatRoutes.put('/w/:wid/messages/:mid/pin', async (c) => unwrap(c, await stub(c).pin(c.get('actor'), Number(c.req.param('mid')), true)));

chatRoutes.delete('/w/:wid/messages/:mid/pin', async (c) => unwrap(c, await stub(c).pin(c.get('actor'), Number(c.req.param('mid')), false)));
