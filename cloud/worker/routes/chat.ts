import { Hono } from 'hono';

import { CUSTOM_REACTION_RE } from '../../shared/emojis';
import { fail, stub, unwrap, type AppEnv } from '../http';
import { customEmojiExists } from './emojis';

export const chatRoutes = new Hono<AppEnv>();

chatRoutes.put('/w/:wid/messages/:mid/reactions/:emoji', async (c) => {
	const custom = CUSTOM_REACTION_RE.exec(c.req.param('emoji'))?.[1];
	if (custom && !(await customEmojiExists(c, custom))) {
		return fail(c, 400, 'Emoji inconnu');
	}
	return unwrap(c, await stub(c).react(c.get('actor'), Number(c.req.param('mid')), c.req.param('emoji'), true));
});

chatRoutes.delete('/w/:wid/messages/:mid/reactions/:emoji', async (c) =>
	unwrap(c, await stub(c).react(c.get('actor'), Number(c.req.param('mid')), c.req.param('emoji'), false)),
);

chatRoutes.get('/w/:wid/channels/:cid/pins', async (c) => unwrap(c, await stub(c).pins(c.get('actor'), c.req.param('cid'))));

chatRoutes.put('/w/:wid/messages/:mid/pin', async (c) => unwrap(c, await stub(c).pin(c.get('actor'), Number(c.req.param('mid')), true)));

chatRoutes.delete('/w/:wid/messages/:mid/pin', async (c) => unwrap(c, await stub(c).pin(c.get('actor'), Number(c.req.param('mid')), false)));
