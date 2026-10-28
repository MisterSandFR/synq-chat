import { Hono } from 'hono';

import { fail, readJson, stub, unwrap, type AppEnv, type Ctx } from '../http';
import { resolveAttachments } from '../media';

export const draftRoutes = new Hono<AppEnv>();

type DraftBody = { channelId: string; threadRoot: number; body: string; attachmentKeys: string[]; replyTo: number; sendAt: number };

const threadOf = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : 0);

const positiveId = (value: string | undefined) => {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : null;
};

// Métadonnées des pièces jointes relues depuis R2, jamais depuis le client.
async function content(c: Ctx, body: Partial<DraftBody>) {
	const keys: unknown[] = Array.isArray(body.attachmentKeys) ? body.attachmentKeys : [];
	const attachments = await resolveAttachments(c.env.FILES, c.get('workspaceId'), keys);
	return { attachments, text: typeof body.body === 'string' ? body.body : '' };
}

draftRoutes.get('/w/:wid/drafts', async (c) => c.json(await stub(c).draftsList(c.get('actor'))));

draftRoutes.put('/w/:wid/drafts', async (c) => {
	const body = await readJson<DraftBody>(c);
	if (typeof body.channelId !== 'string') {
		return fail(c, 400, 'Salon manquant');
	}
	const { attachments, text } = await content(c, body);
	if (!attachments.ok) {
		return fail(c, attachments.status, attachments.error);
	}
	return unwrap(c, await stub(c).draftSave(c.get('actor'), body.channelId, threadOf(body.threadRoot), text, attachments.value));
});

draftRoutes.delete('/w/:wid/drafts/:cid', async (c) => {
	await stub(c).draftDelete(c.get('actor'), c.req.param('cid'), threadOf(Number(c.req.query('thread'))));
	return c.json({ ok: true });
});

draftRoutes.get('/w/:wid/scheduled', async (c) => c.json(await stub(c).scheduledList(c.get('actor'))));

draftRoutes.post('/w/:wid/scheduled', async (c) => {
	const body = await readJson<DraftBody>(c);
	if (typeof body.channelId !== 'string') {
		return fail(c, 400, 'Salon manquant');
	}
	const { attachments, text } = await content(c, body);
	if (!attachments.ok) {
		return fail(c, attachments.status, attachments.error);
	}
	return unwrap(
		c,
		await stub(c).scheduleMessage(c.get('actor'), c.get('workspaceId'), {
			channelId: body.channelId,
			threadRoot: threadOf(body.threadRoot),
			body: text,
			attachments: attachments.value,
			replyTo: Number.isInteger(body.replyTo) ? (body.replyTo as number) : null,
			sendAt: body.sendAt as number,
		}),
	);
});

draftRoutes.patch('/w/:wid/scheduled/:id', async (c) => {
	const id = positiveId(c.req.param('id'));
	const { sendAt } = await readJson<DraftBody>(c);
	return id ? unwrap(c, await stub(c).scheduledMove(c.get('actor'), id, sendAt)) : fail(c, 404, 'Message programmé introuvable');
});

draftRoutes.delete('/w/:wid/scheduled/:id', async (c) => {
	const id = positiveId(c.req.param('id'));
	return id ? unwrap(c, await stub(c).scheduledCancel(c.get('actor'), id)) : fail(c, 404, 'Message programmé introuvable');
});

draftRoutes.post('/w/:wid/scheduled/:id/send', async (c) => {
	const id = positiveId(c.req.param('id'));
	return id ? unwrap(c, await stub(c).scheduledSendNow(c.get('actor'), id)) : fail(c, 404, 'Message programmé introuvable');
});

draftRoutes.get('/w/:wid/sent', async (c) => {
	const raw = c.req.query('before');
	const before = raw === undefined ? null : positiveId(raw);
	if (raw !== undefined && before === null) {
		return fail(c, 400, 'Requête invalide');
	}
	return c.json(await stub(c).sentMessages(c.get('actor'), before));
});
