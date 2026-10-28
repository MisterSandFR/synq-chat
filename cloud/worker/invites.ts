import { inviteState, type Invite, type InviteJoin, type InvitePreview, type InviteState } from '../shared/invites';
import { DEFAULT_GRADE, P, has } from '../shared/permissions';
import type { User } from '../shared/types';
import { listGrades, loadActor, loadActors } from './grades';
import { workspaceStub } from './http';
import { err, ok, type Result } from './result';
import { logoUrl } from './routes/workspace-logo';

export type InviteRow = {
	code: string;
	workspace_id: string;
	created_by: string;
	expires_at: number | null;
	created_at: number;
	max_uses: number | null;
	uses: number;
	channel_id: string | null;
	grade_ids: string;
	temporary: number;
	label: string;
	revoked_at: number | null;
};

const REFUSED: Record<Exclude<InviteState, 'valid'>, string> = {
	expired: 'Ce lien d’invitation a expiré',
	revoked: 'Ce lien d’invitation a été révoqué',
	exhausted: 'Ce lien d’invitation a atteint son nombre maximal d’utilisations',
};

function parseIds(raw: string): string[] {
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

export const toInvite = (row: InviteRow, creatorName: string, now: number): Invite => ({
	code: row.code,
	createdBy: row.created_by,
	creatorName,
	createdAt: row.created_at,
	expiresAt: row.expires_at,
	maxUses: row.max_uses,
	uses: row.uses,
	channelId: row.channel_id,
	gradeIds: parseIds(row.grade_ids),
	temporary: row.temporary === 1,
	label: row.label,
	revokedAt: row.revoked_at,
	state: inviteState(row, now),
});

export async function listInvites(db: D1Database, workspaceId: string, now: number): Promise<Invite[]> {
	const { results } = await db
		.prepare("SELECT i.*, COALESCE(u.name, '') AS creator_name FROM invites i LEFT JOIN users u ON u.id = i.created_by WHERE i.workspace_id = ? ORDER BY i.created_at DESC LIMIT 200")
		.bind(workspaceId)
		.all<InviteRow & { creator_name: string }>();
	return results.map((row) => toInvite(row, row.creator_name, now));
}

export async function invitePreview(db: D1Database, code: string, userId: string, now: number): Promise<Result<InvitePreview>> {
	const row = await db
		.prepare(
			`SELECT i.*, w.name AS workspace_name, w.accent, w.logo_key, COALESCE(u.name, '') AS inviter_name,
				(SELECT COUNT(*) FROM members m WHERE m.workspace_id = i.workspace_id AND m.role != 'guest') AS member_count,
				EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = i.workspace_id AND m.user_id = ?) AS member
			FROM invites i JOIN workspaces w ON w.id = i.workspace_id LEFT JOIN users u ON u.id = i.created_by WHERE i.code = ?`,
		)
		.bind(userId, code)
		.first<InviteRow & { workspace_name: string; accent: string; logo_key: string | null; inviter_name: string; member_count: number; member: number }>();
	if (!row) {
		return err(404, 'Invitation invalide');
	}
	return ok({
		workspaceId: row.workspace_id,
		workspaceName: row.workspace_name,
		accent: row.accent,
		logoUrl: logoUrl(row.workspace_id, row.logo_key),
		memberCount: row.member_count,
		inviterName: row.inviter_name,
		expiresAt: row.expires_at,
		state: inviteState(row, now),
		member: row.member === 1,
	});
}

// Hiérarchie relue à l'adhésion : un créateur rétrogradé ne transmet plus ses anciens grades.
async function grantedGrades(db: D1Database, row: InviteRow): Promise<string[]> {
	const wanted = parseIds(row.grade_ids);
	if (!wanted.length) {
		return [];
	}
	const [creator, grades] = await Promise.all([loadActor(db, row.workspace_id, row.created_by), listGrades(db, row.workspace_id)]);
	if (!creator || creator.guest) {
		return [];
	}
	return grades
		.filter((g) => g.id !== DEFAULT_GRADE && wanted.includes(g.id) && (creator.owner || (has(creator.perms, P.MANAGE_GRADES) && g.position < creator.top)))
		.map((g) => g.id);
}

async function landing(env: Env, row: InviteRow, userId: string): Promise<InviteJoin> {
	if (!row.channel_id) {
		return { workspaceId: row.workspace_id, channelId: null };
	}
	const actor = await loadActor(env.DB, row.workspace_id, userId);
	const visible = actor ? (await workspaceStub(env, row.workspace_id).channels(actor)).some((c) => c.id === row.channel_id) : false;
	return { workspaceId: row.workspace_id, channelId: visible ? row.channel_id : null };
}

export async function acceptInvite(env: Env, code: string, user: User, now: number): Promise<Result<InviteJoin>> {
	const db = env.DB;
	const row = await db.prepare('SELECT * FROM invites WHERE code = ?').bind(code).first<InviteRow>();
	if (!row) {
		return err(404, 'Invitation invalide');
	}
	const state = inviteState(row, now);
	if (state !== 'valid') {
		return err(404, REFUSED[state]);
	}
	const known = await db.prepare('SELECT 1 FROM members WHERE workspace_id = ? AND user_id = ?').bind(row.workspace_id, user.id).first();
	if (known) {
		return ok(await landing(env, row, user.id));
	}
	// Incrément conditionnel : sur le dernier usage, une seule acceptation passe.
	const taken = await db
		.prepare('UPDATE invites SET uses = uses + 1 WHERE code = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses)')
		.bind(code, now)
		.run();
	if (!taken.meta.changes) {
		const again = await db.prepare('SELECT * FROM invites WHERE code = ?').bind(code).first<InviteRow>();
		const later = again ? inviteState(again, now) : 'revoked';
		return err(404, REFUSED[later === 'valid' ? 'exhausted' : later]);
	}
	const inserted = await db
		.prepare("INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?) ON CONFLICT DO NOTHING")
		.bind(row.workspace_id, user.id, now)
		.run();
	if (!inserted.meta.changes) {
		// Adhésion concurrente déjà passée : l'usage est rendu.
		await db.prepare('UPDATE invites SET uses = uses - 1 WHERE code = ? AND uses > 0').bind(code).run();
		return ok(await landing(env, row, user.id));
	}
	const gradeIds = await grantedGrades(db, row);
	// used_at rafraîchi au retour : le cron compare joined_at pour ne pas retirer un membre revenu par un autre lien.
	await db.batch([
		db.prepare('INSERT INTO invite_uses (code, user_id, used_at) VALUES (?, ?, ?) ON CONFLICT (code, user_id) DO UPDATE SET used_at = excluded.used_at').bind(code, user.id, now),
		...gradeIds.map((id) => db.prepare('INSERT OR IGNORE INTO member_grades (workspace_id, user_id, grade_id) VALUES (?, ?, ?)').bind(row.workspace_id, user.id, id)),
	]);
	const space = workspaceStub(env, row.workspace_id);
	await space.memberJoined(user.id);
	if (gradeIds.length) {
		await space.refreshActors(await loadActors(db, row.workspace_id));
	}
	try {
		await space.recordAudit({ actorId: user.id, actorName: user.name, action: 'invite.join', kind: 'invite', targetId: code, targetName: row.label || null, detail: null });
	} catch (error) {
		console.error(JSON.stringify({ level: 'error', message: 'audit', error: String(error) }));
	}
	return ok(await landing(env, row, user.id));
}

// Cron : membres temporaires retirés une fois leur lien expiré.
export async function expireTemporaryMembers(env: Env, now: number): Promise<number> {
	const { results } = await env.DB.prepare(
		`SELECT i.workspace_id, u.user_id FROM invites i
			JOIN invite_uses u ON u.code = i.code
			JOIN members m ON m.workspace_id = i.workspace_id AND m.user_id = u.user_id AND m.role = 'member' AND m.joined_at <= u.used_at
			WHERE i.temporary = 1 AND i.expires_at <= ? LIMIT 500`,
	)
		.bind(now)
		.all<{ workspace_id: string; user_id: string }>();
	let removed = 0;
	for (const row of results) {
		const done = await env.DB.prepare("DELETE FROM members WHERE workspace_id = ? AND user_id = ? AND role = 'member'").bind(row.workspace_id, row.user_id).run();
		if (done.meta.changes) {
			await workspaceStub(env, row.workspace_id).memberRemoved(row.user_id);
			removed++;
		}
	}
	return removed;
}
