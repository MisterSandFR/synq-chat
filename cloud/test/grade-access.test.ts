import { describe, expect, it } from 'vitest';

import type { DirectConversation } from '../shared/dm-threads';
import type { GuestInviteCreated } from '../shared/guests';
import type { NotificationPage } from '../shared/notifications';
import { DEFAULT_GRADE, P } from '../shared/permissions';
import type { Channel, Grade } from '../shared/types';
import { Client, signup, workspaceWithMember } from './helpers';

async function setup() {
	const { owner, member, wid } = await workspaceWithMember();
	const carol = await signup('Carol');
	const code = await owner.req<{ code: string }>('POST', `/api/w/${wid}/invites`);
	expect((await carol.req('POST', `/api/invites/${code.data.code}/accept`)).status).toBe(200);
	const team = await owner.req<Grade>('POST', `/api/w/${wid}/grades`, { name: 'Équipe', color: '#2563eb', permissions: 0 });
	expect(team.status).toBe(201);
	const grant = (client: Client, gradeIds: string[]) => owner.req('PUT', `/api/w/${wid}/members/${client.user.id}/grades`, { gradeIds });
	expect((await grant(member, [team.data.id])).status).toBe(200);
	return { owner, member, carol, wid, team: team.data, grant };
}

describe('accès par grade', () => {
	it('ouvre un groupe aux porteurs du grade, présents et futurs, et le ferme au retrait', async () => {
		const { owner, member, carol, wid, team, grant } = await setup();
		const created = await owner.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [], name: 'Équipe', gradeIds: [team.id] });
		expect(created.status).toBe(200);
		expect(created.data).toMatchObject({ group: true, gradeIds: [team.id], addedIds: [owner.user.id] });
		expect([...created.data.memberIds].sort()).toEqual([owner.user.id, member.user.id].sort());
		const dm = created.data.id;
		const read = (client: Client) => client.req('GET', `/api/w/${wid}/channels/${dm}/messages`);
		const listed = async (client: Client) => (await client.req<DirectConversation[]>('GET', `/api/w/${wid}/dms`)).data.some((d) => d.id === dm);
		const notes = async (client: Client) => (await client.req<NotificationPage>('GET', `/api/w/${wid}/notifications`)).data.items.filter((n) => n.channelId === dm).length;

		expect((await read(member)).status).toBe(200);
		expect(await listed(member)).toBe(true);
		expect((await read(carol)).status).toBe(404);
		expect(await listed(carol)).toBe(false);

		expect((await grant(carol, [team.id])).status).toBe(200);
		expect((await read(carol)).status).toBe(200);
		expect(await listed(carol)).toBe(true);

		expect((await owner.req('POST', `/api/w/${wid}/channels/${dm}/messages`, { body: 'premier' })).status).toBe(200);
		expect(await notes(member)).toBe(1);

		expect((await grant(member, [])).status).toBe(200);
		expect((await read(member)).status).toBe(404);
		expect((await member.req('POST', `/api/w/${wid}/channels/${dm}/messages`, { body: 'x' })).status).toBe(404);
		expect(await listed(member)).toBe(false);
		expect((await owner.req('POST', `/api/w/${wid}/channels/${dm}/messages`, { body: 'second' })).status).toBe(200);
		expect(await notes(member)).toBe(0);
		expect(await notes(carol)).toBe(2);
	});

	it('retire un grade du groupe, garde les ajoutés et refuse les grades inconnus', async () => {
		const { owner, member, carol, wid, team } = await setup();
		expect((await owner.req('POST', `/api/w/${wid}/dms`, { userIds: [carol.user.id], gradeIds: ['inconnu'] })).status).toBe(400);
		const created = await owner.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [carol.user.id], gradeIds: [team.id] });
		expect(created.status).toBe(200);
		const dm = created.data.id;
		expect(created.data.memberIds).toHaveLength(3);
		expect((await owner.req('POST', `/api/w/${wid}/dms/${dm}/grades`, { gradeIds: ['inconnu'] })).status).toBe(400);
		// Porteur du grade : ne se retire pas comme un participant ajouté.
		expect((await member.req('DELETE', `/api/w/${wid}/dms/${dm}/members/${member.user.id}`)).status).toBe(404);

		const removed = await carol.req<DirectConversation>('DELETE', `/api/w/${wid}/dms/${dm}/grades/${team.id}`);
		expect(removed.status).toBe(200);
		expect(removed.data.gradeIds).toEqual([]);
		expect([...removed.data.memberIds].sort()).toEqual([owner.user.id, carol.user.id].sort());
		expect((await member.req('GET', `/api/w/${wid}/channels/${dm}/messages`)).status).toBe(404);

		const everyone = await carol.req<DirectConversation>('POST', `/api/w/${wid}/dms/${dm}/grades`, { gradeIds: [DEFAULT_GRADE] });
		expect(everyone.status).toBe(200);
		expect(everyone.data.memberIds).toHaveLength(3);

		// Un groupe lié à des grades n'est jamais rouvert comme DM.
		const direct = await owner.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [carol.user.id] });
		expect(direct.data.id).not.toBe(dm);
		expect(direct.data.group).toBe(false);
	});

	it('n’ouvre jamais un groupe à un invité par un grade', async () => {
		const { owner: alice, member: bob, wid } = await workspaceWithMember();
		const dm = await alice.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [bob.user.id], name: 'Projet' });
		const invite = await alice.req<GuestInviteCreated>('POST', `/api/w/${wid}/dms/${dm.data.id}/guests`, { email: 'presta@externe.fr' });
		const guest = new Client();
		expect((await guest.req('POST', `/api/guest/${invite.data.link.split('/invite/guest/')[1]}`, { name: 'Gina' })).status).toBe(200);

		const everyone = await alice.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [], name: 'Tous', gradeIds: [DEFAULT_GRADE] });
		expect(everyone.status).toBe(200);
		expect([...everyone.data.memberIds].sort()).toEqual([alice.user.id, bob.user.id].sort());
		expect((await guest.req('GET', `/api/w/${wid}/channels/${everyone.data.id}/messages`)).status).toBe(404);
		expect((await guest.req<DirectConversation[]>('GET', `/api/w/${wid}/dms`)).data.map((d) => d.id)).toEqual([dm.data.id]);
		expect((await guest.req('POST', `/api/w/${wid}/dms/${dm.data.id}/grades`, { gradeIds: [DEFAULT_GRADE] })).status).toBeGreaterThanOrEqual(400);
		expect((await alice.req<DirectConversation>('POST', `/api/w/${wid}/dms/${dm.data.id}/grades`, { gradeIds: [DEFAULT_GRADE] })).data.memberIds).toHaveLength(3);
	});

	it('ouvre un salon privé à un grade', async () => {
		const { owner, member, carol, wid, team } = await setup();
		const channel = await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'projet', kind: 'text' });
		const cid = channel.data.id;
		const overrides = { [DEFAULT_GRADE]: { allow: 0, deny: P.VIEW_CHANNEL }, [team.id]: { allow: P.VIEW_CHANNEL | P.SEND_MESSAGES, deny: 0 } };
		expect((await owner.req('PUT', `/api/w/${wid}/channels/${cid}/overrides`, { overrides })).status).toBe(200);
		expect((await member.req('GET', `/api/w/${wid}/channels/${cid}/messages`)).status).toBe(200);
		expect((await member.req('POST', `/api/w/${wid}/channels/${cid}/messages`, { body: 'ok' })).status).toBe(200);
		expect((await carol.req('GET', `/api/w/${wid}/channels/${cid}/messages`)).status).toBe(404);
		expect((await carol.req<Channel[]>('GET', `/api/w/${wid}/channels`)).data.some((c) => c.id === cid)).toBe(false);
	});
});
