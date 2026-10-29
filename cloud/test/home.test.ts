import { describe, expect, it } from 'vitest';

import type { DirectConversation } from '../shared/dm-threads';
import type { GuestInviteCreated } from '../shared/guests';
import { invitePath, type SpaceSummary } from '../shared/home';
import { Client, signup, workspaceWithMember } from './helpers';

describe('lien d’invitation saisi sur l’accueil', () => {
	it('accepte un lien complet, un lien d’invité ou un code', () => {
		expect(invitePath('https://app.synq.team/invite/Ab12-cd')).toBe('/invite/Ab12-cd');
		expect(invitePath('  app.synq.team/invite/Ab12cd/ ')).toBe('/invite/Ab12cd');
		expect(invitePath('https://app.synq.team/invite/guest/tok_en?x=1')).toBe('/invite/guest/tok_en');
		expect(invitePath('Ab12cd')).toBe('/invite/Ab12cd');
		expect(invitePath('https://app.synq.team/w/123')).toBeNull();
		expect(invitePath('abc')).toBeNull();
		expect(invitePath('')).toBeNull();
	});
});

describe('résumé d’espace pour l’accueil', () => {
	it('compte membres, conversations non lues et mentions', async () => {
		const { owner, member, wid, general, announcements } = await workspaceWithMember();
		const empty = await member.req<SpaceSummary>('GET', `/api/w/${wid}/summary`);
		expect(empty.status).toBe(200);
		expect(empty.data).toEqual({ members: 2, unread: 0, mentions: 0 });

		expect((await owner.req('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'Bonjour' })).status).toBe(200);
		expect((await owner.req('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: `<@${member.user.id}> tu peux relire ?` })).status).toBe(200);
		expect((await owner.req('POST', `/api/w/${wid}/channels/${announcements.id}/messages`, { body: 'Point lundi' })).status).toBe(200);

		const after = await member.req<SpaceSummary>('GET', `/api/w/${wid}/summary`);
		expect(after.data).toEqual({ members: 2, unread: 2, mentions: 1 });
		// Ses propres messages ne comptent pas.
		expect((await owner.req<SpaceSummary>('GET', `/api/w/${wid}/summary`)).data).toEqual({ members: 2, unread: 0, mentions: 0 });

		expect((await member.req('POST', `/api/w/${wid}/channels/${general.id}/read`)).status).toBe(200);
		expect((await member.req<SpaceSummary>('GET', `/api/w/${wid}/summary`)).data).toEqual({ members: 2, unread: 1, mentions: 0 });
	});

	it('refuse un non-membre', async () => {
		const { wid } = await workspaceWithMember();
		const outsider = await signup('Dora');
		expect((await outsider.req('GET', `/api/w/${wid}/summary`)).status).toBe(404);
		expect((await new Client().req('GET', `/api/w/${wid}/summary`)).status).toBe(401);
	});

	it('masque la taille de l’espace à un invité', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const dm = await owner.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [member.user.id], name: 'Projet' });
		expect(dm.status).toBe(200);
		const created = await owner.req<GuestInviteCreated>('POST', `/api/w/${wid}/dms/${dm.data.id}/guests`, { email: 'presta@externe.fr' });
		expect(created.status).toBe(201);
		const guest = new Client();
		expect((await guest.req('POST', `/api/guest/${created.data.link.split('/invite/guest/')[1]}`, { name: 'Gina' })).status).toBe(200);
		expect((await owner.req('POST', `/api/w/${wid}/channels/${dm.data.id}/messages`, { body: 'Bienvenue' })).status).toBe(200);

		const summary = await guest.req<SpaceSummary>('GET', `/api/w/${wid}/summary`);
		expect(summary.status).toBe(200);
		expect(summary.data).toEqual({ members: null, unread: 1, mentions: 0 });
	});
});
