import type { MailAddress, MailMessage } from '../../shared/mail';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fullFormat = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const longFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const startOfDay = (value: number) => {
	const date = new Date(value);
	date.setHours(0, 0, 0, 0);
	return date.getTime();
};

export function relativeDate(value: number, now = Date.now()): string {
	const today = startOfDay(now);
	if (value >= today) {
		return timeFormat.format(value);
	}
	if (value >= today - DAY) {
		return 'Hier';
	}
	if (value >= today - 6 * DAY) {
		return weekdayFormat.format(value);
	}
	return new Date(value).getFullYear() === new Date(now).getFullYear() ? dayFormat.format(value) : fullFormat.format(value);
}

export const longDate = (value: number) => longFormat.format(value);

export type SnoozeChoice = { key: string; label: string; at: number };

export function snoozeChoices(now = Date.now()): SnoozeChoice[] {
	const later = new Date(now + 3 * HOUR);
	later.setMinutes(0, 0, 0);
	later.setHours(later.getHours() + 1);
	const tomorrow = new Date(startOfDay(now) + DAY);
	tomorrow.setHours(8);
	const monday = new Date(startOfDay(now));
	monday.setDate(monday.getDate() + (((8 - monday.getDay()) % 7) || 7));
	monday.setHours(8);
	const choices: SnoozeChoice[] = [];
	// Au-delà de 21 h, « plus tard aujourd'hui » tomberait demain.
	if (later.getTime() < startOfDay(now) + 21 * HOUR) {
		choices.push({ key: 'later', label: 'Plus tard aujourd’hui', at: later.getTime() });
	}
	choices.push({ key: 'tomorrow', label: 'Demain', at: tomorrow.getTime() }, { key: 'week', label: 'Semaine prochaine', at: monday.getTime() });
	return choices;
}

export const addressLabel = (address: MailAddress) => address.name || address.addr;

export const formatAddress = (address: MailAddress) => (address.name ? `${address.name} <${address.addr}>` : address.addr);

// « Nom <a@b>, c@d » : séparateurs virgule ou point-virgule.
export function parseAddresses(input: string): MailAddress[] {
	const out: MailAddress[] = [];
	for (const part of input.split(/[,;]/)) {
		const text = part.trim();
		if (!text) {
			continue;
		}
		const match = text.match(/^(.*)<([^>]+)>$/);
		const addr = (match ? match[2]! : text).trim();
		const name = match ? match[1]!.trim().replace(/^"|"$/g, '') : '';
		out.push({ name, addr });
	}
	return out;
}

export const validAddress = (addr: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(addr);

const prefixed = (prefix: string, subject: string) => (new RegExp(`^${prefix}\\s*:`, 'i').test(subject.trim()) ? subject.trim() : `${prefix}: ${subject.trim()}`);

export const replySubject = (subject: string) => prefixed('Re', subject || '(sans objet)');

export const forwardSubject = (subject: string) => prefixed('Fwd', subject || '(sans objet)');

// Destinataires de réponse : l'expéditeur pour un entrant, les destinataires pour un sortant.
export function replyTargets(message: MailMessage, ownAddress: string, all: boolean): { to: MailAddress[]; cc: MailAddress[] } {
	const own = ownAddress.toLowerCase();
	const to = message.direction === 'in' ? [{ name: message.fromName, addr: message.fromAddr }] : (message.toList ?? []);
	if (!all) {
		return { to, cc: [] };
	}
	const seen = new Set(to.map((address) => address.addr.toLowerCase()));
	const cc = [...(message.direction === 'in' ? (message.toList ?? []) : []), ...(message.ccList ?? [])].filter((address) => {
		const key = address.addr.toLowerCase();
		if (key === own || seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
	return { to, cc };
}

