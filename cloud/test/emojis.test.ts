import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { Reaction } from '../shared/chat';
import type { CustomEmoji } from '../shared/emojis';
import type { DirectConversation } from '../shared/dm-threads';
import type { Message } from '../shared/types';
import type { GuestInviteCreated } from '../shared/guests';
import { Client, workspaceWithMember } from './helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).buffer;

const send = (client: Client, wid: string, name: string, body: ArrayBuffer | string = PNG, type = 'image/png') =>
	client.req<CustomEmoji>('POST', `/api/w/${wid}/emojis`, body, { 'content-type': type, 'x-emoji-name': name });

describe('emojis d’espace', () => {
	it('envoie, liste, sert, renomme et supprime', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const sent = await send(owner, wid, 'party');
		expect(sent.status).toBe(201);
		expect(sent.data).toMatchObject({ name: 'party', animated: false, createdBy: owner.user.id });
		expect(sent.data.url).toMatch(new RegExp(`^/api/emojis/${wid}/`));
		expect((await send(owner, wid, 'dance', PNG, 'image/gif')).data.animated).toBe(true);

		const list = await member.req<CustomEmoji[]>('GET', `/api/w/${wid}/emojis`);
		expect(list.data.map((e) => e.name)).toEqual(['dance', 'party']);
		const image = await member.raw('GET', sent.data.url);
		expect(image.status).toBe(200);
		expect(image.headers.get('content-type')).toBe('image/png');
		expect(image.headers.get('content-security-policy')).toContain('sandbox');
		expect(image.headers.get('x-content-type-options')).toBe('nosniff');
		expect((await image.arrayBuffer()).byteLength).toBe(PNG.byteLength);

		const renamed = await owner.req<CustomEmoji>('PATCH', `/api/w/${wid}/emojis/party`, { name: 'fiesta' });
		expect(renamed.status).toBe(200);
		expect(renamed.data.url).toBe(sent.data.url);
		expect((await owner.req('PATCH', `/api/w/${wid}/emojis/fiesta`, { name: 'dance' })).status).toBe(409);
		expect((await owner.req('PATCH', `/api/w/${wid}/emojis/fiesta`, { name: 'Pas Bon' })).status).toBe(400);
		expect((await owner.req('PATCH', `/api/w/${wid}/emojis/party`, { name: 'autre' })).status).toBe(404);

		expect((await owner.req('DELETE', `/api/w/${wid}/emojis/fiesta`)).status).toBe(200);
		expect((await owner.req('GET', sent.data.url)).status).toBe(404);
		expect((await owner.req('DELETE', `/api/w/${wid}/emojis/fiesta`)).status).toBe(404);
		expect((await member.req<CustomEmoji[]>('GET', `/api/w/${wid}/emojis`)).data.map((e) => e.name)).toEqual(['dance']);
	});

	it('refuse sans permission, nom invalide ou pris, mauvais type ou taille', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		expect((await send(member, wid, 'party')).status).toBe(403);
		expect((await member.req('PATCH', `/api/w/${wid}/emojis/party`, { name: 'x_y' })).status).toBe(403);
		expect((await member.req('DELETE', `/api/w/${wid}/emojis/party`)).status).toBe(403);
		expect((await send(owner, wid, 'A')).status).toBe(400);
		expect((await send(owner, wid, 'avec-tiret')).status).toBe(400);
		expect((await send(owner, wid, 'x'.repeat(33))).status).toBe(400);
		expect((await send(owner, wid, 'vecteur', '<svg></svg>', 'image/svg+xml')).status).toBe(400);
		expect((await send(owner, wid, 'lourd', new ArrayBuffer(256 * 1024 + 1))).status).toBe(413);
		expect((await send(owner, wid, 'party')).status).toBe(201);
		expect((await send(owner, wid, 'party')).status).toBe(409);
	});

	it('plafonne à 200 par espace', async () => {
		const { owner, wid } = await workspaceWithMember();
		const insert = env.DB.prepare('INSERT INTO custom_emojis (workspace_id, name, object_key, animated, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?)');
		await env.DB.batch(Array.from({ length: 199 }, (_, i) => insert.bind(wid, `e${i}`, `k${i}`, owner.user.id, Date.now())));
		expect((await send(owner, wid, 'derniere')).status).toBe(201);
		const refused = await send(owner, wid, 'de_trop');
		expect(refused.status).toBe(400);
	});

	it('journalise création, renommage et suppression', async () => {
		const { owner, wid } = await workspaceWithMember();
		await send(owner, wid, 'party');
		await owner.req('PATCH', `/api/w/${wid}/emojis/party`, { name: 'fiesta' });
		await owner.req('DELETE', `/api/w/${wid}/emojis/fiesta`);
		const audit = await owner.req<{ items: Array<{ action: string; targetName: string | null }> }>('GET', `/api/w/${wid}/audit?kind=emoji`);
		expect(audit.data.items.map((e) => [e.action, e.targetName])).toEqual([
			['emoji.delete', 'fiesta'],
			['emoji.rename', 'fiesta'],
			['emoji.create', 'party'],
		]);
	});

	it('accepte la réaction :nom: d’un emoji existant seulement', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		await send(owner, wid, 'party');
		const message = await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'Salut :party:' });
		const path = (emoji: string) => `/api/w/${wid}/messages/${message.data.id}/reactions/${encodeURIComponent(emoji)}`;
		const added = await member.req<Reaction[]>('PUT', path(':party:'));
		expect(added.status).toBe(200);
		expect(added.data).toEqual([{ emoji: ':party:', users: [member.user.id] }]);
		expect((await member.req('PUT', path(':inconnu:'))).status).toBe(400);
		await owner.req('DELETE', `/api/w/${wid}/emojis/party`);
		expect((await member.req<Reaction[]>('DELETE', path(':party:'))).data).toEqual([]);
	});

	it('laisse l’invité lire la liste sans envoyer', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const sent = await send(owner, wid, 'party');
		const dm = await owner.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [member.user.id], name: 'Projet' });
		const created = await owner.req<GuestInviteCreated>('POST', `/api/w/${wid}/dms/${dm.data.id}/guests`, { email: 'presta@externe.fr' });
		const guest = new Client();
		expect((await guest.req('POST', `/api/guest/${created.data.link.split('/invite/guest/')[1]!}`, { name: 'Gina' })).status).toBe(200);
		expect((await guest.req<CustomEmoji[]>('GET', `/api/w/${wid}/emojis`)).data.map((e) => e.name)).toEqual(['party']);
		expect((await guest.raw('GET', sent.data.url)).status).toBe(200);
		expect((await send(guest, wid, 'pirate')).status).toBe(403);
	});
});
