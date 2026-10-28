import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { AuditPage } from '../shared/audit';
import type { MailboxInfo, MailShareSpaces, MailSharers, WorkspaceMailbox } from '../shared/mail';
import { ADMIN_GRADE } from '../shared/permissions';
import type { Grade } from '../shared/types';
import { signup, workspaceWithMember, type Client } from './helpers';

async function insertBox(ownerId: string): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare(
		"INSERT INTO mailboxes (id, owner_id, name, address, imap_host, smtp_host, username, secret, created_at) VALUES (?, ?, 'Support', 'support@exemple.fr', 'mail.exemple.fr', 'mail.exemple.fr', 'support', 'x', ?)",
	)
		.bind(id, ownerId, Date.now())
		.run();
	return id;
}

async function setup() {
	const { owner: alice, member: bob, wid } = await workspaceWithMember();
	const join = async (name: string) => {
		const client = await signup(name);
		const invite = await alice.req<{ code: string }>('POST', `/api/w/${wid}/invites`);
		expect((await client.req('POST', `/api/invites/${invite.data.code}/accept`)).status).toBe(200);
		return client;
	};
	const carol = await join('Carol');
	const dan = await join('Dan');
	const support = (await alice.req<Grade>('POST', `/api/w/${wid}/grades`, { name: 'Support' })).data;
	const give = (client: Client, gradeIds: string[]) => alice.req('PUT', `/api/w/${wid}/members/${client.user.id}/grades`, { gradeIds });
	const share = (client: Client, box: string) => client.req<MailboxInfo & { error?: string }>('PUT', `/api/mail/boxes/${box}/shares/${wid}`, { channelIds: [] });
	const sharers = (subjects: string[]) => alice.req<MailSharers>('PUT', `/api/w/${wid}/mail-sharers`, { subjects });
	const spaces = async (client: Client) => (await client.req<MailShareSpaces>('GET', '/api/mail/share-spaces')).data.workspaceIds;
	return { alice, bob, carol, dan, wid, support, give, share, sharers, spaces };
}

describe('qui peut partager une boîte dans un espace', () => {
	it('membre listé, grade listé, grade par défaut, partages existants intacts', async () => {
		const { alice, bob, carol, dan, wid, support, give, share, sharers, spaces } = await setup();
		const bobBox = await insertBox(bob.user.id);
		const refused = await share(bob, bobBox);
		expect(refused.status).toBe(403);
		expect(refused.data.error).toBe('Partage réservé dans cet espace');
		expect(await spaces(bob)).not.toContain(wid);
		expect(await spaces(alice)).toContain(wid);

		expect((await sharers([`@${bob.user.id}`])).data.subjects).toEqual([`@${bob.user.id}`]);
		expect(await spaces(bob)).toContain(wid);
		expect((await share(bob, bobBox)).status).toBe(200);

		const carolBox = await insertBox(carol.user.id);
		expect((await share(carol, carolBox)).status).toBe(403);
		await give(carol, [support.id]);
		expect((await sharers([support.id])).status).toBe(200);
		expect((await share(carol, carolBox)).status).toBe(200);
		// Bob retiré de la liste : son partage reste, il le modifie encore.
		expect((await share(bob, bobBox)).status).toBe(200);
		expect((await alice.req<MailSharers>('GET', `/api/w/${wid}/mail-sharers`)).data.subjects).toEqual([support.id]);

		const danBox = await insertBox(dan.user.id);
		expect((await share(dan, danBox)).status).toBe(403);
		await sharers(['default']);
		expect((await share(dan, danBox)).status).toBe(200);

		const boxes = (await alice.req<WorkspaceMailbox[]>('GET', `/api/w/${wid}/mail-boxes`)).data;
		expect(boxes.map((box) => box.id).sort()).toEqual([bobBox, carolBox, danBox].sort());
	});

	it('administrateur toujours autorisé, invité jamais, réglages réservés', async () => {
		const { alice, bob, wid, give, share, sharers, spaces } = await setup();
		await give(bob, [ADMIN_GRADE]);
		expect((await share(bob, await insertBox(bob.user.id))).status).toBe(200);

		const guest = await signup('Gina');
		await env.DB.prepare("INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'guest', ?)").bind(wid, guest.user.id, Date.now()).run();
		expect((await sharers([`@${guest.user.id}`])).status).toBe(400);
		await sharers(['default']);
		expect(await spaces(guest)).not.toContain(wid);
		expect((await share(guest, await insertBox(guest.user.id))).status).not.toBe(200);

		expect((await sharers(['inconnu'])).status).toBe(400);
		const carol = await signup('Carla');
		expect((await carol.req('GET', `/api/w/${wid}/mail-sharers`)).status).toBe(404);
		await give(bob, []);
		expect((await bob.req('GET', `/api/w/${wid}/mail-sharers`)).status).toBe(403);
		expect((await bob.req('PUT', `/api/w/${wid}/mail-sharers`, { subjects: [] })).status).toBe(403);
		expect((await bob.req('GET', `/api/w/${wid}/mail-boxes`)).status).toBe(403);
		expect((await alice.req('GET', `/api/w/${wid}/mail-sharers`)).status).toBe(200);
	});

	it('retrait d’un partage par l’administrateur de l’espace', async () => {
		const { alice, bob, carol, wid, share, sharers } = await setup();
		await sharers([`@${bob.user.id}`]);
		const box = await insertBox(bob.user.id);
		expect((await share(bob, box)).status).toBe(200);
		expect((await bob.req('PUT', `/api/mail/boxes/${box}/shares/${wid}/grades`, { grades: [{ gradeId: 'default', level: 'view' }] })).status).toBe(200);
		const listed = (await alice.req<WorkspaceMailbox[]>('GET', `/api/w/${wid}/mail-boxes`)).data;
		expect(listed).toEqual([{ id: box, name: 'Support', address: 'support@exemple.fr', ownerId: bob.user.id, ownerName: 'Bob', reach: 4 }]);
		expect((await carol.req<MailboxInfo[]>('GET', '/api/mail/boxes')).data.some((b) => b.id === box)).toBe(true);

		expect((await bob.req('DELETE', `/api/w/${wid}/mail-boxes/${box}`)).status).toBe(403);
		expect((await alice.req('DELETE', `/api/w/${wid}/mail-boxes/${box}`)).status).toBe(200);
		expect((await alice.req('DELETE', `/api/w/${wid}/mail-boxes/${box}`)).status).toBe(404);
		expect((await alice.req<WorkspaceMailbox[]>('GET', `/api/w/${wid}/mail-boxes`)).data).toEqual([]);
		expect((await carol.req<MailboxInfo[]>('GET', '/api/mail/boxes')).data.some((b) => b.id === box)).toBe(false);
		const rules = await env.DB.prepare('SELECT COUNT(*) AS n FROM mailbox_share_grades WHERE mailbox_id = ?').bind(box).first<{ n: number }>();
		expect(rules?.n).toBe(0);

		const audit = (await alice.req<AuditPage>('GET', `/api/w/${wid}/audit?kind=mail`)).data.items;
		expect(audit.map((entry) => entry.action)).toEqual(['mail.unshare', 'mail.sharers']);
		expect(audit[0]).toMatchObject({ targetId: box, targetName: 'Support' });
	});
});
