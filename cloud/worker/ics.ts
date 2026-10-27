import { DAY, occurrences, validTimeZone, wallParts, zonedTime, type Recurrence, type RecurrenceFreq } from '../shared/calendar';

export interface IcsEvent {
	uid: string;
	title: string;
	description: string;
	location: string;
	startsAt: number;
	endsAt: number;
	allDay: boolean;
	timezone: string;
	recurrence: Recurrence | null;
	exceptions: number[];
	updatedAt: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

const utcStamp = (ms: number) => {
	const d = new Date(ms);
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};

const localStamp = (ms: number, timeZone: string) => {
	const p = wallParts(ms, timeZone);
	return `${p.year}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`;
};

const escapeText = (value: string) => value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const encoder = new TextEncoder();

// Lignes de 75 octets max (RFC 5545), coupées entre caractères.
function fold(line: string): string {
	const chunks: string[] = [];
	let current = '';
	let size = 0;
	for (const char of line) {
		const bytes = encoder.encode(char).length;
		if (size + bytes > (chunks.length ? 74 : 75)) {
			chunks.push(current);
			current = '';
			size = 0;
		}
		current += char;
		size += bytes;
	}
	chunks.push(current);
	return chunks.join('\r\n ');
}

// Série en heure murale : TZID pour que l'agenda externe suive les changements d'heure.
function stamp(name: string, ms: number, event: IcsEvent): string {
	if (event.allDay) {
		return `${name};VALUE=DATE:${utcStamp(ms).slice(0, 8)}`;
	}
	if (event.recurrence && event.timezone !== 'UTC') {
		return `${name};TZID=${event.timezone}:${localStamp(ms, event.timezone)}`;
	}
	return `${name}:${utcStamp(ms)}`;
}

export function toIcs(events: IcsEvent[], name: string): string {
	const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Synq//Calendrier//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(name)}`];
	for (const event of events) {
		lines.push('BEGIN:VEVENT', `UID:${escapeText(event.uid)}`, `DTSTAMP:${utcStamp(event.updatedAt)}`, stamp('DTSTART', event.startsAt, event), stamp('DTEND', event.endsAt, event));
		lines.push(`SUMMARY:${escapeText(event.title)}`);
		if (event.description) {
			lines.push(`DESCRIPTION:${escapeText(event.description)}`);
		}
		if (event.location) {
			lines.push(`LOCATION:${escapeText(event.location)}`);
		}
		if (event.recurrence) {
			const { freq, interval, until } = event.recurrence;
			const end = until === null ? '' : `;UNTIL=${event.allDay ? utcStamp(until).slice(0, 8) : utcStamp(until)}`;
			lines.push(`RRULE:FREQ=${freq.toUpperCase()};INTERVAL=${interval}${end}`);
			for (const skipped of event.exceptions) {
				lines.push(stamp('EXDATE', skipped, event));
			}
		}
		lines.push('END:VEVENT');
	}
	lines.push('END:VCALENDAR');
	return `${lines.map(fold).join('\r\n')}\r\n`;
}

export interface ParsedEvent {
	uid: string;
	title: string;
	description: string;
	location: string;
	startsAt: number;
	endsAt: number;
	allDay: boolean;
	timezone: string;
	recurrence: Recurrence | null;
	exceptions: number[];
}

type Prop = { name: string; params: Record<string, string>; value: string };

const unescapeText = (value: string) => value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === 'n' || char === 'N' ? '\n' : char));

function parseLine(line: string): Prop | null {
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (char === '"') {
			quoted = !quoted;
		} else if (char === ':' && !quoted) {
			const [name = '', ...rest] = line.slice(0, i).split(';');
			const params: Record<string, string> = {};
			for (const param of rest) {
				const eq = param.indexOf('=');
				if (eq > 0) {
					params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replace(/^"|"$/g, '');
				}
			}
			return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
		}
	}
	return null;
}

const DATE_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

function parseDate(value: string, params: Record<string, string>, fallbackTz: string): { ms: number; allDay: boolean; timezone: string } | null {
	const match = DATE_RE.exec(value.trim());
	if (!match) {
		return null;
	}
	const [y, mo, d, h, mi, s] = match.slice(1, 7).map((part) => (part === undefined ? undefined : Number(part)));
	if (h === undefined || params.VALUE === 'DATE') {
		return { ms: Date.UTC(y!, mo! - 1, d!), allDay: true, timezone: 'UTC' };
	}
	// TZID Windows ou inconnu : fuseau de l'utilisateur.
	const timeZone = validTimeZone(params.TZID) ? params.TZID : fallbackTz;
	const ms = match[7] ? Date.UTC(y!, mo! - 1, d!, h, mi!, s!) : zonedTime(timeZone, y!, mo! - 1, d!, h, mi!, s!);
	return Number.isFinite(ms) ? { ms, allDay: false, timezone: timeZone } : null;
}

