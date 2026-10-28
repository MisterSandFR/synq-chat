import {
	ABSENCE_KINDS,
	ABSENCE_LIMITS,
	daysBetween,
	validDay,
	type Absence,
	type AbsenceGrade,
	type AbsenceInput,
	type AbsenceKind,
	type AbsenceListing,
	type AbsencePerson,
	type Half,
} from '../shared/absences';
import { P, has } from '../shared/permissions';
import { loadAccess } from './calendar';
import { err, ok, type Result } from './result';

type Row = {
	id: string;
	user_id: string;
	kind: AbsenceKind;
	start_day: string;
	start_half: Half;
	end_day: string | null;
	end_half: Half;
	note: string;
	private: number;
	weekdays: number;
};

const KINDS = new Set<string>(ABSENCE_KINDS.map((k) => k.value));
const HALVES = new Set(['am', 'pm']);

// Personnes qui partagent un espace avec soi, invités exclus des deux côtés.
const SHARED_SQL = `SELECT m.user_id FROM members mine JOIN members m ON m.workspace_id = mine.workspace_id WHERE mine.user_id = ?1 AND mine.role != 'guest' AND m.role != 'guest'`;

// Membres des espaces où l'on a MANAGE_WORKSPACE.
async function manageable(db: D1Database, userId: string): Promise<Set<string>> {
	const access = await loadAccess(db, userId);
	const managed = [...access].filter(([, actor]) => has(actor.perms, P.MANAGE_WORKSPACE)).map(([id]) => id);
	if (!managed.length) {
		return new Set();
	}
	const { results } = await db
		.prepare("SELECT DISTINCT user_id FROM members WHERE workspace_id IN (SELECT value FROM json_each(?)) AND role != 'guest'")
		.bind(JSON.stringify(managed))
		.all<{ user_id: string }>();
	return new Set(results.map((r) => r.user_id));
}

async function visible(db: D1Database, viewerId: string, userId: string): Promise<boolean> {
	if (viewerId === userId) {
		return true;
	}
	return Boolean(await db.prepare(`${SHARED_SQL} AND m.user_id = ?2 LIMIT 1`).bind(viewerId, userId).first());
}

function toAbsence(row: Row, viewerId: string, managed: Set<string>): Absence {
	const masked = row.private === 1 && row.user_id !== viewerId;
	return {
		id: row.id,
		userId: row.user_id,
		kind: masked ? null : row.kind,
		startDay: row.start_day,
		startHalf: row.start_half,
		endDay: row.end_day,
		endHalf: row.end_half,
		note: masked ? '' : row.note,
		private: row.private === 1,
		weekdays: row.weekdays,
		canEdit: row.user_id === viewerId || managed.has(row.user_id),
	};
}

