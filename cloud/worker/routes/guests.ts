import { Hono } from 'hono';

import { fail, readJson, stub, unwrap, type AppEnv, type Ctx } from '../http';
import { createGuestInvite, guestSlots, listGuestInvites, revokeGuestInvite } from '../guests';

export const guestRoutes = new Hono<AppEnv>();

// Participant d'un groupe ; un invité n'arrive jamais ici (liste blanche en amont).
async function groupOf(c: Ctx) {
	const conversation = await stub(c).guestConversation(c.req.param('cid') ?? '', null);
	if (!conversation || !conversation.memberIds.includes(c.get('actor').id)) {
		return { error: fail(c, 404, 'Conversation introuvable') };
	}
	if (!conversation.group) {
		return { error: fail(c, 400, 'Réservé aux groupes') };
	}
	return { conversation };
}

guestRoutes.get('/w/:wid/dms/:cid/guests', async (c) => {
	const { error } = await groupOf(c);
	return error ?? c.json(await listGuestInvites(c, c.req.param('cid')));
});

guestRoutes.post('/w/:wid/dms/:cid/guests', async (c) => {
	const { conversation, error } = await groupOf(c);
	if (error) {
		return error;
	}
	if (guestSlots(conversation.memberIds.length) <= 0) {
		return fail(c, 400, 'Groupe complet');
	}
	const body = await readJson<{ email: string; send: boolean }>(c);
	const created = await createGuestInvite(c, c.req.param('cid'), body.email, body.send === true, conversation.name);
	return created.ok ? c.json(created.value, 201) : unwrap(c, created);
});

guestRoutes.delete('/w/:wid/dms/:cid/guests/:id', async (c) => {
	const { error } = await groupOf(c);
	if (error) {
		return error;
	}
	return (await revokeGuestInvite(c, c.req.param('cid'), c.req.param('id'))) ? c.json({ ok: true }) : fail(c, 404, 'Invitation introuvable');
});
