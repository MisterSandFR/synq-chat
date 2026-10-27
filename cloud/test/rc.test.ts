import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { P } from '../shared/permissions';
import type { Announcement, Profile, SavedMessage } from '../shared/rc';
import type { Me, Message, ServerEvent, User } from '../shared/types';
import { signup, workspaceWithMember } from './helpers';

type Hello = Extract<ServerEvent, { t: 'hello' }>;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).buffer;

describe('statut et profil', () => {
	it('règle statut, texte expirant, bio et fuseau', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const until = Date.now() + 60_000;
		const res = await member.req<Profile>('PATCH', '/api/me/profile', { status: 'busy', statusText: '  En   réunion ', statusUntil: until, bio: 'Dev', timezone: 'Europe/Paris' });
		expect(res.status).toBe(200);
		expect(res.data).toMatchObject({ status: 'busy', statusText: 'En réunion', statusUntil: until, bio: 'Dev', timezone: 'Europe/Paris' });
		const seen = await owner.req<Profile[]>('GET', `/api/w/${wid}/profiles`);
		expect(seen.data.find((p) => p.userId === member.user.id)).toMatchObject({ status: 'busy', statusText: 'En réunion', bio: 'Dev' });
		expect((await member.req<Profile>('GET', '/api/me/profile')).data.status).toBe('busy');
	});

	it('rejette les entrées invalides', async () => {
		const alice = await signup('Alice');
		expect((await alice.req('PATCH', '/api/me/profile', { status: 'parti' })).status).toBe(400);
		expect((await alice.req('PATCH', '/api/me/profile', { timezone: 'Mars/Olympus' })).status).toBe(400);
		expect((await alice.req('PATCH', '/api/me/profile', { bio: 'x'.repeat(301) })).status).toBe(400);
		expect((await alice.req('PATCH', '/api/me/profile', { statusUntil: Date.now() - 1 })).status).toBe(400);
		expect((await alice.req('PATCH', '/api/me/profile', {})).status).toBe(400);
	});

	it('masque un invisible et un texte expiré', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		await member.req('PATCH', '/api/me/profile', { status: 'invisible', statusText: 'Concentré', statusUntil: Date.now() + 60_000 });
		await env.DB.prepare('UPDATE users SET status_until = ? WHERE id = ?').bind(Date.now() - 1000, member.user.id).run();
		const forOwner = (await owner.req<Profile[]>('GET', `/api/w/${wid}/profiles`)).data.find((p) => p.userId === member.user.id);
		expect(forOwner).toMatchObject({ status: 'offline', statusText: '', statusUntil: null });
		const forSelf = (await member.req<Profile[]>('GET', `/api/w/${wid}/profiles`)).data.find((p) => p.userId === member.user.id);
		expect(forSelf?.status).toBe('invisible');
	});

	it('réserve les profils de l’espace à ses membres', async () => {
		const { wid } = await workspaceWithMember();
		const outsider = await signup('Eve');
		expect((await outsider.req('GET', `/api/w/${wid}/profiles`)).status).toBe(404);
	});
});

