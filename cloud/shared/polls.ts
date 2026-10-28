export const POLL_LIMITS = { question: 300, option: 100, minOptions: 2, maxOptions: 10, votersShown: 50 } as const;

const HOUR = 3_600_000;

// null = sans fin.
export const POLL_DURATIONS: ReadonlyArray<{ value: number | null; label: string }> = [
	{ value: HOUR, label: '1 heure' },
	{ value: 4 * HOUR, label: '4 heures' },
	{ value: 8 * HOUR, label: '8 heures' },
	{ value: 24 * HOUR, label: '24 heures' },
	{ value: 72 * HOUR, label: '3 jours' },
	{ value: 168 * HOUR, label: '1 semaine' },
	{ value: null, label: 'Sans fin' },
];

export interface PollOption {
	id: string;
	text: string;
	emoji: string;
	count: number;
	// Absent quand le sondage est anonyme.
	voters?: string[];
}

export interface Poll {
	question: string;
	options: PollOption[];
	multiple: boolean;
	anonymous: boolean;
	allowAdd: boolean;
	closesAt: number | null;
	closedAt: number | null;
	// Votants distincts.
	voters: number;
	// Options choisies par le lecteur ; null dans un évènement diffusé à tout le salon.
	mine: string[] | null;
}

export interface PollOptionInput {
	text: string;
	emoji?: string;
}

export interface PollInput {
	question: string;
	options: PollOptionInput[];
	multiple?: boolean;
	anonymous?: boolean;
	allowAdd?: boolean;
	duration?: number | null;
	threadRoot?: number | null;
}

export const pollClosed = (poll: Pick<Poll, 'closesAt' | 'closedAt'>, now = Date.now()) => poll.closedAt !== null || (poll.closesAt !== null && poll.closesAt <= now);

// Ex aequo compris ; aucun gagnant sans vote.
export function pollWinners(poll: Poll): string[] {
	const top = Math.max(0, ...poll.options.map((o) => o.count));
	return top ? poll.options.filter((o) => o.count === top).map((o) => o.id) : [];
}
