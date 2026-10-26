import { DEFAULT_GRADE } from '../../shared/permissions';
import type { Grade, Member } from '../../shared/types';

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
