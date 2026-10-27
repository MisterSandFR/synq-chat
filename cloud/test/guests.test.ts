import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { DirectConversation } from '../shared/dm-threads';
import type { GuestInviteCreated, GuestInviteList, GuestLanding } from '../shared/guests';
import type { Attachment, Channel, Me, Message, ServerEvent, WorkspaceDetail } from '../shared/types';
import { Client, signup, workspaceWithMember } from './helpers';

const tokenOf = (link: string) => link.split('/invite/guest/')[1]!;

async function setup() {
	const { owner: alice, member: bob, wid, general } = await workspaceWithMember();
	const carol = await signup('Carol');
	const code = await alice.req<{ code: string }>('POST', `/api/w/${wid}/invites`);
	expect((await carol.req('POST', `/api/invites/${code.data.code}/accept`)).status).toBe(200);
	const dm = await alice.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [bob.user.id], name: 'Projet' });
	expect(dm.status).toBe(200);
	const created = await alice.req<GuestInviteCreated>('POST', `/api/w/${wid}/dms/${dm.data.id}/guests`, { email: 'Presta@Externe.fr' });
	expect(created.status).toBe(201);
	expect(created.data.invite.email).toBe('presta@externe.fr');
	expect(created.data.emailed).toBe(false);
	const token = tokenOf(created.data.link);
	const guest = new Client();
	const joined = await guest.req<{ workspaceId: string; channelId: string }>('POST', `/api/guest/${token}`, { name: 'Gina' });
	expect(joined.status).toBe(200);
	expect(joined.data).toEqual({ workspaceId: wid, channelId: dm.data.id });
	const me = await guest.req<Me>('GET', '/api/me');
	guest.user = me.data.user;
	return { alice, bob, carol, guest, wid, general, dm: dm.data, token, inviteId: created.data.invite.id, me: me.data };
}

