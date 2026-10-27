import type { EventInput } from './calendar';
import type { Message } from './types';

export const AI_CHAT_LIMITS = { catchup: 150, question: 500, eventText: 1000, sources: 12 } as const;

export type AiMessageAction = 'translate' | 'summary' | 'reply' | 'thread-summary';

export type AiLang = 'fr' | 'en' | 'es' | 'de' | 'it';

export interface AiCatchupItem {
	text: string;
	messageId: number | null;
}

export interface AiCatchup {
	items: AiCatchupItem[];
	count: number;
}

// Citations `[n]` du texte : `sources[n - 1]`.
export interface AiAnswer {
	text: string;
	sources: Message[];
}

export interface AiParseEventInput {
	text: string;
	timezone: string;
	now: number;
	workspaceId?: string | null;
}

export type AiParsedEvent = Partial<EventInput>;
