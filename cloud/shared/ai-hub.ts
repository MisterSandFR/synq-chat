import type { AbsenceInput } from './absences';
import type { EventInput } from './calendar';

export const AI_HUB_LIMITS = { text: 1000, title: 80, perSource: 4, conversations: 50, turns: 60, cards: 12, cardTitle: 200, pageBody: 12_000 } as const;

export type AiSourceKind = 'message' | 'mail' | 'event' | 'page' | 'item';

export interface AiSource {
	kind: AiSourceKind;
	id: string;
	title: string;
	snippet: string;
	href: string;
	at: number | null;
}

// Ce que la personne regarde à l'ouverture du panneau.
export interface AiHubContext {
	workspaceId: string | null;
	channelId: string | null;
	threadId: number | null;
	mailThreadId: string | null;
	pageId: string | null;
	listId: string | null;
	day: string | null;
}

export type AiIntent = 'ask' | 'summarize' | 'cards' | 'event' | 'page' | 'mail_reply' | 'absence';

export const AI_INTENTS: AiIntent[] = ['ask', 'summarize', 'cards', 'event', 'page', 'mail_reply', 'absence'];

export interface AiCard {
	title: string;
	description: string;
}

export type AiAction =
	| { kind: 'cards'; workspaceId: string; listId: string; listTitle: string; cards: AiCard[] }
	| { kind: 'event'; event: Partial<EventInput> }
	| { kind: 'page'; workspaceId: string; title: string; body: string }
	| { kind: 'mail_reply'; mailboxId: string; threadId: string; subject: string; to: string; text: string }
	| { kind: 'absence'; absence: Partial<AbsenceInput> };

export interface AiDone {
	label: string;
	href: string | null;
}

export interface AiTurn {
	id: number;
	role: 'user' | 'assistant';
	text: string;
	sources: AiSource[];
	action: AiAction | null;
	done: AiDone | null;
	createdAt: number;
}

export interface AiConversation {
	id: string;
	title: string;
	updatedAt: number;
}

export interface AiConversationDetail extends AiConversation {
	turns: AiTurn[];
}

export interface AiTurnInput {
	conversationId: string | null;
	text: string;
	intent: AiIntent;
	context: Partial<AiHubContext>;
	timezone: string;
	listId: string | null;
}

// Tour de la personne puis réponse de l'assistant.
export interface AiTurnReply {
	conversation: AiConversation;
	turns: AiTurn[];
}

export interface AiExecuteInput {
	conversationId: string;
	turnId: number;
	action: AiAction;
}
