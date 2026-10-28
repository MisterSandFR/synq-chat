import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { MailAssignee, MailboxInfo, MailShareGrade } from '../shared/mail';
import { DEFAULT_MEMBER_PERMS, P } from '../shared/permissions';
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

async function insertThread(boxId: string): Promise<string> {
	const id = crypto.randomUUID();
	await env.DB.prepare("INSERT INTO mail_threads (id, mailbox_id, subject, last_at, created_at) VALUES (?, ?, 'Facture', ?, ?)").bind(id, boxId, Date.now(), Date.now()).run();
	return id;
}

const accessOf = async (client: Client, id: string) => (await client.req<MailboxInfo[]>('GET', '/api/mail/boxes')).data.find((b) => b.id === id)?.access ?? null;

async function setup() {
	const { owner: alice, member: bob, wid } = await workspaceWithMember();
	const carol = await signup('Carol');
	const invite = await alice.req<{ code: string }>('POST', `/api/w/${wid}/invites`);
	expect((await carol.req('POST', `/api/invites/${invite.data.code}/accept`)).status).toBe(200);
	const support = (await alice.req<Grade>('POST', `/api/w/${wid}/grades`, { name: 'Support' })).data;
	const compta = (await alice.req<Grade>('POST', `/api/w/${wid}/grades`, { name: 'Compta' })).data;
	const box = await insertBox(alice.user.id);
	expect((await alice.req('PUT', `/api/mail/boxes/${box}/shares/${wid}`, { channelIds: [] })).status).toBe(200);
	const rules = (grades: MailShareGrade[]) => alice.req<MailboxInfo>('PUT', `/api/mail/boxes/${box}/shares/${wid}/grades`, { grades });
	const give = (client: Client, gradeIds: string[]) => alice.req('PUT', `/api/w/${wid}/members/${client.user.id}/grades`, { gradeIds });
	return { alice, bob, carol, wid, support, compta, box, rules, give };
}