export async function listAbsences(db: D1Database, viewerId: string, from: string, to: string, workspaceId: string | null): Promise<Result<AbsenceListing>> {
	let people: AbsencePerson[];
	let grades: AbsenceGrade[] = [];
	const managed = await manageable(db, viewerId);
	if (workspaceId) {
		const member = await db.prepare("SELECT 1 FROM members WHERE workspace_id = ? AND user_id = ? AND role != 'guest'").bind(workspaceId, viewerId).first();
		if (!member) {
			return err(404, 'Espace introuvable');
		}
		const [rows, links, gradeRows] = await db.batch([
			db
				.prepare("SELECT u.id, u.name, u.avatar_url AS avatarUrl FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role != 'guest' ORDER BY u.name COLLATE NOCASE")
				.bind(workspaceId),
			db.prepare('SELECT user_id, grade_id FROM member_grades WHERE workspace_id = ?').bind(workspaceId),
			db.prepare("SELECT id, name, color FROM grades WHERE workspace_id = ? AND id != 'default' ORDER BY position DESC").bind(workspaceId),
		]);
		const byUser = new Map<string, string[]>();
		for (const link of links!.results as Array<{ user_id: string; grade_id: string }>) {
			byUser.set(link.user_id, [...(byUser.get(link.user_id) ?? []), link.grade_id]);
		}
		people = (rows!.results as Array<Omit<AbsencePerson, 'gradeIds' | 'canManage'>>).map((p) => ({ ...p, gradeIds: byUser.get(p.id) ?? [], canManage: p.id === viewerId || managed.has(p.id) }));
		grades = gradeRows!.results as AbsenceGrade[];
	} else {
		const { results } = await db
			.prepare(`SELECT u.id, u.name, u.avatar_url AS avatarUrl FROM users u WHERE u.id = ?1 OR u.id IN (${SHARED_SQL}) ORDER BY u.name COLLATE NOCASE LIMIT 1000`)
			.bind(viewerId)
			.all<Omit<AbsencePerson, 'gradeIds' | 'canManage'>>();
		people = results.map((p) => ({ ...p, gradeIds: [], canManage: p.id === viewerId || managed.has(p.id) }));
	}
	const { results } = await db
		.prepare('SELECT * FROM absences WHERE user_id IN (SELECT value FROM json_each(?1)) AND start_day <= ?3 AND (end_day IS NULL OR end_day >= ?2) ORDER BY start_day LIMIT 2000')
		.bind(JSON.stringify(people.map((p) => p.id)), from, to)
		.all<Row>();
	return ok({ people, grades, absences: results.map((row) => toAbsence(row, viewerId, managed)) });
}

const BLANK: AbsenceInput = { userId: '', kind: 'leave', startDay: '', startHalf: 'am', endDay: null, endHalf: 'pm', note: '', private: false, weekdays: 0 };

// Saisie partielle fusionnée sur l'existant, puis validée.
function normalize(input: Partial<AbsenceInput>, base: AbsenceInput): Result<AbsenceInput> {
	const pick = <K extends keyof AbsenceInput>(key: K): unknown => (input[key] === undefined ? base[key] : input[key]);
	const weekdays = pick('weekdays');
	const note = pick('note');
	const data = {
		userId: base.userId,
		kind: pick('kind'),
		startDay: pick('startDay'),
		startHalf: pick('startHalf'),
		endDay: pick('endDay'),
		endHalf: pick('endHalf'),
		note: typeof note === 'string' ? note.trim().slice(0, ABSENCE_LIMITS.note) : '',
		private: pick('private') === true,
		weekdays: Number.isInteger(weekdays) ? (weekdays as number) : -1,
	};
	if (typeof data.kind !== 'string' || !KINDS.has(data.kind)) {
		return err(400, 'Type d’absence invalide');
	}
	if (data.weekdays < 0 || data.weekdays > 127) {
		return err(400, 'Rythme hebdomadaire invalide');
	}
	if (!validDay(data.startDay) || (data.endDay !== null && !validDay(data.endDay)) || (data.endDay === null && !data.weekdays)) {
		return err(400, 'Dates invalides');
	}
	if (typeof data.startHalf !== 'string' || !HALVES.has(data.startHalf) || typeof data.endHalf !== 'string' || !HALVES.has(data.endHalf)) {
		return err(400, 'Demi-journée invalide');
	}
	if (data.endDay !== null && data.endDay < data.startDay) {
		return err(400, 'La fin précède le début');
	}
	// Après-midi puis matin du même jour : rien de couvert.
	if (data.startHalf === 'pm' && data.endHalf === 'am' && (data.weekdays || data.endDay === data.startDay)) {
		return err(400, 'Demi-journée invalide');
	}
	if (!data.weekdays && daysBetween(data.startDay, data.endDay as string) > ABSENCE_LIMITS.spanDays) {
		return err(400, 'Absence trop longue (un an max)');
	}
	return ok(data as AbsenceInput);
}

