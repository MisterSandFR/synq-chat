import type { Poll } from '../../../shared/polls';

export const POLL_EVENT = 'synq:poll';

export type PollEventDetail = { messageId: number; poll: Poll };

// Dernier « mes votes » connu : les résumés diffusés à tout le salon n'en portent pas.
const mineByMessage = new Map<number, string[]>();

export function rememberMine(messageId: number, poll: Poll): string[] | null {
	if (poll.mine) {
		mineByMessage.set(messageId, poll.mine);
	}
	return poll.mine ?? mineByMessage.get(messageId) ?? null;
}

export const publishPoll = (detail: PollEventDetail) => window.dispatchEvent(new CustomEvent<PollEventDetail>(POLL_EVENT, { detail }));
