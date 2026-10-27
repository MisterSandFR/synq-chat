import { describe, expect, it } from 'vitest';

import { ALL_PERMS, DEFAULT_GRADE, P } from '../shared/permissions';
import type { Grade, Member } from '../shared/types';
import { assignableGrades, canKickMember, canManageMember, canTouchGrade, outranks, reorder, topOf } from '../src/workspace/grades';

const grade = (id: string, position: number): Grade => ({ id, name: id, color: '', position, permissions: 0 });
const grades = [grade(DEFAULT_GRADE, 0), grade('modo', 1), grade('admin', 2), grade('chef', 3)];
const member = (id: string, gradeIds: string[], owner = false): Member => ({ id, name: id, avatarUrl: null, owner, gradeIds }) as unknown as Member;

const viewer = (perms: number, top: number, owner = false) => ({ owner, perms, top, grades });

describe('ordre des grades', () => {
	it('descend un grade à la place de la cible', () => {
		expect(reorder(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
	});

	it('monte un grade au-dessus de la cible', () => {
		expect(reorder(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
	});

	it('ignore un identifiant inconnu', () => {
		expect(reorder(['a', 'b'], 'x', 'a')).toEqual(['a', 'b']);
	});
});

describe('hiérarchie côté interface', () => {
	const admin = viewer(P.MANAGE_GRADES | P.KICK_MEMBERS, 2);

	it('calcule le plus haut grade', () => {
		expect(topOf(member('u', ['modo', 'admin']), grades)).toBe(2);
		expect(topOf(member('u', []), grades)).toBe(0);
		expect(topOf(member('o', [], true), grades)).toBe(Number.MAX_SAFE_INTEGER);
	});

	it('ne touche que les grades sous le sien', () => {
		expect(canTouchGrade(admin, grades[1]!)).toBe(true);
		expect(canTouchGrade(admin, grades[2]!)).toBe(false);
		expect(canTouchGrade(admin, grades[0]!)).toBe(true);
		expect(assignableGrades(admin).map((g) => g.id)).toEqual(['modo']);
		expect(canTouchGrade(viewer(0, 2), grades[1]!)).toBe(false);
	});

	it('gère et exclut seulement les membres plus bas', () => {
		const low = member('low', ['modo']);
		const peer = member('peer', ['admin']);
		expect(canManageMember(admin, low, 'me')).toBe(true);
		expect(canManageMember(admin, peer, 'me')).toBe(false);
		expect(canKickMember(admin, low, 'me')).toBe(true);
		expect(canKickMember(admin, peer, 'me')).toBe(false);
		expect(canKickMember(admin, low, 'low')).toBe(false);
		expect(outranks(admin, low)).toBe(true);
		expect(outranks(admin, peer)).toBe(false);
	});

	it('le propriétaire passe partout sauf sur lui-même', () => {
		const owner = viewer(ALL_PERMS, 0, true);
		expect(canKickMember(owner, member('chef', ['chef']), 'me')).toBe(true);
		expect(canManageMember(owner, member('o', [], true), 'me')).toBe(false);
		expect(outranks(owner, member('o', [], true))).toBe(false);
	});
});
