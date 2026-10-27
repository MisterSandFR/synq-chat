import type { Message } from './types';

export type UserStatus = 'online' | 'away' | 'busy' | 'invisible';

// Vu par les autres : un invisible apparaît hors ligne.
export type Presence = UserStatus | 'offline';

export const USER_STATUSES: Array<{ value: UserStatus; label: string; hint: string }> = [
	{ value: 'online', label: 'En ligne', hint: 'Disponible.' },
	{ value: 'away', label: 'Absent', hint: 'Activé aussi après 10 minutes d’inactivité.' },
	{ value: 'busy', label: 'Occupé', hint: 'Tu ne veux pas être dérangé.' },
	{ value: 'invisible', label: 'Invisible', hint: 'Tu apparais hors ligne.' },
];

export const PRESENCE_LABEL: Record<Presence, string> = { online: 'En ligne', away: 'Absent', busy: 'Occupé', invisible: 'Invisible', offline: 'Hors ligne' };

export interface Profile {
	userId: string;
	status: Presence;
	statusText: string;
	statusUntil: number | null;
	bio: string;
	// Vide : fuseau du navigateur.
	timezone: string;
}

export interface ProfileInput {
	status?: UserStatus;
	statusText?: string;
	statusUntil?: number | null;
	bio?: string;
	timezone?: string;
}

export interface SavedMessage {
	message: Message;
	savedAt: number;
}

export interface Announcement {
	channelId: string;
	text: string;
	updatedBy: string | null;
	updatedAt: number | null;
}

export const RC_LIMITS = {
	statusText: 100,
	bio: 300,
	announcement: 500,
	avatarSize: 2 * 1024 * 1024,
	saved: 200,
} as const;

export const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const AWAY_AFTER = 10 * 60 * 1000;

const EVERYONE_RE = /(?:^|[^\w@<])@(all|here)\b/g;

export const everyoneMentions = (body: string) => new Set([...body.matchAll(EVERYONE_RE)].map((m) => m[1] as 'all' | 'here'));

export interface ForwardRef {
	id: number;
	channelId: string;
	userId: string;
	body: string;
	files: number;
	createdAt: number;
}

declare module './types' {
	interface Message {
		forward?: ForwardRef;
	}
}

export interface Webhook {
	id: string;
	channelId: string;
	name: string;
	createdBy: string;
	createdAt: number;
	lastUsedAt: number | null;
}

// URL secrète : renvoyée seulement à la création et à la rotation.
export interface WebhookWithUrl extends Webhook {
	url: string;
}

export interface WebhookPayload {
	text: string;
	username?: string;
	avatar?: string;
}

export const FORWARD_EXCERPT = 500;

export const WEBHOOK_LIMITS = { perChannel: 10, name: 32 } as const;
