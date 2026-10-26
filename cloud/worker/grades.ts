import { ADMIN_GRADE, DEFAULT_GRADE, DEFAULT_MEMBER_PERMS, P, basePerms } from '../shared/permissions';
import type { Actor, Grade } from '../shared/types';

type Row = { user_id: string; name: string; role: string; grade_id: string; permissions: number; position: number };

const ACTOR_SQL = `SELECT m.user_id, u.name, m.role, g.id AS grade_id, g.permissions, g.position
	FROM members m
	JOIN users u ON u.id = m.user_id
	JOIN grades g ON g.workspace_id = m.workspace_id
		AND (g.id = '${DEFAULT_GRADE}' OR g.id IN (SELECT grade_id FROM member_grades mg WHERE mg.workspace_id = m.workspace_id AND mg.user_id = m.user_id))
	WHERE m.workspace_id = ?`;

const OWNER_TOP = Number.MAX_SAFE_INTEGER;

function toActors(rows: Row[]): Actor[] {
	const byUser = new Map<string, Row[]>();
	for (const row of rows) {
		byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
	}
	return [...byUser.values()].map((grades) => {
		const first = grades[0]!;
		const owner = first.role === 'owner';
		return {
			id: first.user_id,
			name: first.name,
			owner,
			grades: grades.map((g) => g.grade_id),
			perms: basePerms(owner, grades),
			top: owner ? OWNER_TOP : Math.max(...grades.map((g) => g.position)),
		};
	});
}

export async function loadActor(db: D1Database, workspaceId: string, userId: string): Promise<Actor | null> {
	const { results } = await db.prepare(`${ACTOR_SQL} AND m.user_id = ?`).bind(workspaceId, userId).all<Row>();
	return toActors(results)[0] ?? null;
}

export async function loadActors(db: D1Database, workspaceId: string): Promise<Actor[]> {
	const { results } = await db.prepare(ACTOR_SQL).bind(workspaceId).all<Row>();
	return toActors(results);
}

export async function listGrades(db: D1Database, workspaceId: string): Promise<Grade[]> {
	const { results } = await db
		.prepare('SELECT id, name, color, position, permissions FROM grades WHERE workspace_id = ? ORDER BY position DESC')
		.bind(workspaceId)
		.all<Grade>();
	return results;
}

export const defaultGrades = (db: D1Database, workspaceId: string) => [
	db
		.prepare('INSERT INTO grades (workspace_id, id, name, color, position, permissions) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(workspaceId, DEFAULT_GRADE, 'Membre', '', 0, DEFAULT_MEMBER_PERMS),
	db
		.prepare('INSERT INTO grades (workspace_id, id, name, color, position, permissions) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(workspaceId, ADMIN_GRADE, 'Admin', '#D14343', 1, P.ADMINISTRATOR),
];
