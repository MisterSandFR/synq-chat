export const GUEST_INVITE_TTL = 7 * 24 * 3600 * 1000;
export const GUEST_SESSION_TTL = 7 * 24 * 3600 * 1000;
export const GUEST_PENDING_MAX = 20;

export type GuestStatus = 'pending' | 'joined' | 'revoked' | 'expired';

export interface GuestInvite {
	id: string;
	email: string;
	status: GuestStatus;
	// Compte invité une fois le lien utilisé.
	userId: string | null;
	createdBy: string;
	expiresAt: number;
	createdAt: number;
}

export interface GuestInviteList {
	invites: GuestInvite[];
	// Boîte mail personnelle configurée : envoi du lien possible.
	canEmail: boolean;
}

export interface GuestInviteCreated {
	invite: GuestInvite;
	// Affiché une seule fois : seul le hash est conservé.
	link: string;
	emailed: boolean;
	mailError: string | null;
}

export interface GuestLanding {
	workspaceName: string;
	conversationName: string;
	inviterName: string;
	email: string;
	joined: boolean;
}

export interface GuestJoined {
	workspaceId: string;
	channelId: string;
}
