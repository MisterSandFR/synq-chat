import { memberKey } from '../../shared/categories';
import { DEFAULT_GRADE, P } from '../../shared/permissions';

const MEMBER_PREFIX = memberKey('');

// Sur `members m` : propriétaire, administrateur, membre listé ou porteur d'un grade listé ; jamais un invité.
const CAN_SHARE = `m.role != 'guest' AND (m.role = 'owner'
	OR EXISTS (SELECT 1 FROM grades g WHERE g.workspace_id = m.workspace_id AND (g.permissions & ${P.ADMINISTRATOR}) != 0
		AND (g.id = '${DEFAULT_GRADE}' OR g.id IN (SELECT mg.grade_id FROM member_grades mg WHERE mg.workspace_id = m.workspace_id AND mg.user_id = m.user_id)))
	OR EXISTS (SELECT 1 FROM mail_sharers ms WHERE ms.workspace_id = m.workspace_id
		AND (ms.subject_id = '${MEMBER_PREFIX}' || m.user_id OR ms.subject_id = '${DEFAULT_GRADE}'
			OR ms.subject_id IN (SELECT mg.grade_id FROM member_grades mg WHERE mg.workspace_id = m.workspace_id AND mg.user_id = m.user_id))))`;

export async function canShareIn(db: D1Database, workspaceId: string, userId: string): Promise<boolean> {
	return !!(await db.prepare(`SELECT 1 FROM members m WHERE m.workspace_id = ? AND m.user_id = ? AND ${CAN_SHARE}`).bind(workspaceId, userId).first());
}

export async function shareSpaces(db: D1Database, userId: string): Promise<string[]> {
	const { results } = await db.prepare(`SELECT m.workspace_id FROM members m WHERE m.user_id = ? AND ${CAN_SHARE}`).bind(userId).all<{ workspace_id: string }>();
	return results.map((row) => row.workspace_id);
}

// Sujets encore valides : grade existant ou membre non invité.
export async function listSharers(db: D1Database, workspaceId: string): Promise<string[]> {
	const { results } = await db
		.prepare(
			`SELECT subject_id FROM mail_sharers WHERE workspace_id = ?1
				AND (subject_id IN (SELECT id FROM grades WHERE workspace_id = ?1) OR subject_id IN (SELECT '${MEMBER_PREFIX}' || user_id FROM members WHERE workspace_id = ?1 AND role != 'guest'))`,
		)
		.bind(workspaceId)
		.all<{ subject_id: string }>();
	return results.map((row) => row.subject_id);
}
