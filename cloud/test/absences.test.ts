import { describe, expect, it } from 'vitest';

import { absenceNow, absenceSentence, absenceStatus, easter, frenchHolidays, holidaysBetween, partOn, type Absence, type AbsenceListing } from '../shared/absences';
import { Client, signup, workspaceWithMember } from './helpers';

const RANGE = 'from=2026-11-01&to=2026-11-30';

const leave = (extra: Record<string, unknown> = {}) => ({ kind: 'leave', startDay: '2026-11-02', endDay: '2026-11-05', note: 'Bretagne', ...extra });

describe('absences : visibilité', () => {
	it('limite la vue aux personnes des espaces communs', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const stranger = await signup('Eve');
		const created = await member.req<Absence>('POST', '/api/absences', leave());
		expect(created.status).toBe(201);
		expect(created.data).toMatchObject({ userId: member.user.id, kind: 'leave', startHalf: 'am', endHalf: 'pm', canEdit: true });

		const seen = await owner.req<AbsenceListing>('GET', `/api/absences?${RANGE}`);
		expect(seen.data.absences.map((a) => a.id)).toEqual([created.data.id]);
		expect(seen.data.people.map((p) => p.id).sort()).toEqual([owner.user.id, member.user.id].sort());

		const scoped = await owner.req<AbsenceListing>('GET', `/api/absences?${RANGE}&workspace=${wid}`);
		expect(scoped.status).toBe(200);
		expect(scoped.data.absences).toHaveLength(1);
		expect(scoped.data.people.find((p) => p.id === member.user.id)?.canManage).toBe(true);

		expect((await stranger.req<AbsenceListing>('GET', `/api/absences?${RANGE}`)).data.absences).toHaveLength(0);
		expect((await stranger.req('GET', `/api/absences?${RANGE}&workspace=${wid}`)).status).toBe(404);
		expect((await stranger.req('PATCH', `/api/absences/${created.data.id}`, { note: 'x' })).status).toBe(404);
		expect((await owner.req<AbsenceListing>('GET', '/api/absences?from=2026-12-01&to=2026-12-31')).data.absences).toHaveLength(0);
		expect((await owner.req('GET', '/api/absences?from=2026-11-30&to=2026-11-01')).status).toBe(400);
		expect((await new Client().req('GET', `/api/absences?${RANGE}`)).status).toBe(401);
	});

	it('masque type et note d’une absence privée', async () => {
		const { owner, member } = await workspaceWithMember();
		const created = await owner.req<Absence>('POST', '/api/absences', leave({ kind: 'sick', private: true, note: 'Grippe' }));
		expect(created.data).toMatchObject({ kind: 'sick', note: 'Grippe', private: true });
		const seen = await member.req<AbsenceListing>('GET', `/api/absences?${RANGE}`);
		expect(seen.data.absences[0]).toMatchObject({ kind: null, note: '', private: true, canEdit: false });
	});
});