describe('invités externes', () => {
	it('lien magique : page publique, nom requis, réutilisation sans doublon', async () => {
		const { alice, wid, dm } = await setup();
		const created = await alice.req<GuestInviteCreated>('POST', `/api/w/${wid}/dms/${dm.id}/guests`, { email: 'autre@externe.fr' });
		const token = tokenOf(created.data.link);
		const anonymous = new Client();
		const landing = await anonymous.req<GuestLanding>('GET', `/api/guest/${token}`);
		expect(landing.status).toBe(200);
		expect(landing.data).toMatchObject({ conversationName: 'Projet', inviterName: 'Alice', email: 'autre@externe.fr', joined: false });
		expect((await anonymous.req('POST', `/api/guest/${token}`, { name: '  ' })).status).toBe(400);
		expect((await anonymous.req('POST', `/api/guest/${token}`, { name: 'Hugo' })).status).toBe(200);
		const first = (await anonymous.req<Me>('GET', '/api/me')).data;
		expect(first.guest).toBe(true);
		const other = new Client();
		expect((await other.req('POST', `/api/guest/${token}`, { name: 'Usurpateur' })).status).toBe(200);
		const again = (await other.req<Me>('GET', '/api/me')).data;
		expect(again.user.id).toBe(first.user.id);
		expect(again.user.name).toBe('Hugo');
		expect((await anonymous.req('GET', '/api/guest/pas-un-jeton-valide-du-tout')).status).toBe(404);
	});

	it('invitation : groupe seulement, participant seulement, email valide', async () => {
		const { alice, bob, carol, wid, dm } = await setup();
		const direct = await alice.req<DirectConversation>('POST', `/api/w/${wid}/dms`, { userIds: [carol.user.id] });
		expect((await alice.req('POST', `/api/w/${wid}/dms/${direct.data.id}/guests`, { email: 'x@y.fr' })).status).toBe(404);
		expect((await carol.req('POST', `/api/w/${wid}/dms/${dm.id}/guests`, { email: 'x@y.fr' })).status).toBe(404);
		expect((await carol.req('GET', `/api/w/${wid}/dms/${dm.id}/guests`)).status).toBe(404);
		expect((await bob.req('POST', `/api/w/${wid}/dms/${dm.id}/guests`, { email: 'pas-un-email' })).status).toBe(400);
		const list = await bob.req<GuestInviteList>('GET', `/api/w/${wid}/dms/${dm.id}/guests`);
		expect(list.status).toBe(200);
		expect(list.data.canEmail).toBe(false);
		expect(list.data.invites.map((i) => i.status)).toEqual(['joined']);
	});

	it('révocation et expiration bloquent le lien', async () => {
		const { alice, bob, wid, dm } = await setup();
		const revoked = await alice.req<GuestInviteCreated>('POST', `/api/w/${wid}/dms/${dm.id}/guests`, { email: 'r@externe.fr' });
		expect((await bob.req('DELETE', `/api/w/${wid}/dms/${dm.id}/guests/${revoked.data.invite.id}`)).status).toBe(200);
		const anonymous = new Client();
		expect((await anonymous.req('GET', `/api/guest/${tokenOf(revoked.data.link)}`)).status).toBe(404);
		expect((await anonymous.req('POST', `/api/guest/${tokenOf(revoked.data.link)}`, { name: 'R' })).status).toBe(404);
		const expired = await alice.req<GuestInviteCreated>('POST', `/api/w/${wid}/dms/${dm.id}/guests`, { email: 'e@externe.fr' });
		await env.DB.prepare('UPDATE guest_invites SET expires_at = 1 WHERE id = ?').bind(expired.data.invite.id).run();
		expect((await anonymous.req('POST', `/api/guest/${tokenOf(expired.data.link)}`, { name: 'E' })).status).toBe(404);
	});

	it('compte invité : ni mot de passe, ni espace, ni calendrier, ni mail', async () => {
		const { guest, wid, me } = await setup();
		expect(me.guest).toBe(true);
		expect(me.workspaces.map((w) => w.id)).toEqual([wid]);
		expect((await guest.req('POST', '/api/auth/login', { email: me.user.email, password: '' })).status).toBe(401);
		for (const [method, path] of [
			['POST', '/api/workspaces'],
			['POST', '/api/invites/abc/accept'],
			['GET', '/api/invites/abc'],
			['GET', '/api/calendar/events'],
			['GET', '/api/calendar/people'],
			['GET', '/api/calendar/feed'],
			['GET', '/api/mail/boxes'],
			['GET', '/api/mail/threads'],
			['DELETE', '/api/me/identities/recube'],
		] as const) {
			expect([method, path, (await guest.req(method, path, method === 'GET' ? undefined : {})).status]).toEqual([method, path, 403]);
		}
		expect((await guest.req('GET', '/api/me/profile')).status).toBe(200);
	});

	it('chaque famille de routes d’espace hors liste blanche est refusée', async () => {
		const { guest, bob, carol, wid, general, dm } = await setup();
		const msg = await bob.req<Message>('POST', `/api/w/${wid}/channels/${general.id}/messages`, { body: 'interne' });
		const base = `/api/w/${wid}`;
		for (const [method, path] of [
			['GET', '/categories'],
			['POST', '/categories'],
			['PATCH', '/categories/x'],
			['GET', '/categories/x/overrides'],
			['PUT', '/layout'],
			['GET', '/commands'],
			['GET', '/commands/config'],
			['POST', '/commands'],
			['POST', `/channels/${dm.id}/commands`],
			['GET', '/grades'],
			['POST', '/grades'],
			['PUT', '/grades/order'],
			['PUT', `/members/${guest.user.id}/grades`],
			['DELETE', `/members/${carol.user.id}`],
			['POST', '/invites'],
			['PATCH', '/info'],
			['DELETE', '/info'],
			['POST', '/channels'],
			['PATCH', `/channels/${general.id}`],
			['DELETE', `/channels/${general.id}`],
			['GET', `/channels/${general.id}/overrides`],
			['POST', `/channels/${general.id}/sync`],
			['PUT', `/channels/${general.id}/announcement`],
			['GET', `/channels/${dm.id}/drive`],
			['POST', `/channels/${dm.id}/drive/folders`],
			['POST', `/channels/${dm.id}/drive/files`],
			['PATCH', '/drive/folders/x'],
			['DELETE', '/drive/files/x'],
			['GET', '/profiles'],
			['GET', '/saved'],
			['PUT', `/messages/${msg.data.id}/saved`],
			['PUT', `/messages/${msg.data.id}/pin`],
			['POST', '/voice/move'],
			['POST', '/voice/moderate'],
			['POST', '/dms'],
			['POST', `/dms/${dm.id}/members`],
			['DELETE', `/dms/${dm.id}/members/${bob.user.id}`],
			['GET', `/dms/${dm.id}/guests`],
			['POST', `/dms/${dm.id}/guests`],
			['DELETE', `/dms/${dm.id}/guests/x`],
			['GET', '/info/'],
			['GET', '/inconnue'],
		] as const) {
			expect([method, path, (await guest.req(method, base + path, method === 'GET' ? undefined : {})).status]).toEqual([method, path, 403]);
		}
	});

	it('routes autorisées filtrées : infos, salons, messages, recherche, fils', async () => {
		const { alice, bob, guest, wid, general, dm } = await setup();
		const base = `/api/w/${wid}`;
		const info = await guest.req<WorkspaceDetail>('GET', `${base}/info`);
		expect(info.status).toBe(200);
		expect(info.data.guest).toBe(true);
		expect(info.data.perms).toBe(0);
		expect(info.data.grades).toEqual([]);
		expect(info.data.members.map((m) => m.id).sort()).toEqual([alice.user.id, bob.user.id, guest.user.id].sort());
		expect(info.data.members.find((m) => m.id === guest.user.id)?.guest).toBe(true);
		expect(info.data.members.every((m) => m.gradeIds.length === 0)).toBe(true);
		const seen = await bob.req<WorkspaceDetail>('GET', `${base}/info`);
		expect(seen.data.members.length).toBe(4);
		expect(seen.data.members.find((m) => m.id === guest.user.id)?.guest).toBe(true);

		const channels = await guest.req<Channel[]>('GET', `${base}/channels`);
		expect(channels.data.map((c) => c.id)).toEqual([dm.id]);
		expect((await guest.req<DirectConversation[]>('GET', `${base}/dms`)).data.map((d) => d.id)).toEqual([dm.id]);

		const secret = await alice.req<Message>('POST', `${base}/channels/${general.id}/messages`, { body: 'confidentiel salon' });
		const shared = await alice.req<Message>('POST', `${base}/channels/${dm.id}/messages`, { body: 'confidentiel groupe' });
		for (const [method, path] of [
			['GET', `/channels/${general.id}/messages`],
			['POST', `/channels/${general.id}/messages`],
			['GET', `/channels/${general.id}/pins`],
			['GET', `/channels/${general.id}/announcement`],
			['PATCH', `/messages/${secret.data.id}`],
			['DELETE', `/messages/${secret.data.id}`],
			['PUT', `/messages/${secret.data.id}/reactions/%F0%9F%91%8D`],
			['GET', `/messages/${secret.data.id}/thread`],
			['POST', `/messages/${secret.data.id}/thread`],
			['PUT', `/messages/${secret.data.id}/follow`],
		] as const) {
			const status = (await guest.req(method, base + path, method === 'GET' ? undefined : { body: 'x', following: true })).status;
			expect([method, path, status >= 400 && status < 500]).toEqual([method, path, true]);
		}
		expect((await guest.req<Message[]>('GET', `${base}/channels/${dm.id}/messages`)).status).toBe(200);
		expect((await guest.req<Message>('POST', `${base}/channels/${dm.id}/messages`, { body: 'bonjour' })).status).toBe(200);
		const hits = await guest.req<Array<{ message: Message }>>('GET', `${base}/search?q=confidentiel`);
		expect(hits.data.map((h) => h.message.id)).toEqual([shared.data.id]);
		expect((await guest.req('GET', `${base}/threads`)).status).toBe(200);
	});

	it('fichiers : seulement ceux de ses groupes', async () => {
		const { alice, guest, wid, general, dm } = await setup();
		const base = `/api/w/${wid}`;
		const upload = async () =>
			(await alice.req<Attachment>('POST', `${base}/files`, new TextEncoder().encode('contenu').buffer as ArrayBuffer, { 'content-type': 'text/plain', 'x-file-name': 'note.txt' })).data;
		const hidden = await upload();
		const visible = await upload();
		await alice.req('POST', `${base}/channels/${general.id}/messages`, { body: '', attachmentKeys: [hidden.key] });
		await alice.req('POST', `${base}/channels/${dm.id}/messages`, { body: '', attachmentKeys: [visible.key] });
		expect((await guest.req('GET', `${base}/files/${hidden.key.split('/').pop()}`)).status).toBe(404);
		expect((await guest.req('GET', `${base}/files/${visible.key.split('/').pop()}`)).status).toBe(200);
	});

	it('membres : pas de grade, pas d’ajout hors lien', async () => {
		const { alice, guest, wid } = await setup();
		expect((await alice.req('PUT', `/api/w/${wid}/members/${guest.user.id}/grades`, { gradeIds: ['admin'] })).status).toBe(400);
		expect((await alice.req('POST', `/api/w/${wid}/dms`, { userIds: [guest.user.id] })).status).toBe(400);
		const people = await alice.req<Array<{ id: string }>>('GET', `/api/calendar/people?workspace=${wid}`);
		expect(people.data.some?.((p) => p.id === guest.user.id) ?? false).toBe(false);
	});

	it('temps réel : salons, messages et présence filtrés', async () => {
		const { alice, bob, carol, guest, wid, general, dm } = await setup();
		const base = `/api/w/${wid}`;
		const voiceRoom = (await alice.req<Channel[]>('GET', `${base}/channels`)).data.find((c) => c.kind === 'voice')!;
		const sock = await guest.socket(wid);
		const hello = (await sock.next('hello')) as Extract<ServerEvent, { t: 'hello' }>;
		expect(hello.channels.map((c) => c.id)).toEqual([dm.id]);
		expect(Object.keys(hello.perms)).toEqual([dm.id]);
		expect((await guest.req('POST', `${base}/voice/join`, { connId: hello.connId, channelId: voiceRoom.id })).status).toBeGreaterThanOrEqual(400);

		const carolSock = await carol.socket(wid);
		const bobSock = await bob.socket(wid);
		const presence = (await sock.next('presence')) as Extract<ServerEvent, { t: 'presence' }>;
		expect(presence.userId).toBe(bob.user.id);

		await alice.req('POST', `${base}/channels`, { name: 'secret', kind: 'text' });
		await alice.req('POST', `${base}/channels/${general.id}/messages`, { body: 'hors groupe' });
		await alice.req('POST', `${base}/channels/${dm.id}/messages`, { body: 'dans le groupe' });
		const message = (await sock.next('message')) as Extract<ServerEvent, { t: 'message' }>;
		expect(message.message.channelId).toBe(dm.id);
		await expect(sock.next('channel_upsert')).rejects.toThrow();
		sock.ws.close();
		carolSock.ws.close();
		bobSock.ws.close();
	});

	it('retrait par un participant : lien mort, espace et session perdus', async () => {
		const { bob, guest, wid, dm, token } = await setup();
		expect((await guest.req('DELETE', `/api/w/${wid}/dms/${dm.id}/members/${bob.user.id}`)).status).toBe(403);
		expect((await bob.req('DELETE', `/api/w/${wid}/dms/${dm.id}/members/${guest.user.id}`)).status).toBe(200);
		expect((await guest.req('GET', `/api/w/${wid}/info`)).status).toBe(401);
		const again = new Client();
		expect((await again.req('POST', `/api/guest/${token}`, { name: 'Gina' })).status).toBe(404);
		const list = await bob.req<GuestInviteList>('GET', `/api/w/${wid}/dms/${dm.id}/guests`);
		expect(list.data.invites[0]?.status).toBe('revoked');
	});

	it('un invité peut quitter le groupe lui-même', async () => {
		const { guest, wid, dm } = await setup();
		expect((await guest.req('DELETE', `/api/w/${wid}/dms/${dm.id}/members/${guest.user.id}`)).status).toBe(200);
		expect((await guest.req('GET', `/api/w/${wid}/info`)).status).toBe(401);
	});
});
