import type { NotificationItem } from './notifications';
import type { PinInfo, Reaction } from './chat';
import type { DirectConversation, ThreadSummary } from './dm-threads';
import type { CalendarReminder } from './calendar';
import type { Override } from './permissions';

export interface Actor {
	id: string;
	name: string;
	owner: boolean;
	// Toujours avec le grade par défaut.
	grades: string[];
	perms: number;
	// Position du plus haut grade ; le propriétaire est au-dessus de tout.
	top: number;
}

export interface Grade {
	id: string;
	name: string;
	color: string;
	position: number;
	permissions: number;
}

export type ChannelOverrides = Record<string, Override>;

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
	owner: boolean;
	accent: string;
}

export interface Member {
	id: string;
	name: string;
	avatarUrl: string | null;
	owner: boolean;
	gradeIds: string[];
}

export interface WorkspaceDetail {
	id: string;
	name: string;
	accent: string;
	owner: boolean;
	perms: number;
	top: number;
	grades: Grade[];
	members: Member[];
}

export type ChannelKind = 'text' | 'voice' | 'dm';

export interface Channel {
	id: string;
	name: string;
	kind: ChannelKind;
	topic: string;
	// Nom de la catégorie, vide sans catégorie.
	category: string;
	categoryId: string | null;
	synced: boolean;
	readOnly: boolean;
	userLimit: number;
	position: number;
	createdAt: number;
}

export interface ChannelInput {
	name?: string;
	kind?: ChannelKind;
	topic?: string;
	category?: string;
	categoryId?: string | null;
	readOnly?: boolean;
	userLimit?: number;
	position?: number;
}

export interface Attachment {
	key: string;
	name: string;
	size: number;
	type: string;
}

export interface MessageRef {
	id: number;
	userId: string | null;
	body: string | null;
}

export interface Message {
	id: number;
	channelId: string;
	userId: string;
	body: string;
	attachments: Attachment[];
	replyTo: MessageRef | null;
	createdAt: number;
	editedAt: number | null;
	// Réponse de fil : id du message racine.
	threadRoot?: number | null;
	thread?: ThreadSummary | null;
}

export interface MessagePage {
	messages: Message[];
	hasMore: boolean;
	hasNewer: boolean;
}

export interface SearchHit {
	message: Message;
	snippet: string;
}

export interface VoiceParticipant {
	userId: string;
	// Nul tant que rien n'est publié.
	sessionId: string | null;
	tracks: string[];
	muted: boolean;
	deafened: boolean;
	video: boolean;
	screen: boolean;
}

export interface VoiceFlags {
	muted?: boolean;
	deafened?: boolean;
	video?: boolean;
	screen?: boolean;
}

export interface DriveFolder {
	id: string;
	channelId: string;
	parentId: string | null;
	name: string;
	createdBy: string;
	createdAt: number;
}

export interface DriveFile {
	id: string;
	channelId: string;
	folderId: string | null;
	key: string;
	name: string;
	size: number;
	type: string;
	uploadedBy: string;
	messageId: number | null;
	createdAt: number;
}

export interface DriveListing {
	folders: DriveFolder[];
	files: DriveFile[];
	path: DriveFolder[];
}

export type ServerEvent =
	| {
			t: 'hello';
			connId: string;
			channels: Channel[];
			perms: Record<string, number>;
			online: string[];
			unread: Record<string, number>;
			mentions: Record<string, number>;
			voice: Record<string, VoiceParticipant[]>;
	  }
	| {
			t: 'access';
			channels: Channel[];
			perms: Record<string, number>;
			unread: Record<string, number>;
			mentions: Record<string, number>;
			voice: Record<string, VoiceParticipant[]>;
	  }
	| { t: 'voice_force_mute'; by: string }
	| { t: 'voice_move'; channelId: string; by: string }
	| { t: 'message'; message: Message }
	| { t: 'message_updated'; message: Message }
	| { t: 'message_deleted'; channelId: string; id: number }
	| { t: 'channel_upsert'; channel: Channel; perms: number }
	| { t: 'channel_deleted'; id: string }
	| { t: 'presence'; userId: string; online: boolean }
	| { t: 'typing'; channelId: string; userId: string }
	| { t: 'voice'; channelId: string; participants: VoiceParticipant[] }
	| { t: 'voice_ended'; reason: string }
	| { t: 'drive'; channelId: string }
	| { t: 'members_changed' }
	| { t: 'workspace_deleted' }
	| { t: 'notification'; notification: NotificationItem; unread: number }
	| { t: 'notifications_unread'; unread: number }
	| { t: 'commands_changed' }
	| { t: 'announcement'; channelId: string; text: string; updatedBy: string | null; updatedAt: number | null }
	| { t: 'reactions'; channelId: string; messageId: number; reactions: Reaction[] }
	| { t: 'pinned'; channelId: string; messageId: number; pinned: PinInfo | null }
	| { t: 'dm'; conversation: DirectConversation }
	| { t: 'thread'; channelId: string; rootId: number; message: Message; root: Message }
	| { t: 'call_ring'; channelId: string; by: string }
	| { t: 'calendar_reminder'; reminder: CalendarReminder };

export type ClientEvent =
	| { t: 'typing'; channelId: string }
	| { t: 'read'; channelId: string }
	| ({ t: 'voice_update' } & VoiceFlags);

// Suffixe numérique : chaque réactivation caméra ou écran publie une piste neuve.
export const VOICE_TRACK_RE = /^(mic|cam|screen|screen-audio)(-\d{1,6})?$/;

export const ACCENTS = ['#6A4BFF', '#2563EB', '#0F8A6A', '#C84B1F', '#C0266D', '#1C1D21'] as const;

export const LIMITS = {
	messageLength: 4000,
	fileSize: 50 * 1024 * 1024,
	nameLength: 64,
	channelNameLength: 40,
	topicLength: 200,
	categoryLength: 32,
	userLimit: 99,
} as const;

const MENTION_RE = /<@([0-9a-f-]{36})>/g;

export const mentionedUsers = (body: string) => [...new Set([...body.matchAll(MENTION_RE)].map((m) => m[1]!))];
