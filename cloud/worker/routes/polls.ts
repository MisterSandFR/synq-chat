import { Hono } from 'hono';

import type { PollInput, PollOptionInput } from '../../shared/polls';
import { fail, readJson, stub, unwrap, type AppEnv } from '../http';

export const pollRoutes = new Hono<AppEnv>();

const messageId = (c: { req: { param: (name: 'mid') => string } }) => Number(c.req.param('mid'));

pollRoutes.post('/w/:wid/channels/:cid/polls', async (c) => {
	const created = await stub(c).createPoll(c.get('actor'), c.req.param('cid'), await readJson<PollInput>(c));
	return created.ok ? c.json(created.value, 201) : fail(c, created.status, created.error);
});

pollRoutes.get('/w/:wid/polls/:mid', async (c) => unwrap(c, await stub(c).pollView(c.get('actor'), messageId(c))));

pollRoutes.put('/w/:wid/polls/:mid/votes', async (c) => {
	const input = await readJson<{ optionIds: string[] }>(c);
	return unwrap(c, await stub(c).pollVote(c.get('actor'), messageId(c), input.optionIds));
});

pollRoutes.delete('/w/:wid/polls/:mid/votes', async (c) => unwrap(c, await stub(c).pollVote(c.get('actor'), messageId(c), [])));

pollRoutes.post('/w/:wid/polls/:mid/options', async (c) => unwrap(c, await stub(c).pollAddOption(c.get('actor'), messageId(c), await readJson<PollOptionInput>(c))));

pollRoutes.post('/w/:wid/polls/:mid/close', async (c) => unwrap(c, await stub(c).pollClose(c.get('actor'), messageId(c))));
