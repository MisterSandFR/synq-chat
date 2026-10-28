export type AbsenceKind = 'leave' | 'sick' | 'remote' | 'travel' | 'training' | 'other';

export type Half = 'am' | 'pm';

export type DayPart = 'day' | Half;

export const ABSENCE_KINDS: Array<{ value: AbsenceKind; label: string; state: string; emoji: string }> = [
	{ value: 'leave', label: 'Congé', state: 'en congé', emoji: '🌴' },
	{ value: 'sick', label: 'Maladie', state: 'en arrêt maladie', emoji: '🤒' },
	{ value: 'remote', label: 'Télétravail', state: 'en télétravail', emoji: '🏠' },
	{ value: 'travel', label: 'Déplacement', state: 'en déplacement', emoji: '✈️' },
	{ value: 'training', label: 'Formation', state: 'en formation', emoji: '🎓' },
	{ value: 'other', label: 'Autre', state: 'absent', emoji: '📅' },
];

const PRIVATE_KIND = { value: null, label: 'Absent', state: 'absent', emoji: '📅' };

export const kindInfo = (kind: AbsenceKind | null) => ABSENCE_KINDS.find((k) => k.value === kind) ?? PRIVATE_KIND;

export interface Absence {
	id: string;
	userId: string;
	// null : absence privée vue par quelqu'un d'autre.
	kind: AbsenceKind | null;
	startDay: string;
	startHalf: Half;
	// null : rythme hebdomadaire sans fin.
	endDay: string | null;
	endHalf: Half;
	note: string;
	private: boolean;
	// Bits lundi = 1 … dimanche = 64 ; 0 = période continue.
	weekdays: number;
	canEdit: boolean;
}

export interface AbsenceInput {
	userId: string;
	kind: AbsenceKind;
	startDay: string;
	startHalf: Half;
	endDay: string | null;
	endHalf: Half;
	note: string;
	private: boolean;
	weekdays: number;
}

export interface AbsencePerson {
	id: string;
	name: string;
	avatarUrl: string | null;
	gradeIds: string[];
	canManage: boolean;
}

export interface AbsenceGrade {
	id: string;
	name: string;
	color: string;
}

export interface AbsenceListing {
	people: AbsencePerson[];
	grades: AbsenceGrade[];
	absences: Absence[];
}

export interface AbsenceNow {
	kind: AbsenceKind | null;
	part: DayPart;
	until: string;
	untilHalf: Half;
}

export const ABSENCE_LIMITS = { note: 500, rangeDays: 400, spanDays: 366, perUser: 500 } as const;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const dayOf = (year: number, monthIndex: number, day: number) => new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);

const pad = (n: number) => String(n).padStart(2, '0');

// Jour local du navigateur, pas UTC.
export const dayFromDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function validDay(value: unknown): value is string {
	const m = typeof value === 'string' ? DAY_RE.exec(value) : null;
	return m !== null && dayOf(Number(m[1]), Number(m[2]) - 1, Number(m[3])) === value;
}

export function shiftDay(day: string, n: number): string {
	const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
	return dayOf(y, m - 1, d + n);
}

// 0 = lundi.
export const weekdayOf = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

// Algorithme de Meeus, calendrier grégorien.
export function easter(year: number): string {
	const a = year % 19;
	const b = Math.floor(year / 100);
	const c = year % 100;
	const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
	const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
	const m = Math.floor((a + 11 * h + 22 * l) / 451);
	const month = Math.floor((h + l - 7 * m + 114) / 31);
	return dayOf(year, month - 1, ((h + l - 7 * m + 114) % 31) + 1);
}

export function frenchHolidays(year: number): Map<string, string> {
	const e = easter(year);
	return new Map([
		[`${year}-01-01`, 'Jour de l’an'],
		[shiftDay(e, 1), 'Lundi de Pâques'],
		[`${year}-05-01`, 'Fête du Travail'],
		[`${year}-05-08`, 'Victoire 1945'],
		[shiftDay(e, 39), 'Ascension'],
		[shiftDay(e, 50), 'Lundi de Pentecôte'],
		[`${year}-07-14`, 'Fête nationale'],
		[`${year}-08-15`, 'Assomption'],
		[`${year}-11-01`, 'Toussaint'],
		[`${year}-11-11`, 'Armistice 1918'],
		[`${year}-12-25`, 'Noël'],
	]);
}

export function holidaysBetween(from: string, to: string): Map<string, string> {
	const out = new Map<string, string>();
	for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
		for (const [day, name] of frenchHolidays(year)) {
			if (day >= from && day <= to) {
				out.set(day, name);
			}
		}
	}
	return out;
}

type Span = Pick<Absence, 'startDay' | 'startHalf' | 'endDay' | 'endHalf' | 'weekdays'>;

// Demi-journées couvertes ce jour-là, ou null.
export function partOn(a: Span, day: string): DayPart | null {
	if (day < a.startDay || (a.endDay !== null && day > a.endDay)) {
		return null;
	}
	if (a.weekdays) {
		if (!(a.weekdays & (1 << weekdayOf(day)))) {
			return null;
		}
		return a.startHalf === 'am' && a.endHalf === 'pm' ? 'day' : a.startHalf;
	}
	const am = !(day === a.startDay && a.startHalf === 'pm');
	const pm = !(day === a.endDay && a.endHalf === 'am');
	return am && pm ? 'day' : am ? 'am' : pm ? 'pm' : null;
}

export const covers = (part: DayPart | null, half: Half) => part === 'day' || part === half;

// Absence en cours ; la plus longue l'emporte, le télétravail cède à égalité.
export function absenceNow(list: Absence[], userId: string, today: string): AbsenceNow | null {
	let best: AbsenceNow | null = null;
	for (const a of list) {
		const part = a.userId === userId ? partOn(a, today) : null;
		if (!part) {
			continue;
		}
		const now: AbsenceNow = a.weekdays
			? { kind: a.kind, part, until: today, untilHalf: part === 'am' ? 'am' : 'pm' }
			: { kind: a.kind, part, until: a.endDay ?? today, untilHalf: a.endHalf };
		if (!best || now.until > best.until || (now.until === best.until && best.kind === 'remote' && now.kind !== 'remote')) {
			best = now;
		}
	}
	return best;
}

const shortDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const fmtAbsenceDay = (day: string) => shortDay.format(Date.parse(day));

export function absenceWhen(now: AbsenceNow, today: string): string {
	if (now.until === today) {
		return now.part === 'am' ? 'ce matin' : now.part === 'pm' ? 'cet après-midi' : 'aujourd’hui';
	}
	return `jusqu’au ${fmtAbsenceDay(now.until)}${now.untilHalf === 'am' ? ' midi' : ''}`;
}

export function absenceStatus(now: AbsenceNow, today: string): string {
	const state = kindInfo(now.kind).state;
	return `${state.charAt(0).toUpperCase()}${state.slice(1)} ${absenceWhen(now, today)}`;
}

// Pas de double point après « nov. ».
export const absenceSentence = (name: string, now: AbsenceNow, today: string) => `${name} est ${kindInfo(now.kind).state} ${absenceWhen(now, today)}`.replace(/\.?$/, '.');
