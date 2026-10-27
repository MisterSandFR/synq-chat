import { DEFAULT_GRADE, P, has } from '../../shared/permissions';
import type { Grade, Member, WorkspaceDetail } from '../../shared/types';

export function memberGrades(member: Member | undefined, grades: Grade[]): Grade[] {
	if (!member) {
		return [];
	}
	return grades.filter((g) => g.id !== DEFAULT_GRADE && member.gradeIds.includes(g.id)).sort((a, b) => b.position - a.position);
}

export function memberColor(member: Member | undefined, grades: Grade[]): string | undefined {
	return memberGrades(member, grades).find((g) => g.color)?.color || undefined;
}

export function memberLabel(member: Member | undefined, grades: Grade[]): string | null {
	if (member?.owner) {
		return 'Propriétaire';
	}
	return memberGrades(member, grades)[0]?.name ?? null;
}

const OWNER_TOP = Number.MAX_SAFE_INTEGER;

export const topOf = (member: Member, grades: Grade[]) => (member.owner ? OWNER_TOP : Math.max(0, ...memberGrades(member, grades).map((g) => g.position)));

type Viewer = Pick<WorkspaceDetail, 'owner' | 'perms' | 'top' | 'grades'>;

// Grade modifiable : sous son plus haut grade, ou propriétaire.
export const canTouchGrade = (info: Viewer, grade: Grade) => info.owner || (has(info.perms, P.MANAGE_GRADES) && (grade.id === DEFAULT_GRADE || grade.position < info.top));

export const assignableGrades = (info: Viewer) => info.grades.filter((g) => g.id !== DEFAULT_GRADE && (info.owner || (has(info.perms, P.MANAGE_GRADES) && g.position < info.top)));

export const canManageMember = (info: Viewer, member: Member, myId: string) =>
	!member.owner && (info.owner || (has(info.perms, P.MANAGE_GRADES) && (member.id === myId || topOf(member, info.grades) < info.top)));

export const canKickMember = (info: Viewer, member: Member, myId: string) =>
	member.id !== myId && !member.owner && (info.owner || (has(info.perms, P.KICK_MEMBERS) && topOf(member, info.grades) < info.top));

// Même règle que le serveur pour la modération vocale et le déplacement.
export const outranks = (info: Viewer, member: Member) => !member.owner && (info.owner || topOf(member, info.grades) < info.top);

// Liste du plus haut au plus bas : `from` prend la place de `to`.
export function reorder(ids: string[], from: string, to: string): string[] {
	const index = ids.indexOf(to);
	if (index < 0 || !ids.includes(from)) {
		return ids;
	}
	const next = ids.filter((id) => id !== from);
	next.splice(index, 0, from);
	return next;
}