describe('avatar', () => {
	it('envoie, sert et retire un avatar', async () => {
		const alice = await signup('Alice');
		const sent = await alice.req<User>('POST', '/api/me/avatar', PNG, { 'content-type': 'image/png' });
		expect(sent.status).toBe(201);
		const url = sent.data.avatarUrl!;
		expect(url).toMatch(/^\/api\/avatars\//);
		const got = await alice.raw('GET', url);
		expect(got.status).toBe(200);
		expect(got.headers.get('content-type')).toBe('image/png');
		expect(got.headers.get('content-security-policy')).toContain('sandbox');
		expect((await got.arrayBuffer()).byteLength).toBe(PNG.byteLength);
		expect((await alice.req<Me>('GET', '/api/me')).data.user.avatarUrl).toBe(url);

		expect((await alice.req('POST', '/api/me/avatar', '<svg></svg>', { 'content-type': 'image/svg+xml' })).status).toBe(400);
		expect((await alice.req('POST', '/api/me/avatar', new ArrayBuffer(2 * 1024 * 1024 + 1), { 'content-type': 'image/png' })).status).toBe(413);

		expect((await alice.req('DELETE', '/api/me/avatar')).status).toBe(200);
		expect((await alice.req('GET', url)).status).toBe(404);
		expect((await alice.req<Me>('GET', '/api/me')).data.user.avatarUrl).toBeNull();
	});
});

describe('messages enregistrés', () => {
	it('enregistre, liste et retire', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const posted = await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'À garder' });
		const path = `/api/w/${wid}/messages/${posted.data.id}/saved`;
		expect((await member.req('PUT', path, { saved: true })).status).toBe(200);
		expect((await member.req('PUT', path, { saved: true })).status).toBe(200);
		expect((await member.req<SavedMessage[]>('GET', `/api/w/${wid}/saved`)).data.map((s) => s.message.body)).toEqual(['À garder']);
		expect((await owner.req<SavedMessage[]>('GET', `/api/w/${wid}/saved`)).data).toEqual([]);
		expect((await member.req('PUT', `/api/w/${wid}/messages/999999/saved`, { saved: true })).status).toBe(404);
		expect((await member.req('PUT', path, {})).status).toBe(400);
		expect((await member.req('PUT', path, { saved: false })).status).toBe(200);
		expect((await member.req<SavedMessage[]>('GET', `/api/w/${wid}/saved`)).data).toEqual([]);
	});

	it('cache un message devenu invisible et oublie un message supprimé', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const posted = await owner.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'Secret' });
		await member.req('PUT', `/api/w/${wid}/messages/${posted.data.id}/saved`, { saved: true });
		const overrides = `/api/w/${wid}/channels/${general.id}/overrides`;
		expect((await owner.req('PUT', overrides, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } })).status).toBe(200);
		expect((await member.req<SavedMessage[]>('GET', `/api/w/${wid}/saved`)).data).toEqual([]);
		await owner.req('PUT', overrides, { overrides: {} });
		expect((await member.req<SavedMessage[]>('GET', `/api/w/${wid}/saved`)).data).toHaveLength(1);
		await owner.req('DELETE', `/api/w/${wid}/messages/${posted.data.id}`);
		expect((await member.req<SavedMessage[]>('GET', `/api/w/${wid}/saved`)).data).toEqual([]);
	});
});

describe('mentions de groupe', () => {
	it('@all ne notifie qu’avec la permission', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const messages = `/api/w/${wid}/channels/${general.id}/messages`;
		await member.req('POST', messages, { body: '@all réunion' });
		const forOwner = await owner.socket(wid);
		expect(((await forOwner.next('hello')) as Hello).mentions[general.id]).toBeUndefined();
		forOwner.ws.close();

		await owner.req('POST', messages, { body: 'Salut @all' });
		const forMember = await member.socket(wid);
		const hello = (await forMember.next('hello')) as Hello;
		expect(hello.mentions[general.id]).toBe(1);
		expect(hello.unread[general.id]).toBe(1);
		forMember.ws.close();
	});

	it('@here vise les membres en ligne', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const online = await member.socket(wid);
		await online.next('hello');
		await owner.req('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: '@here on démarre' });
		await online.next('message');
		const again = await member.socket(wid);
		expect(((await again.next('hello')) as Hello).mentions[general.id]).toBe(1);
		online.ws.close();
		again.ws.close();
	});
});

describe('annonce de salon', () => {
	it('réservée à la gestion des salons et diffusée en direct', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const path = `/api/w/${wid}/channels/${general.id}/announcement`;
		expect((await member.req<Announcement>('GET', path)).data).toMatchObject({ text: '', updatedBy: null });
		expect((await member.req('PUT', path, { text: 'Coucou' })).status).toBe(403);

		const live = await member.socket(wid);
		await live.next('hello');
		expect((await owner.req('PUT', path, { text: '  Maintenance à 18 h  ' })).status).toBe(200);
		expect(await live.next('announcement')).toMatchObject({ channelId: general.id, text: 'Maintenance à 18 h' });
		expect((await member.req<Announcement>('GET', path)).data).toMatchObject({ text: 'Maintenance à 18 h', updatedBy: owner.user.id });
		live.ws.close();

		expect((await owner.req('PUT', path, { text: 'x'.repeat(501) })).status).toBe(400);
		expect((await owner.req('PUT', path, {})).status).toBe(400);
		expect((await owner.req('PUT', `/api/w/${wid}/channels/inconnu/announcement`, { text: 'x' })).status).toBe(404);
		expect((await owner.req('PUT', path, { text: '' })).status).toBe(200);
		expect((await member.req<Announcement>('GET', path)).data.text).toBe('');
	});
});
