import type { Message } from './types';

export interface Reminder {
	id: number;
	// Nul : note personnelle créée par /rappel.
	messageId: number | null;
	text: string;
	// Nul : entrée « Plus tard » sans échéance.
	dueAt: number | null;
	firedAt: number | null;
	doneAt: number | null;
	createdAt: number;
}

// Entrée du panneau « Plus tard » : message enregistré, rappel, ou les deux fusionnés.
export interface LaterItem {
	key: string;
	messageId: number | null;
	message: Message | null;
	// Message supprimé ou devenu invisible : rien de son contenu n'est renvoyé.
	unavailable: boolean;
	savedAt: number | null;
	reminder: Reminder | null;
	at: number;
}

export interface ReminderInput {
	messageId?: number | null;
	text?: string;
	dueAt: number | null;
	done?: boolean;
}

export interface ReminderPatch {
	dueAt?: number | null;
	done?: boolean;
}

export const REMINDER_LIMITS = {
	text: 500,
	perUser: 200,
	horizon: 366 * 24 * 3600 * 1000,
} as const;

// Lien porté par la notification : sert au report depuis le centre de notifications.
export const reminderLink = (workspaceId: string, id: number, target?: { channelId: string; id: number }) =>
	target ? `/w/${workspaceId}/${target.channelId}?m=${target.id}&rappel=${id}` : `/w/${workspaceId}?rappel=${id}`;

export const reminderIdOf = (link: string | null): number | null => {
	const id = link ? /[?&]rappel=(\d+)/.exec(link)?.[1] : undefined;
	return id ? Number(id) : null;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const at = (base: Date, days: number, hours: number, minutes = 0): number => {
	const d = new Date(base);
	d.setDate(d.getDate() + days);
	d.setHours(hours, minutes, 0, 0);
	return d.getTime();
};

const nextMonday = (now: Date) => at(now, ((8 - now.getDay()) % 7) || 7, 9);

export const quickReminders = (now: Date): Array<{ key: string; label: string; at: number }> => [
	{ key: '20m', label: 'Dans 20 min', at: now.getTime() + 20 * MINUTE },
	{ key: '1h', label: 'Dans 1 h', at: now.getTime() + HOUR },
	{ key: '3h', label: 'Dans 3 h', at: now.getTime() + 3 * HOUR },
	{ key: 'tomorrow', label: 'Demain à 9 h', at: at(now, 1, 9) },
	{ key: 'monday', label: 'Lundi prochain à 9 h', at: nextMonday(now) },
];

export const snoozeChoices = (now: Date): Array<{ key: string; label: string; at: number }> => [
	{ key: '20m', label: '20 min', at: now.getTime() + 20 * MINUTE },
	{ key: '1h', label: '1 h', at: now.getTime() + HOUR },
	{ key: 'tomorrow', label: 'Demain', at: at(now, 1, 9) },
];

const NUMBERS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, dix: 10, quinze: 15, vingt: 20, trente: 30 };
const UNITS: Array<[RegExp, number]> = [
	[/^(minutes?|mins?|mn|m)$/, MINUTE],
	[/^(heures?|h)$/, HOUR],
	[/^(jours?|j)$/, 24 * HOUR],
	[/^(semaines?|sem)$/, 7 * 24 * HOUR],
];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const PERIODS: Record<string, number> = { matin: 9, midi: 12, 'apres-midi': 14, 'apres midi': 14, soir: 18 };

