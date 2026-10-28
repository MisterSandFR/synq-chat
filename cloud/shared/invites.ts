const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Durées proposées ; null = jamais.
export const INVITE_EXPIRIES: readonly number[] = [30 * MINUTE, HOUR, 6 * HOUR, 12 * HOUR, DAY, 7 * DAY];
export const INVITE_MAX_USES: readonly number[] = [1, 5, 10, 25, 50, 100];
export const DEFAULT_INVITE_TTL = 7 * DAY;
export const INVITE_LABEL_MAX = 100;

export type InviteState = 'valid' | 'expired' | 'revoked' | 'exhausted';

export interface Invite {
	code: string;
	createdBy: string;
	creatorName: string;
	createdAt: number;
	expiresAt: number | null;
	maxUses: number | null;
	uses: number;
	channelId: string | null;
	gradeIds: string[];
	temporary: boolean;
	label: string;
	revokedAt: number | null;
	state: InviteState;
}

export interface InviteInput {
	expiresIn: number | null;
	maxUses: number | null;
	channelId: string | null;
	gradeIds: string[];
	temporary: boolean;
	label: string;
}

export interface InvitePreview {
	workspaceId: string;
	workspaceName: string;
	accent: string;
	logoUrl: string | null;
	memberCount: number;
	inviterName: string;
	expiresAt: number | null;
	state: InviteState;
	member: boolean;
}

export interface InviteJoin {
	workspaceId: string;
	channelId: string | null;
}

export function inviteState(row: { revoked_at: number | null; expires_at: number | null; max_uses: number | null; uses: number }, now: number): InviteState {
	if (row.revoked_at !== null) {
		return 'revoked';
	}
	if (row.expires_at !== null && row.expires_at <= now) {
		return 'expired';
	}
	return row.max_uses !== null && row.uses >= row.max_uses ? 'exhausted' : 'valid';
}
