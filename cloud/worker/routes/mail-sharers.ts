import { Hono } from 'hono';

import { memberKey } from '../../shared/categories';
import { MAIL_LIMITS, type MailSharers, type WorkspaceMailbox } from '../../shared/mail';
import { P } from '../../shared/permissions';
import { listGrades } from '../grades';
import { denyUnless, fail, readJson, type AppEnv } from '../http';
import { listSharers } from '../mail/sharers';
import { SHARE_MEMBERS, SHARE_RANK } from './mail';

export const mailSharerRoutes = new Hono<AppEnv>();

mailSharerRoutes.get('/w/:wid/mail-sharers', async (c) => {
	const denied = denyUnless(c, P.MANAGE_WORKSPACE);
	if (denied) {
		return denied;
	}
	return c.json<MailSharers>({ subjects: await listSharers(c.env.DB, c.get('workspaceId')) });
});

mailSharerRoutes.put('/w/:wid/mail-sharers', async (c) => {
	const denied = denyUnless(c, P.MANAGE_WORKSPACE);
	if (denied) {
		return denied;
	}
	const workspaceId = c.get('workspaceId');
	const { subjects } = await readJson<MailSharers>(c);
	if (!Array.isArray(subjects) || subjects.length > MAIL_LIMITS.sharers) {
		return fail(c, 400, 'Liste invalide');
	}
	const [grades, members] = await Promise.all([
		listGrades(c.env.DB, workspaceId),
		c.env.DB.prepare("SELECT user_id FROM members WHERE workspace_id = ? AND role != 'guest'").bind(workspaceId).all<{ user_id: string }>(),
	]);
	const known = new Set([...grades.map((grade) => grade.id), ...members.results.map((member) => memberKey(member.user_id))]);
	const picked = [...new Set(subjects)];
	if (picked.some((subject) => typeof subject !== 'string' || !known.has(subject))) {
		return fail(c, 400, 'Grade ou membre inconnu');
	}
	await c.env.DB.batch([
		c.env.DB.prepare('DELETE FROM mail_sharers WHERE workspace_id = ?').bind(workspaceId),
		...picked.map((subject) => c.env.DB.prepare('INSERT INTO mail_sharers (workspace_id, subject_id) VALUES (?, ?)').bind(workspaceId, subject)),
	]);
	return c.json<MailSharers>({ subjects: await listSharers(c.env.DB, workspaceId) });
});

mailSharerRoutes.get('/w/:wid/mail-boxes', async (c) => {
	const denied = denyUnless(c, P.MANAGE_WORKSPACE);
	if (denied) {
		return denied;
	}
	const { results } = await c.env.DB.prepare(
		`SELECT b.id, b.name, b.address, b.owner_id, u.name AS owner_name,
			(SELECT COUNT(*) FROM ${SHARE_MEMBERS} WHERE s.mailbox_id = sh.mailbox_id AND s.workspace_id = sh.workspace_id AND (m.user_id = b.owner_id OR (${SHARE_RANK}) > 0)) AS reach
		FROM mailbox_shares sh JOIN mailboxes b ON b.id = sh.mailbox_id JOIN users u ON u.id = b.owner_id
		WHERE sh.workspace_id = ? ORDER BY b.name COLLATE NOCASE`,
	)
		.bind(c.get('workspaceId'))
		.all<{ id: string; name: string; address: string; owner_id: string; owner_name: string; reach: number }>();
	return c.json<WorkspaceMailbox[]>(results.map((row) => ({ id: row.id, name: row.name, address: row.address, ownerId: row.owner_id, ownerName: row.owner_name, reach: row.reach })));
});

mailSharerRoutes.delete('/w/:wid/mail-boxes/:boxId', async (c) => {
	const denied = denyUnless(c, P.MANAGE_WORKSPACE);
	if (denied) {
		return denied;
	}
	const workspaceId = c.get('workspaceId');
	const boxId = c.req.param('boxId');
	const box = await c.env.DB.prepare('SELECT b.name FROM mailbox_shares s JOIN mailboxes b ON b.id = s.mailbox_id WHERE s.mailbox_id = ? AND s.workspace_id = ?')
		.bind(boxId, workspaceId)
		.first<{ name: string }>();
	if (!box) {
		return fail(c, 404, 'Partage introuvable');
	}
	await c.env.DB.prepare('DELETE FROM mailbox_shares WHERE mailbox_id = ? AND workspace_id = ?').bind(boxId, workspaceId).run();
	// Nom renvoyé pour le journal d'audit.
	return c.json({ ok: true, name: box.name });
});
