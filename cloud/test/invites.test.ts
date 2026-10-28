import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { AuditPage } from '../shared/audit';
import type { Invite, InviteJoin, InvitePreview } from '../shared/invites';
import { P } from '../shared/permissions';
import type { Channel, Grade } from '../shared/types';
import { expireTemporaryMembers } from '../worker/invites';
import { signup, workspaceWithMember, type Client } from './helpers';

const HOUR = 3600 * 1000;
const workerEnv = env as unknown as Env;

async function create(client: Client, wid: string, body: Record<string, unknown> = {}) {
	return client.req<Invite & { error?: string }>('POST', `/api/w/${wid}/invites`, body);
}

async function grade(owner: Client, wid: string, name: string, permissions: number) {
	const res = await owner.req<Grade>('POST', `/api/w/${wid}/grades`, { name, permissions });
	expect(res.status).toBe(201);
	return res.data;
}

const expire = (code: string) => env.DB.prepare('UPDATE invites SET expires_at = ? WHERE code = ?').bind(Date.now() - 1000, code).run();

describe('invitations', () => {
	it('garde le lien par défaut de 7 jours et les liens existants', async () => {
		const { owner, wid } = await workspaceWithMember();
		const invite = await owner.req<Invite>('POST', `/api/w/${wid}/invites`);
		expect(invite.status).toBe(201);
		expect(invite.data.expiresAt! - Date.now()).toBeGreaterThan(6 * 24 * HOUR);
		expect(invite.data).toMatchObject({ maxUses: null, uses: 0, temporary: false, state: 'valid' });
		// Ligne au format d'avant la migration : seules les anciennes colonnes.
		await env.DB.prepare('INSERT INTO invites (code, workspace_id, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
			.bind('ancien-lien', wid, owner.user.id, Date.now() + HOUR, Date.now())
			.run();
		const carol = await signup('Carol');
		expect((await carol.req<InvitePreview>('GET', '/api/invites/ancien-lien')).data.state).toBe('valid');
		expect((await carol.req<InviteJoin>('POST', '/api/invites/ancien-lien/accept')).data).toEqual({ workspaceId: wid, channelId: null });
	});

	it('refuse un lien expiré et le signale sur la page', async () => {
		const { owner, wid } = await workspaceWithMember();
		const invite = await create(owner, wid, { expiresIn: 30 * 60 * 1000 });
		expect(invite.status).toBe(201);
		await expire(invite.data.code);
		const carol = await signup('Carol');
		const preview = await carol.req<InvitePreview>('GET', `/api/invites/${invite.data.code}`);
		expect(preview.data).toMatchObject({ state: 'expired', workspaceName: 'Équipe', memberCount: 2, inviterName: 'Alice', member: false });
		const accepted = await carol.req<{ error: string }>('POST', `/api/invites/${invite.data.code}/accept`);
		expect(accepted.status).toBe(404);
		expect(accepted.data.error).toContain('expiré');
		expect((await carol.req('GET', `/api/w/${wid}/info`)).status).toBe(404);
		expect((await carol.req('GET', '/api/invites/inconnu')).status).toBe(404);
	});

	it('valide les options et accepte un lien sans fin', async () => {
		const { owner, wid } = await workspaceWithMember();
		expect((await create(owner, wid, { expiresIn: 1234 })).status).toBe(400);
		expect((await create(owner, wid, { maxUses: 3 })).status).toBe(400);
		expect((await create(owner, wid, { expiresIn: null, temporary: true })).status).toBe(400);
		const forever = await create(owner, wid, { expiresIn: null, label: '  Salon pro  ' });
		expect(forever.data).toMatchObject({ expiresAt: null, label: 'Salon pro', state: 'valid' });
	});

	it('ne laisse passer qu’une acceptation sur le dernier usage', async () => {
		const { owner, wid } = await workspaceWithMember();
		const invite = await create(owner, wid, { maxUses: 1 });
		const [carol, dave] = await Promise.all([signup('Carol'), signup('Dave')]);
		const results = await Promise.all([carol, dave].map((client) => client.req('POST', `/api/invites/${invite.data.code}/accept`)));
		expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
		const list = await owner.req<Invite[]>('GET', `/api/w/${wid}/invites`);
		expect(list.data.find((i) => i.code === invite.data.code)).toMatchObject({ uses: 1, state: 'exhausted' });
		const uses = await env.DB.prepare('SELECT COUNT(*) AS n FROM invite_uses WHERE code = ?').bind(invite.data.code).first<{ n: number }>();
		expect(uses!.n).toBe(1);
		// Un membre déjà présent ne consomme pas d'usage.
		const again = await (results[0]!.status === 200 ? carol : dave).req('POST', `/api/invites/${invite.data.code}/accept`);
		expect(again.status).toBe(404);
	});

	it('attribue les grades sous la hiérarchie du créateur', async () => {
		const { owner, member: bob, wid } = await workspaceWithMember();
		const staff = await grade(owner, wid, 'Staff', P.CREATE_INVITES | P.MANAGE_GRADES);
		const recrue = await grade(owner, wid, 'Recrue', P.SEND_MESSAGES);
		const helper = await grade(owner, wid, 'Aide', P.CREATE_INVITES);
		expect((await owner.req('PUT', `/api/w/${wid}/members/${bob.user.id}/grades`, { gradeIds: [staff.id] })).status).toBe(200);
		// Positions : Aide 1, Recrue 2, Staff 3 ; Bob ne donne que sous Staff.
		expect((await create(bob, wid, { gradeIds: [staff.id] })).status).toBe(403);
		expect((await create(bob, wid, { gradeIds: ['inconnu'] })).status).toBe(400);
		const invite = await create(bob, wid, { gradeIds: [recrue.id, helper.id] });
		expect(invite.status).toBe(201);
		const carol = await signup('Carol');
		expect((await carol.req('POST', `/api/invites/${invite.data.code}/accept`)).status).toBe(200);
		const info = await owner.req<{ members: { id: string; gradeIds: string[] }[] }>('GET', `/api/w/${wid}/info`);
		expect(info.data.members.find((m) => m.id === carol.user.id)!.gradeIds.sort()).toEqual([helper.id, recrue.id].sort());
		// Sans gestion des grades, un lien ne peut pas en attribuer.
		const eve = await signup('Eve');
		const plain = await create(owner, wid);
		await eve.req('POST', `/api/invites/${plain.data.code}/accept`);
		await owner.req('PUT', `/api/w/${wid}/members/${eve.user.id}/grades`, { gradeIds: [helper.id] });
		expect((await create(eve, wid, { gradeIds: [recrue.id] })).status).toBe(403);
	});

	it('ouvre le salon d’arrivée visible', async () => {
		const { owner, wid, general } = await workspaceWithMember();
		const voice = (await owner.req<Channel[]>('GET', `/api/w/${wid}/channels`)).data.find((c) => c.kind === 'voice');
		if (voice) {
			expect((await create(owner, wid, { channelId: voice.id })).status).toBe(400);
		}
		expect((await create(owner, wid, { channelId: 'inconnu' })).status).toBe(400);
		const invite = await create(owner, wid, { channelId: general.id });
		expect(invite.data.channelId).toBe(general.id);
		const carol = await signup('Carol');
		expect((await carol.req<InviteJoin>('POST', `/api/invites/${invite.data.code}/accept`)).data).toEqual({ workspaceId: wid, channelId: general.id });
	});

	it('retire les membres temporaires à l’expiration via le cron', async () => {
		const { owner, member: bob, wid } = await workspaceWithMember();
		const invite = await create(owner, wid, { expiresIn: HOUR, temporary: true });
		const carol = await signup('Carol');
		expect((await carol.req('POST', `/api/invites/${invite.data.code}/accept`)).status).toBe(200);
		await expireTemporaryMembers(workerEnv, Date.now());
		expect((await carol.req('GET', `/api/w/${wid}/info`)).status).toBe(200);
		await expire(invite.data.code);
		expect(await expireTemporaryMembers(workerEnv, Date.now())).toBeGreaterThanOrEqual(1);
		expect((await carol.req('GET', `/api/w/${wid}/info`)).status).toBe(404);
		expect((await bob.req('GET', `/api/w/${wid}/info`)).status).toBe(200);
		// Revenu par un lien permanent : plus retiré.
		const permanent = await create(owner, wid);
		expect((await carol.req('POST', `/api/invites/${permanent.data.code}/accept`)).status).toBe(200);
		await expireTemporaryMembers(workerEnv, Date.now());
		expect((await carol.req('GET', `/api/w/${wid}/info`)).status).toBe(200);
	});

	it('révoque : son lien, ou ceux des autres avec la gestion de l’espace', async () => {
		const { owner, member: bob, wid } = await workspaceWithMember();
		const inviter = await grade(owner, wid, 'Inviteur', P.CREATE_INVITES);
		await owner.req('PUT', `/api/w/${wid}/members/${bob.user.id}/grades`, { gradeIds: [inviter.id] });
		const mine = await create(bob, wid);
		const alices = await create(owner, wid);
		expect((await bob.req('DELETE', `/api/w/${wid}/invites/${alices.data.code}`)).status).toBe(403);
		expect((await bob.req('DELETE', `/api/w/${wid}/invites/${mine.data.code}`)).status).toBe(200);
		const other = await create(bob, wid);
		expect((await owner.req('DELETE', `/api/w/${wid}/invites/${other.data.code}`)).status).toBe(200);
		const carol = await signup('Carol');
		expect((await carol.req<InvitePreview>('GET', `/api/invites/${mine.data.code}`)).data.state).toBe('revoked');
		const refused = await carol.req<{ error: string }>('POST', `/api/invites/${mine.data.code}/accept`);
		expect(refused.status).toBe(404);
		expect(refused.data.error).toContain('révoqué');
		expect((await owner.req('DELETE', `/api/w/${wid}/invites/inconnu`)).status).toBe(404);
	});

	it('journalise création, révocation et adhésion', async () => {
		const { owner, wid } = await workspaceWithMember();
		const invite = await create(owner, wid, { label: 'Rentrée' });
		const carol = await signup('Carol');
		await carol.req('POST', `/api/invites/${invite.data.code}/accept`);
		await owner.req('DELETE', `/api/w/${wid}/invites/${invite.data.code}`);
		const audit = await owner.req<AuditPage>('GET', `/api/w/${wid}/audit?kind=invite`);
		const actions = audit.data.items.map((e) => e.action);
		expect(actions).toEqual(expect.arrayContaining(['invite.create', 'invite.revoke', 'invite.join']));
		expect(audit.data.items.find((e) => e.action === 'invite.join')).toMatchObject({ actorId: carol.user.id, targetId: invite.data.code, targetName: 'Rentrée' });
	});
});