const DURATION_RE = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

function parseDuration(value: string): number | null {
	const match = DURATION_RE.exec(value.trim());
	if (!match) {
		return null;
	}
	const [w = 0, d = 0, h = 0, m = 0, s = 0] = match.slice(1).map((part) => Number(part ?? 0));
	return (w * 7 + d) * DAY + ((h * 60 + m) * 60 + s) * 1000;
}

const FREQS: Record<string, RecurrenceFreq | undefined> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly' };

// BYDAY, BYMONTHDAY et règles annuelles ignorés : la série devient une occurrence unique.
function parseRule(value: string | undefined, startsAt: number, timezone: string): Recurrence | null {
	if (!value) {
		return null;
	}
	const rule: Record<string, string> = {};
	for (const part of value.split(';')) {
		const [key = '', val = ''] = part.split('=');
		rule[key.toUpperCase()] = val;
	}
	const freq = FREQS[rule.FREQ?.toUpperCase() ?? ''];
	if (!freq || rule.BYDAY || rule.BYMONTHDAY || rule.BYSETPOS) {
		return null;
	}
	const interval = Math.min(99, Math.max(1, Number.parseInt(rule.INTERVAL ?? '1', 10) || 1));
	let until: number | null = null;
	if (rule.UNTIL) {
		until = parseDate(rule.UNTIL, {}, timezone)?.ms ?? null;
	} else if (rule.COUNT) {
		const count = Math.min(1000, Math.max(1, Number.parseInt(rule.COUNT, 10) || 1));
		const starts = occurrences({ startsAt, endsAt: startsAt + 1, timezone, recurrence: { freq, interval, until: null }, exceptions: [] }, startsAt, startsAt + 100 * 366 * DAY, count);
		until = starts.at(-1) ?? startsAt;
	}
	return { freq, interval, until };
}

function toParsed(props: Prop[], fallbackTz: string): ParsedEvent | null {
	const get = (name: string) => props.find((p) => p.name === name);
	if (get('RECURRENCE-ID') || get('STATUS')?.value.toUpperCase() === 'CANCELLED') {
		return null;
	}
	const startProp = get('DTSTART');
	const start = startProp ? parseDate(startProp.value, startProp.params, fallbackTz) : null;
	if (!start) {
		return null;
	}
	const endProp = get('DTEND');
	const end = endProp ? parseDate(endProp.value, endProp.params, fallbackTz) : null;
	const duration = get('DURATION');
	let endsAt = end ? end.ms : duration ? start.ms + (parseDuration(duration.value) ?? 0) : start.ms + (start.allDay ? DAY : 0);
	if (start.allDay) {
		endsAt = Math.max(start.ms + DAY, Math.ceil(endsAt / DAY) * DAY);
	} else if (endsAt < start.ms) {
		endsAt = start.ms;
	}
	const exceptions = props
		.filter((p) => p.name === 'EXDATE')
		.flatMap((p) => p.value.split(',').map((v) => parseDate(v, p.params, start.timezone)?.ms))
		.filter((ms): ms is number => ms !== undefined);
	return {
		uid: get('UID')?.value.trim().slice(0, 255) ?? '',
		title: unescapeText(get('SUMMARY')?.value ?? '').trim(),
		description: unescapeText(get('DESCRIPTION')?.value ?? '').trim(),
		location: unescapeText(get('LOCATION')?.value ?? '').trim(),
		startsAt: start.ms,
		endsAt,
		allDay: start.allDay,
		timezone: start.timezone,
		recurrence: parseRule(get('RRULE')?.value, start.ms, start.timezone),
		exceptions,
	};
}

export function parseIcs(text: string, fallbackTz: string, limit: number): ParsedEvent[] {
	const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
	const out: ParsedEvent[] = [];
	let current: Prop[] | null = null;
	// Composants imbriqués (VALARM) ignorés.
	let depth = 0;
	for (const raw of lines) {
		const line = raw.trimEnd();
		const upper = line.toUpperCase();
		if (upper === 'BEGIN:VEVENT') {
			current = [];
			depth = 0;
		} else if (upper === 'END:VEVENT') {
			const parsed = current ? toParsed(current, fallbackTz) : null;
			if (parsed) {
				out.push(parsed);
			}
			current = null;
			if (out.length >= limit) {
				break;
			}
		} else if (current && upper.startsWith('BEGIN:')) {
			depth++;
		} else if (current && upper.startsWith('END:')) {
			depth--;
		} else if (current && depth === 0) {
			const prop = parseLine(line);
			if (prop) {
				current.push(prop);
			}
		}
	}
	return out;
}