describe('droits des boîtes mail par grade', () => {
	it('niveaux par grade, union des grades, attribution', async () => {
		const { alice, bob, carol, wid, support, compta, box, rules, give } = await setup();
		const thread = await insertThread(box);
		// Partage sans grade : seuls le propriétaire de la boîte et celui de l'espace.
		expect(await accessOf(bob, box)).toBeNull();
		expect((await bob.req('GET', `/api/mail/threads/${thread}`)).status).toBe(404);

		const saved = await rules([
			{ gradeId: support.id, level: 'view' },
			{ gradeId: compta.id, level: 'reply' },
		]);
		expect(saved.status).toBe(200);
		expect(saved.data.shares[0]!.grades).toEqual(expect.arrayContaining([{ gradeId: support.id, level: 'view' }, { gradeId: compta.id, level: 'reply' }]));
		expect(saved.data.shares[0]!.reach).toBe(1);

		await give(bob, [support.id]);
		expect(await accessOf(bob, box)).toEqual({ owner: false, view: true, reply: false, manage: false });
		expect((await bob.req('POST', `/api/mail/threads/${thread}/notes`, { body: 'Note' })).status).toBe(403);
		await give(bob, [support.id, compta.id]);
		expect(await accessOf(bob, box)).toEqual({ owner: false, view: true, reply: true, manage: false });
		expect(await accessOf(carol, box)).toBeNull();

		// Grade par défaut : tous les membres.
		await rules([
			{ gradeId: 'default', level: 'view' },
			{ gradeId: compta.id, level: 'reply' },
		]);
		expect(await accessOf(carol, box)).toEqual({ owner: false, view: true, reply: false, manage: false });
		const info = (await carol.req<MailboxInfo[]>('GET', '/api/mail/boxes')).data.find((b) => b.id === box)!;
		expect(info.shares[0]!.reach).toBe(3);

		// Attribuables : niveau réponse au moins.
		const assignees = await bob.req<MailAssignee[]>('GET', `/api/mail/boxes/${box}/assignees`);
		expect(assignees.data.map((a) => a.name)).toEqual(['Alice', 'Bob']);
		expect((await carol.req('GET', `/api/mail/boxes/${box}/assignees`)).status).toBe(403);
		expect((await alice.req('PATCH', `/api/mail/threads/${thread}`, { assigneeId: carol.user.id })).status).toBe(400);
		expect((await alice.req('PATCH', `/api/mail/threads/${thread}`, { assigneeId: bob.user.id })).status).toBe(200);

		// Gestion : règle le partage ; lecture ou réponse : non.
		expect((await bob.req('PUT', `/api/mail/boxes/${box}/shares/${wid}/grades`, { grades: [] })).status).toBe(403);
		expect((await bob.req('DELETE', `/api/mail/boxes/${box}/shares/${wid}`)).status).toBe(403);
		await rules([
			{ gradeId: 'default', level: 'view' },
			{ gradeId: compta.id, level: 'manage' },
		]);
		expect(await accessOf(bob, box)).toEqual({ owner: false, view: true, reply: true, manage: true });
		expect((await bob.req('PUT', `/api/mail/boxes/${box}/shares/${wid}/grades`, { grades: [{ gradeId: compta.id, level: 'manage' }] })).status).toBe(200);
		expect(await accessOf(carol, box)).toBeNull();

		// Grade administrateur attribué après coup : gestion sans règle sur le partage.
		const admins = (await alice.req<Grade>('POST', `/api/w/${wid}/grades`, { name: 'Admins', permissions: P.ADMINISTRATOR })).data;
		await give(carol, [admins.id]);
		expect(await accessOf(carol, box)).toEqual({ owner: false, view: true, reply: true, manage: true });
		await give(carol, []);
		expect(await accessOf(carol, box)).toBeNull();
	});

	it('retrait du grade ou du grade lui-même : accès perdu', async () => {
		const { alice, bob, wid, support, box, rules, give } = await setup();
		const thread = await insertThread(box);
		await rules([{ gradeId: support.id, level: 'reply' }]);
		await give(bob, [support.id]);
		expect((await bob.req('GET', `/api/mail/threads/${thread}`)).status).toBe(200);
		await give(bob, []);
		expect(await accessOf(bob, box)).toBeNull();
		expect((await bob.req('GET', `/api/mail/threads/${thread}`)).status).toBe(404);

		await give(bob, [support.id]);
		expect(await accessOf(bob, box)).not.toBeNull();
		expect((await alice.req('DELETE', `/api/w/${wid}/grades/${support.id}`)).status).toBe(200);
		expect(await accessOf(bob, box)).toBeNull();
		const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM mailbox_share_grades WHERE mailbox_id = ?').bind(box).first<{ n: number }>();
		expect(left!.n).toBe(0);
	});

	it('invité jamais servi, même par le grade par défaut', async () => {
		const { bob, wid, box, rules } = await setup();
		const thread = await insertThread(box);
		await rules([{ gradeId: 'default', level: 'manage' }]);
		expect(await accessOf(bob, box)).not.toBeNull();
		await env.DB.prepare("UPDATE members SET role = 'guest' WHERE workspace_id = ? AND user_id = ?").bind(wid, bob.user.id).run();
		expect(await accessOf(bob, box)).toBeNull();
		expect((await bob.req('GET', `/api/mail/threads/${thread}`)).status).toBe(404);
		expect((await bob.req('PUT', `/api/mail/boxes/${box}/shares/${wid}/grades`, { grades: [] })).status).toBe(404);
	});

	it('règles validées, partage initial sans grade sauf choix explicite', async () => {
		const { alice, bob, wid, support, box, rules } = await setup();
		expect((await rules([{ gradeId: 'inconnu', level: 'view' }])).status).toBe(400);
		expect((await rules([{ gradeId: support.id, level: 'admin' as never }])).status).toBe(400);
		const other = await alice.req<{ id: string }>('POST', '/api/workspaces', { name: 'Autre' });
		const foreign = (await alice.req<Grade>('POST', `/api/w/${other.data.id}/grades`, { name: 'Ailleurs' })).data;
		expect((await rules([{ gradeId: foreign.id, level: 'view' }])).status).toBe(400);

		const plain = await alice.req<MailboxInfo>('PUT', `/api/mail/boxes/${box}/shares/${other.data.id}`, { channelIds: [] });
		expect(plain.data.shares.find((s) => s.workspaceId === other.data.id)!.grades).toEqual([]);
		const second = await insertBox(alice.user.id);
		const chosen = await alice.req<MailboxInfo>('PUT', `/api/mail/boxes/${second}/shares/${wid}`, { channelIds: [], grades: [{ gradeId: 'default', level: 'reply' }] });
		expect(chosen.data.shares[0]!.grades).toEqual([{ gradeId: 'default', level: 'reply' }]);
		expect(await accessOf(bob, second)).toEqual({ owner: false, view: true, reply: true, manage: false });
		// Mise à jour des salons : règles inchangées.
		await alice.req('PUT', `/api/mail/boxes/${second}/shares/${wid}`, { channelIds: [] });
		expect((await env.DB.prepare('SELECT level FROM mailbox_share_grades WHERE mailbox_id = ?').bind(second).first<{ level: string }>())!.level).toBe('reply');

		// Boîte de Bob : il la partage lui-même, pas dans un espace dont il n'est pas membre.
		const own = await insertBox(bob.user.id);
		expect((await alice.req('PUT', `/api/w/${wid}/mail-sharers`, { subjects: ['default'] })).status).toBe(200);
		expect((await bob.req('PUT', `/api/mail/boxes/${own}/shares/${wid}`, { channelIds: [] })).status).toBe(200);
		expect((await bob.req('PUT', `/api/mail/boxes/${own}/shares/${other.data.id}`, { channelIds: [] })).status).toBe(404);
		// Propriétaire de l'espace : gestion d'office.
		expect(await accessOf(alice, own)).toEqual({ owner: false, view: true, reply: true, manage: true });
	});

	it('migration de reprise des bits de grade', async () => {
		const { alice, wid, support, compta, box } = await setup();
		const reader = (await alice.req<Grade>('POST', `/api/w/${wid}/grades`, { name: 'Lecteur' })).data;
		const other = await alice.req<{ id: string }>('POST', '/api/workspaces', { name: 'Autre' });
		const replyOnly = (await alice.req<Grade>('POST', `/api/w/${other.data.id}/grades`, { name: 'Répondeur' })).data;
		const full = (await alice.req<Grade>('POST', `/api/w/${other.data.id}/grades`, { name: 'Complet' })).data;
		await alice.req('PUT', `/api/mail/boxes/${box}/shares/${other.data.id}`, { channelIds: [] });
		const perms = (workspaceId: string, gradeId: string, permissions: number) =>
			env.DB.prepare('UPDATE grades SET permissions = ? WHERE workspace_id = ? AND id = ?').bind(permissions, workspaceId, gradeId);
		await env.DB.batch([
			perms(wid, 'default', DEFAULT_MEMBER_PERMS | P.MAIL_VIEW),
			perms(wid, support.id, P.MAIL_REPLY),
			perms(wid, compta.id, P.MANAGE_MAIL),
			perms(wid, reader.id, P.VIEW_CHANNEL),
			perms(other.data.id, replyOnly.id, P.MAIL_REPLY),
			perms(other.data.id, full.id, P.MAIL_VIEW | P.MAIL_REPLY),
		]);
		const migration = env.TEST_MIGRATIONS.find((m) => m.name.includes('mail_grades'))!;
		const backfill = migration.queries.find((q) => q.includes('INSERT INTO mailbox_share_grades'))!;
		await env.DB.exec('DELETE FROM mailbox_share_grades');
		await env.DB.prepare(backfill).run();
		const { results } = await env.DB.prepare('SELECT workspace_id, grade_id, level FROM mailbox_share_grades WHERE mailbox_id = ?').bind(box).all<{ workspace_id: string; grade_id: string; level: string }>();
		const got = Object.fromEntries(results.map((r) => [`${r.workspace_id === wid ? 'w' : 'o'}:${r.grade_id}`, r.level]));
		expect(got).toEqual({
			'w:default': 'view',
			[`w:${support.id}`]: 'reply',
			[`w:${compta.id}`]: 'manage',
			'w:admin': 'manage',
			'o:admin': 'manage',
			[`o:${full.id}`]: 'reply',
		});
	});
});
