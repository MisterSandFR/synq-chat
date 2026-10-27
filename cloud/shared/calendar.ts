export type RsvpResponse = 'pending' | 'yes' | 'no' | 'maybe';

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly';

export interface Recurrence {
	freq: RecurrenceFreq;
	interval: number;
	// Début de la dernière occurrence possible ; null = sans fin.
	until: number | null;
}

export interface Attendee {
	id: string;
	name: string;
	avatarUrl: string | null;
	response: RsvpResponse;
}

export interface CalendarEvent {
	id: string;
	// null = événement personnel.
	workspaceId: string | null;
	createdBy: string;
	title: string;
	description: string;
	startsAt: number;
	// Exclusif ; journée entière : minuits UTC.
	endsAt: number;
	allDay: boolean;
	timezone: string;
	location: string;
	channelId: string | null;
	color: string;
	recurrence: Recurrence | null;
	exceptions: number[];
	reminderMinutes: number | null;
	attendees: Attendee[];
	canEdit: boolean;
	myResponse: RsvpResponse | null;
}

// Carte de chat : l'événement lu en D1, ou annulé s'il a été supprimé.
export type EventCard = { status: 'active'; event: CalendarEvent } | { status: 'cancelled' };

export interface CalendarOccurrence {
	eventId: string;
	startsAt: number;
	endsAt: number;
}

export interface CalendarListing {
	events: CalendarEvent[];
	occurrences: CalendarOccurrence[];
}

export interface EventInput {
	workspaceId: string | null;
	title: string;
	description: string;
	startsAt: number;
	endsAt: number;
	allDay: boolean;
	timezone: string;
	location: string;
	channelId: string | null;
	color: string;
	recurrence: Recurrence | null;
	reminderMinutes: number | null;
	attendees: string[];
}

export interface CalendarPerson {
	id: string;
	name: string;
	avatarUrl: string | null;
}

export interface CalendarReminder {
	eventId: string;
	title: string;
	startsAt: number;
	workspaceId: string | null;
	location: string;
}

export interface CalendarFeed {
	active: boolean;
	createdAt: number | null;
}

export const CALENDAR_LIMITS = {
	title: 200,
	description: 4000,
	location: 200,
	attendees: 50,
	interval: 99,
	reminderMinutes: 40_320,
	rangeDays: 400,
	occurrences: 1000,
	importBytes: 1_000_000,
	importEvents: 200,
} as const;

export const DAY = 86_400_000;

export type EventTiming = Pick<CalendarEvent, 'startsAt' | 'endsAt' | 'timezone' | 'recurrence' | 'exceptions'>;

const formatters = new Map<string, Intl.DateTimeFormat>();

export function wallParts(ms: number, timeZone: string) {
	let format = formatters.get(timeZone);
	if (!format) {
		format = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric',
		});
		formatters.set(timeZone, format);
	}
	const out: Record<string, number> = {};
	for (const part of format.formatToParts(ms)) {
		if (part.type !== 'literal') {
			out[part.type] = Number(part.value);
		}
	}
	return { year: out.year!, month: out.month!, day: out.day!, hour: out.hour! % 24, minute: out.minute!, second: out.second! };
}

const tzOffset = (ms: number, timeZone: string) => {
	const p = wallParts(ms, timeZone);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
};

// Heure murale d'un fuseau vers UTC ; mois et jour peuvent déborder (Date.UTC normalise).
export function zonedTime(timeZone: string, year: number, monthIndex: number, day: number, hour: number, minute: number, second = 0): number {
	const guess = Date.UTC(year, monthIndex, day, hour, minute, second);
	const first = guess - tzOffset(guess, timeZone);
	return guess - tzOffset(first, timeZone);
}

export function validTimeZone(timeZone: unknown): timeZone is string {
	if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) {
		return false;
	}
	try {
		new Intl.DateTimeFormat('en-US', { timeZone });
		return true;
	} catch {
		return false;
	}
}

// Débuts des occurrences qui chevauchent [from, to[, calculés en heure murale pour suivre les changements d'heure.
export function occurrences(event: EventTiming, from: number, to: number, limit: number = CALENDAR_LIMITS.occurrences): number[] {
	const duration = Math.max(event.endsAt - event.startsAt, 1);
	if (!event.recurrence) {
		return event.startsAt < to && event.startsAt + duration > from ? [event.startsAt] : [];
	}
	const { freq, interval, until } = event.recurrence;
	const skip = new Set(event.exceptions);
	const p = wallParts(event.startsAt, event.timezone);
	let index = 0;
	if (freq === 'monthly') {
		const f = wallParts(Math.max(from - duration, event.startsAt), event.timezone);
		index = Math.max(0, Math.floor(((f.year - p.year) * 12 + f.month - p.month) / interval) - 1);
	} else {
		const step = (freq === 'daily' ? 1 : 7) * interval * DAY;
		index = Math.max(0, Math.floor((from - duration - event.startsAt) / step) - 1);
	}
	const out: number[] = [];
	for (let guard = 0; guard < 20_000 && out.length < limit; guard++, index++) {
		let start: number;
		if (freq === 'monthly') {
			const monthIndex = p.month - 1 + index * interval;
			// Mois sans ce jour (29 à 31) : occurrence sautée, comme RFC 5545.
			if (new Date(Date.UTC(p.year, monthIndex, p.day)).getUTCDate() !== p.day) {
				continue;
			}
			start = zonedTime(event.timezone, p.year, monthIndex, p.day, p.hour, p.minute, p.second);
		} else {
			start = zonedTime(event.timezone, p.year, p.month - 1, p.day + index * interval * (freq === 'daily' ? 1 : 7), p.hour, p.minute, p.second);
		}
		if (!Number.isFinite(start) || start >= to || (until !== null && start > until)) {
			break;
		}
		if (start + duration > from && !skip.has(start)) {
			out.push(start);
		}
	}
	return out;
}

// Prochain rappel à envoyer à partir de `after`, ou null.
export function nextRemindAt(event: EventTiming, reminderMinutes: number | null, after: number): number | null {
	if (reminderMinutes === null) {
		return null;
	}
	const lead = reminderMinutes * 60_000;
	const [start] = occurrences({ ...event, endsAt: event.startsAt + 1 }, after + lead, after + lead + 10 * 366 * DAY, 1);
	return start === undefined ? null : start - lead;
}
