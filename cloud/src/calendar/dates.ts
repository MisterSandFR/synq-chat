import { DAY, type CalendarEvent, type CalendarOccurrence, type Recurrence } from '../../shared/calendar';

export const HOUR = 3_600_000;

export type Placed = CalendarOccurrence & { event: CalendarEvent; color: string };

export const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// Semaine du lundi.
export const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// Journée entière : minuit UTC ramené au même jour en heure locale.
export function localDay(ms: number, allDay: boolean): Date {
	const d = new Date(ms);
	return allDay ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : startOfDay(d);
}

export const userTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const pad = (n: number) => String(n).padStart(2, '0');

export const toLocalInput = (ms: number) => {
	const d = new Date(ms);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fromLocalInput = (value: string) => new Date(value).getTime();

export const toDateInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const fromDateInput = (value: string) => Date.parse(`${value}T00:00:00Z`);

const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const dayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const fmtTime = (ms: number) => timeFormat.format(ms);
export const fmtMonth = (d: Date) => capitalize(monthFormat.format(d));
export const fmtDay = (d: Date) => dayFormat.format(d);
export const fmtShort = (d: Date) => shortFormat.format(d);

export function whenText(startsAt: number, endsAt: number, allDay: boolean): string {
	if (allDay) {
		const first = localDay(startsAt, true);
		const last = localDay(endsAt - 1, true);
		return sameDay(first, last) ? `${capitalize(fmtDay(first))}, journée entière` : `Du ${fmtDay(first)} au ${fmtDay(last)}`;
	}
	const a = new Date(startsAt);
	const b = new Date(endsAt);
	return sameDay(a, b) ? `${capitalize(fmtDay(a))}, ${fmtTime(startsAt)} – ${fmtTime(endsAt)}` : `Du ${fmtDay(a)} ${fmtTime(startsAt)} au ${fmtDay(b)} ${fmtTime(endsAt)}`;
}

export function recurrenceText(rule: Recurrence, allDay: boolean): string {
	const n = rule.interval;
	const base =
		rule.freq === 'daily' ? (n === 1 ? 'Chaque jour' : `Tous les ${n} jours`) : rule.freq === 'weekly' ? (n === 1 ? 'Chaque semaine' : `Toutes les ${n} semaines`) : n === 1 ? 'Chaque mois' : `Tous les ${n} mois`;
	return rule.until === null ? base : `${base}, jusqu’au ${fmtShort(localDay(rule.until, allDay))}`;
}

export const REMINDERS: Array<[string, string]> = [
	['', 'Aucun rappel'],
	['0', 'Au début'],
	['5', '5 min avant'],
	['15', '15 min avant'],
	['30', '30 min avant'],
	['60', '1 h avant'],
	['1440', '1 jour avant'],
];

export const reminderText = (minutes: number) => (minutes === 0 ? 'Rappel au début' : `Rappel ${REMINDERS.find(([v]) => v === String(minutes))?.[1] ?? `${minutes} min avant`}`);

// Occurrences rangées par jour local, sur chaque jour qu'elles couvrent.
export function groupByDay(items: Placed[], from: Date, days: number): Map<string, Placed[]> {
	const out = new Map<string, Placed[]>();
	const last = addDays(from, days - 1);
	for (const item of items) {
		const allDay = item.event.allDay;
		let day = localDay(item.startsAt, allDay);
		const end = localDay(Math.max(item.endsAt - 1, item.startsAt), allDay);
		if (day < from) {
			day = from;
		}
		for (let guard = 0; day <= end && day <= last && guard < 400; guard++, day = addDays(day, 1)) {
			const key = dayKey(day);
			out.set(key, [...(out.get(key) ?? []), item]);
		}
	}
	for (const list of out.values()) {
		list.sort((a, b) => Number(b.event.allDay) - Number(a.event.allDay) || a.startsAt - b.startsAt);
	}
	return out;
}

export { DAY };
