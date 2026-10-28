import type { Attachment, Message } from './types';

export interface Draft {
	channelId: string;
	// 0 = composer du salon, sinon id du message racine du fil.
	threadRoot: number;
	body: string;
	attachments: Attachment[];
	updatedAt: number;
}

export type ScheduledStatus = 'pending' | 'failed';

export interface ScheduledMessage {
	id: number;
	channelId: string;
	threadRoot: number;
	body: string;
	attachments: Attachment[];
	replyTo: number | null;
	sendAt: number;
	status: ScheduledStatus;
	// Raison du dernier échec d'envoi.
	error: string | null;
	createdAt: number;
}

export interface SentPage {
	messages: Message[];
	// Curseur `before` de la page suivante, nul en fin de liste.
	next: number | null;
}

export const DRAFT_LIMITS = {
	scheduledPerUser: 100,
	// Au-delà, la programmation est refusée.
	scheduleAhead: 120 * 24 * 3600 * 1000,
	sentPage: 30,
	// Délai d'inactivité avant sauvegarde côté serveur.
	saveDelay: 1000,
} as const;
