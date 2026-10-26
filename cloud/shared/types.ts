export type Role = 'owner' | 'admin' | 'member';

export interface User {
	id: string;
	email: string;
	name: string;
	avatarUrl: string | null;
}

export interface Me {
	user: User;
	workspaces: WorkspaceSummary[];
	identities: string[];
	hasPassword: boolean;
}

export interface WorkspaceSummary {
	id: string;
	name: string;
	role: Role;
}

export interface Member {
	id: string;
	name: string;
	avatarUrl: string | null;
	role: Role;
}

export interface WorkspaceDetail {
	id: string;
	name: string;
	role: Role;
	members: Member[];
}

export interface Channel {
	id: string;
	name: string;
	topic: string;
	category: string;
	readOnly: boolean;
	position: number;
	createdAt: number;
}

export interface ChannelInput {
	name?: string;
	topic?: string;
	category?: string;
	readOnly?: boolean;
	position?: number;
}

export interface Attachment {
	key: string;
	name: string;
	size: number;
	type: string;
}

export interface Message {
	id: number;
	channelId: string;
	userId: string;
	body: string;
	attachment: Attachment | null;
	createdAt: number;
	editedAt: number | null;
}

export interface MessagePage {
	messages: Message[];
	hasMore: boolean;
}

export type ServerEvent =
	| { t: 'hello'; channels: Channel[]; online: string[]; unread: Record<string, number> }
	| { t: 'message'; message: Message }
	| { t: 'message_updated'; message: Message }
	| { t: 'message_deleted'; channelId: string; id: number }
	| { t: 'channel_upsert'; channel: Channel }
	| { t: 'channel_deleted'; id: string }
	| { t: 'presence'; userId: string; online: boolean }
	| { t: 'typing'; channelId: string; userId: string }
	| { t: 'members_changed' }
	| { t: 'workspace_deleted' };

export type ClientEvent = { t: 'typing'; channelId: string } | { t: 'read'; channelId: string };

export const LIMITS = {
	messageLength: 4000,
	fileSize: 10 * 1024 * 1024,
	nameLength: 64,
	channelNameLength: 40,
	topicLength: 200,
	categoryLength: 32,
} as const;