export async function createAbsence(db: D1Database, viewerId: string, input: Partial<AbsenceInput>): Promise<Result<Absence>> {
	const userId = typeof input.userId === 'string' && input.userId ? input.userId : viewerId;
	const managed = await manageable(db, viewerId);
	if (userId !== viewerId && !managed.has(userId)) {
		return (await visible(db, viewerId, userId)) ? err(403, 'Permission insuffisante') : err(404, 'Personne introuvable');
	}
	const data = normalize(input, { ...BLANK, userId });
	if (!data.ok) {
		return data;
	}
	const count = await db.prepare('SELECT COUNT(*) AS n FROM absences WHERE user_id = ?').bind(userId).first<number>('n');
	if ((count ?? 0) >= ABSENCE_LIMITS.perUser) {
		return err(409, 'Trop d’absences enregistrées');
	}
	const d = data.value;
	const now = Date.now();
	const id = crypto.randomUUID();
	await db
		.prepare(
			'INSERT INTO absences (id, user_id, kind, start_day, start_half, end_day, end_half, note, private, weekdays, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
		)
		.bind(id, userId, d.kind, d.startDay, d.startHalf, d.endDay, d.endHalf, d.note, d.private ? 1 : 0, d.weekdays, viewerId, now, now)
		.run();
	const row = await db.prepare('SELECT * FROM absences WHERE id = ?').bind(id).first<Row>();
	return ok(toAbsence(row!, viewerId, managed));
}

// Ligne visible et modifiable par `viewerId`, sinon l'erreur à renvoyer.
async function editable(db: D1Database, viewerId: string, id: string): Promise<Result<{ row: Row; managed: Set<string> }>> {
	const row = await db.prepare('SELECT * FROM absences WHERE id = ?').bind(id).first<Row>();
	if (!row || !(await visible(db, viewerId, row.user_id))) {
		return err(404, 'Absence introuvable');
	}
	const managed = await manageable(db, viewerId);
	if (row.user_id !== viewerId && !managed.has(row.user_id)) {
		return err(403, 'Permission insuffisante');
	}
	return ok({ row, managed });
}

export async function updateAbsence(db: D1Database, viewerId: string, id: string, input: Partial<AbsenceInput>): Promise<Result<Absence>> {
	const found = await editable(db, viewerId, id);
	if (!found.ok) {
		return found;
	}
	const { row, managed } = found.value;
	const base: AbsenceInput = {
		userId: row.user_id,
		kind: row.kind,
		startDay: row.start_day,
		startHalf: row.start_half,
		endDay: row.end_day,
		endHalf: row.end_half,
		note: row.note,
		private: row.private === 1,
		weekdays: row.weekdays,
	};
	// Absence privée d'un autre : type et note restent cachés, donc intouchables.
	const masked = row.private === 1 && row.user_id !== viewerId;
	const data = normalize(masked ? { ...input, kind: undefined, note: undefined, private: undefined } : input, base);
	if (!data.ok) {
		return data;
	}
	const d = data.value;
	await db
		.prepare('UPDATE absences SET kind = ?, start_day = ?, start_half = ?, end_day = ?, end_half = ?, note = ?, private = ?, weekdays = ?, updated_at = ? WHERE id = ?')
		.bind(d.kind, d.startDay, d.startHalf, d.endDay, d.endHalf, d.note, d.private ? 1 : 0, d.weekdays, Date.now(), id)
		.run();
	const updated = await db.prepare('SELECT * FROM absences WHERE id = ?').bind(id).first<Row>();
	return ok(toAbsence(updated!, viewerId, managed));
}

export async function deleteAbsence(db: D1Database, viewerId: string, id: string): Promise<Result<{ userId: string }>> {
	const found = await editable(db, viewerId, id);
	if (!found.ok) {
		return found;
	}
	await db.prepare('DELETE FROM absences WHERE id = ?').bind(id).run();
	return ok({ userId: found.value.row.user_id });
}

// La personne et tous ceux qui partagent un espace avec elle.
export async function absenceAudience(db: D1Database, userId: string): Promise<string[]> {
	const { results } = await db.prepare(SHARED_SQL).bind(userId).all<{ user_id: string }>();
	return [userId, ...results.map((r) => r.user_id)];
}
