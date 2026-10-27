import { Hono } from 'hono';

import type { CommandInput, CommandPayload, CommandReply } from '../../shared/commands';
import { LIMITS } from '../../shared/types';
import { callCommand } from '../commands';
import { fail, readJson, stub, unwrap, type AppEnv } from '../http';

export const commandRoutes = new Hono<AppEnv>();

commandRoutes.get('/w/:wid/commands', async (c) => c.json(await stub(c).commandList()));

commandRoutes.get('/w/:wid/commands/config', async (c) => unwrap(c, await stub(c).commandConfigs(c.get('actor'))));

commandRoutes.post('/w/:wid/commands', async (c) => unwrap(c, await stub(c).createCommand(c.get('actor'), await readJson<CommandInput>(c))));

commandRoutes.patch('/w/:wid/commands/:id', async (c) =>
	unwrap(c, await stub(c).updateCommand(c.get('actor'), c.req.param('id'), await readJson<CommandInput>(c))),
);

commandRoutes.delete('/w/:wid/commands/:id', async (c) => unwrap(c, await stub(c).deleteCommand(c.get('actor'), c.req.param('id'))));

// Appel sortant depuis le Worker : le DO ne reste pas bloqué 5 s sur un service lent.
commandRoutes.post('/w/:wid/channels/:cid/commands', async (c) => {
	const { name, text } = await readJson<{ name: string; text: string }>(c);
	if (typeof name !== 'string' || (text !== undefined && typeof text !== 'string')) {
		return fail(c, 400, 'Requête invalide');
	}
	const actor = c.get('actor');
	const channelId = c.req.param('cid');
	const target = await stub(c).commandTarget(actor, channelId, name.toLowerCase());
	if (!target.ok) {
		return fail(c, target.status, target.error);
	}
	const workspaceId = c.get('workspaceId');
	const workspace = await c.env.DB.prepare('SELECT name FROM workspaces WHERE id = ?').bind(workspaceId).first<{ name: string }>();
	const payload: CommandPayload = {
		command: `/${target.value.name}`,
		text: (text ?? '').slice(0, LIMITS.messageLength),
		user: { id: actor.id, name: actor.name },
		channel: { id: channelId, name: target.value.channelName },
		workspace: { id: workspaceId, name: workspace?.name ?? '' },
	};
	const reply = await callCommand(target.value, payload);
	if (!reply.ok) {
		console.log(JSON.stringify({ level: 'warn', message: 'slash command', command: target.value.name, error: reply.error, user: actor.id }));
		return c.json({ error: reply.error }, 502);
	}
	const ephemeral = target.value.ephemeral || reply.ephemeral;
	if (!ephemeral && reply.text) {
		const posted = await stub(c).postCommandReply(actor, channelId, target.value.name, reply.text);
		if (!posted.ok) {
			return fail(c, posted.status, posted.error);
		}
	}
	return c.json({ ephemeral, text: reply.text } satisfies CommandReply);
});