const RELATIVE = /^\s*dans\s+(?:(une\s+)?demi-?\s?heure|un\s+quart\s+d'heure|(\d+|une?|deux|trois|quatre|cinq|six|dix|quinze|vingt|trente)\s*(minutes?|mins?|mn|heures?|h|jours?|j|semaines?|sem|m)(?![a-z]))/;
const DAY_WORD = new RegExp(`^\\s*(aujourd'hui|ce soir|ce matin|cet apres-midi|apres-demain|demain|${WEEKDAYS.join('|')})(\\s+prochain)?(?![a-z])`);
const DAY_NUMERIC = /^\s*(?:le\s+)?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?(?![\d/])/;
const DAY_NAMED = new RegExp(`^\\s*(?:le\\s+)?(\\d{1,2})(?:er)?\\s+(${MONTHS.join('|')})(?:\\s+(\\d{4}))?(?![a-z])`);
const PERIOD = /^\s*(?:dans\s+l'|l')?(matin|midi|apres-midi|apres midi|soir)(?![a-z])/;
const TIME = /^\s*(?:a\s+|vers\s+)?(?:(\d{1,2})\s*(?:h|:)\s*(\d{2})?|(midi|minuit))(?![a-z\d])/;

// Accents retirés caractère par caractère : les index restent ceux du texte d'origine.
const fold = (s: string) =>
	[...s]
		.map((ch) => {
			const folded = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
			return folded.length === ch.length ? folded : ch;
		})
		.join('')
		.replace(/[’‘]/g, "'");

/**
 * Analyse « demain 9h relancer le devis », « dans 2 h … », « lundi … », « le 12/11 à 15h … ».
 * Heure locale ; jour sans heure = 9 h. Renvoie null sans échéance reconnue.
 */
export function parseReminder(input: string, now = new Date()): { dueAt: number; text: string } | null {
	const source = input.normalize('NFC');
	const s = fold(source);
	let pos = 0;
	const eat = (re: RegExp) => {
		const m = re.exec(s.slice(pos));
		if (m) {
			pos += m[0].length;
		}
		return m;
	};

	const rel = eat(RELATIVE);
	if (rel) {
		let delta = 30 * MINUTE;
		if (rel[0].includes('quart')) {
			delta = 15 * MINUTE;
		} else if (rel[2]) {
			const n = /^\d+$/.test(rel[2]) ? Number(rel[2]) : (NUMBERS[rel[2]] ?? 1);
			delta = n * (UNITS.find(([re]) => re.test(rel[3]!))?.[1] ?? MINUTE);
		}
		return finish(now.getTime() + delta);
	}

	let day: Date | null = null;
	let hour: number | null = null;
	let minute = 0;
	for (let round = 0; round < 3; round++) {
		let m: RegExpExecArray | null;
		if (!day && (m = eat(DAY_WORD))) {
			const word = m[1]!;
			const offset = word === 'demain' ? 1 : word === 'apres-demain' ? 2 : word.startsWith('ce') || word === "aujourd'hui" ? 0 : ((WEEKDAYS.indexOf(word) - now.getDay() + 7) % 7) || 7;
			day = new Date(at(now, offset, 0));
			if (word === 'ce soir') {
				hour ??= 18;
			} else if (word === 'ce matin') {
				hour ??= 9;
			} else if (word === 'cet apres-midi') {
				hour ??= 14;
			}
		} else if (!day && (m = eat(DAY_NUMERIC) ?? eat(DAY_NAMED))) {
			const month = /^\d+$/.test(m[2]!) ? Number(m[2]) - 1 : MONTHS.indexOf(m[2]!);
			const year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getFullYear();
			day = new Date(year, month, Number(m[1]));
			if (!m[3] && at(day, 0, 23, 59) < now.getTime()) {
				day.setFullYear(year + 1);
			}
		} else if (hour === null && (m = eat(PERIOD))) {
			hour = PERIODS[m[1]!]!;
		} else if (hour === null && (m = eat(TIME))) {
			hour = m[3] ? (m[3] === 'midi' ? 12 : 0) : Number(m[1]);
			minute = m[2] ? Number(m[2]) : 0;
			if (hour > 23 || minute > 59) {
				return null;
			}
		} else {
			break;
		}
	}
	if (!day && hour === null) {
		return null;
	}
	if (!day) {
		const today = at(now, 0, hour!, minute);
		return finish(today > now.getTime() ? today : at(now, 1, hour!, minute));
	}
	return finish(at(day, 0, hour ?? 9, minute));

	function finish(dueAt: number) {
		const text = source
			.slice(pos)
			.replace(/^\s*[:,-]?\s*/, '')
			.trim();
		return { dueAt, text };
	}
}