describe('absences : saisie', () => {
	it('gère les demi-journées', async () => {
		const { member } = await workspaceWithMember();
		const half = await member.req<Absence>('POST', '/api/absences', leave({ startDay: '2026-11-02', startHalf: 'pm', endDay: '2026-11-03', endHalf: 'am' }));
		expect(half.status).toBe(201);
		expect(partOn(half.data, '2026-11-02')).toBe('pm');
		expect(partOn(half.data, '2026-11-03')).toBe('am');
		expect(partOn(half.data, '2026-11-04')).toBeNull();
		expect(partOn({ ...half.data, endDay: '2026-11-04', endHalf: 'pm' }, '2026-11-03')).toBe('day');
		expect((await member.req('POST', '/api/absences', leave({ startDay: '2026-11-02', startHalf: 'pm', endDay: '2026-11-02', endHalf: 'am' }))).status).toBe(400);
		expect((await member.req('POST', '/api/absences', leave({ endDay: '2026-11-01' }))).status).toBe(400);
		expect((await member.req('POST', '/api/absences', leave({ kind: 'vacances' }))).status).toBe(400);
		expect((await member.req('POST', '/api/absences', leave({ startDay: '2026-02-30' }))).status).toBe(400);
		expect((await member.req('POST', '/api/absences', leave({ endDay: null }))).status).toBe(400);
	});

	it('répète un rythme hebdomadaire', async () => {
		const { owner, member } = await workspaceWithMember();
		const weekly = await member.req<Absence>('POST', '/api/absences', { kind: 'remote', startDay: '2026-10-01', endDay: null, weekdays: 1 });
		expect(weekly.status).toBe(201);
		const seen = await owner.req<AbsenceListing>('GET', '/api/absences?from=2027-03-01&to=2027-03-31');
		expect(seen.data.absences.map((a) => a.id)).toEqual([weekly.data.id]);
		expect(partOn(weekly.data, '2026-11-02')).toBe('day');
		expect(partOn(weekly.data, '2026-11-03')).toBeNull();
		expect(partOn(weekly.data, '2026-09-28')).toBeNull();
		const mornings = { ...weekly.data, weekdays: 1 | 16, endHalf: 'am' as const };
		expect(partOn(mornings, '2026-11-06')).toBe('am');
		expect((await member.req('POST', '/api/absences', { kind: 'remote', startDay: '2026-10-01', endDay: null, weekdays: 128 })).status).toBe(400);
	});

	it('réserve la modification à la personne et aux gestionnaires', async () => {
		const { owner, member } = await workspaceWithMember();
		const mine = await owner.req<Absence>('POST', '/api/absences', leave());
		expect((await member.req('PATCH', `/api/absences/${mine.data.id}`, { note: 'Pirate' })).status).toBe(403);
		expect((await member.req('DELETE', `/api/absences/${mine.data.id}`)).status).toBe(403);
		expect((await member.req('POST', '/api/absences', leave({ userId: owner.user.id }))).status).toBe(403);

		const theirs = await member.req<Absence>('POST', '/api/absences', leave({ private: true, note: 'Secret' }));
		const edited = await owner.req<Absence>('PATCH', `/api/absences/${theirs.data.id}`, { endDay: '2026-11-06', kind: 'other', note: 'Écrasée' });
		expect(edited.status).toBe(200);
		expect(edited.data).toMatchObject({ endDay: '2026-11-06', kind: null, canEdit: true });
		const own = await member.req<AbsenceListing>('GET', `/api/absences?${RANGE}`);
		expect(own.data.absences.find((a) => a.id === theirs.data.id)).toMatchObject({ kind: 'leave', note: 'Secret' });

		const posed = await owner.req<Absence>('POST', '/api/absences', leave({ userId: member.user.id }));
		expect(posed.data.userId).toBe(member.user.id);
		expect((await owner.req('DELETE', `/api/absences/${theirs.data.id}`)).status).toBe(200);
		expect((await member.req('PATCH', `/api/absences/${theirs.data.id}`, { note: 'x' })).status).toBe(404);
	});
});

describe('absences : calendrier', () => {
	it('calcule les jours fériés français', () => {
		expect(easter(2027)).toBe('2027-03-28');
		expect(easter(2026)).toBe('2026-04-05');
		const days = frenchHolidays(2027);
		expect(days.get('2027-03-29')).toBe('Lundi de Pâques');
		expect(days.get('2027-05-06')).toBe('Ascension');
		expect(days.get('2027-05-17')).toBe('Lundi de Pentecôte');
		expect(days.size).toBe(11);
		expect([...holidaysBetween('2026-12-20', '2027-01-10').keys()]).toEqual(['2026-12-25', '2027-01-01']);
	});

	it('résume l’absence en cours', () => {
		const base: Absence = { id: 'a', userId: 'u', kind: 'leave', startDay: '2026-11-02', startHalf: 'am', endDay: '2026-11-05', endHalf: 'pm', note: '', private: false, weekdays: 0, canEdit: false };
		const remote: Absence = { ...base, id: 'b', kind: 'remote', endDay: null, weekdays: 2 };
		const now = absenceNow([remote, base], 'u', '2026-11-03')!;
		expect(now).toMatchObject({ kind: 'leave', until: '2026-11-05' });
		expect(absenceStatus(now, '2026-11-03')).toBe('En congé jusqu’au 5 nov.');
		expect(absenceSentence('Léa', now, '2026-11-03')).toBe('Léa est en congé jusqu’au 5 nov.');
		expect(absenceStatus(absenceNow([remote], 'u', '2026-11-10')!, '2026-11-10')).toBe('En télétravail aujourd’hui');
		expect(absenceStatus(absenceNow([{ ...base, kind: null, endDay: '2026-11-02', endHalf: 'am' }], 'u', '2026-11-02')!, '2026-11-02')).toBe('Absent ce matin');
		expect(absenceNow([base], 'u', '2026-11-06')).toBeNull();
		expect(absenceNow([base], 'v', '2026-11-03')).toBeNull();
	});
});
