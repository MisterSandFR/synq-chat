// `message` : tout message d'un salon réglé sur « tout » ; les autres sources se branchent via `notify`.
export type NotificationKind = 'mention' | 'reply' | 'message' | 'dm' | 'thread' | 'reaction' | 'calendar' | 'mail' | 'scheduled';

export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['mention', 'reply', 'message', 'dm', 'thread', 'reaction', 'calendar', 'mail', 'scheduled'];

export interface NotificationItem {
	id: number;
	kind: NotificationKind;
	// Nul pour les sources hors salon (calendrier, mail).
	channelId: string | null;
	messageId: number | null;
	actorId: string | null;
	title: string;
	body: string;
	// Lien interne facultatif quand la cible n'est pas un message.
	link: string | null;
	createdAt: number;
	readAt: number | null;
}

export type NotificationFilter = 'all' | 'mentions' | 'unread';

export interface NotificationPage {
	items: NotificationItem[];
	// Curseur `before` de la page suivante, nul en fin de liste.
	next: number | null;
	unread: number;
}

// `mentions` (défaut) : mentions, réponses et sources directes ; `none` coupe tout le salon.
export type NotifyLevel = 'all' | 'mentions' | 'none';

export const NOTIFY_LEVELS: readonly NotifyLevel[] = ['all', 'mentions', 'none'];

export const DEFAULT_NOTIFY_LEVEL: NotifyLevel = 'mentions';

export interface NotifyInput {
	userId: string;
	kind: NotificationKind;
	channelId?: string | null;
	messageId?: number | null;
	actorId?: string | null;
	title: string;
	body?: string;
	link?: string | null;
}

export const NOTIFICATION_LIMITS = {
	page: 30,
	titleLength: 120,
	bodyLength: 200,
	// Plafond par utilisateur ; les plus anciennes sautent.
	keep: 500,
} as const;
