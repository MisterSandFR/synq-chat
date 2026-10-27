import { P } from './permissions';
import type { Message } from './types';

// Participants, auteur compris.
export const DM_MAX_MEMBERS = 9;

// Hors grades : seuls les participants voient, écrivent et appellent.
export const DM_PERMS = P.VIEW_CHANNEL | P.SEND_MESSAGES | P.ATTACH_FILES | P.VOICE_CONNECT | P.VOICE_SPEAK | P.VOICE_VIDEO | P.VOICE_SCREEN;

export interface ThreadSummary {
	count: number;
	lastAt: number;
}

export interface DirectLast {
	userId: string;
	body: string;
	createdAt: number;
}

export interface DirectConversation {
	// Identique à l'id du salon `kind = 'dm'`.
	id: string;
	memberIds: string[];
	// Groupe : nom facultatif, participants modifiables.
	group: boolean;
	name: string;
	createdAt: number;
	last: DirectLast | null;
}

export interface DirectChange {
	add?: string[];
	remove?: string;
	name?: string;
}

export interface ThreadView {
	root: Message;
	replies: Message[];
	following: boolean;
}

export interface FollowedThread {
	root: Message;
	unread: number;
}
