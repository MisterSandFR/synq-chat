export type MailStatus = 'open' | 'done';

export interface MailAccess {
	owner: boolean;
	view: boolean;
	// Répondre, assigner, changer le statut, annoter.
	reply: boolean;
	// Partager et rattacher aux salons.
	manage: boolean;
}

export interface MailShare {
	workspaceId: string;
	workspaceName: string;
	channelIds: string[];
}

export interface MailboxConfig {
	imapHost: string;
	imapPort: number;
	smtpHost: string;
	smtpPort: number;
	username: string;
}

export interface MailboxInput extends MailboxConfig {
	name: string;
	address: string;
	// Absent en modification : mot de passe inchangé.
	password?: string;
}

export interface MailboxInfo {
	id: string;
	name: string;
	address: string;
	ownerId: string;
	ownerName: string;
	access: MailAccess;
	shares: MailShare[];
	syncedAt: number | null;
	syncError: string | null;
	// Propriétaire seulement ; jamais le mot de passe.
	config: MailboxConfig | null;
}

export interface MailThread {
	id: string;
	mailboxId: string;
	subject: string;
	snippet: string;
	from: string;
	status: MailStatus;
	assigneeId: string | null;
	assigneeName: string | null;
	messageCount: number;
	lastAt: number;
}

export interface MailAttachment {
	index: number;
	name: string;
	size: number;
	type: string;
}

export interface MailMessage {
	id: string;
	direction: 'in' | 'out';
	fromName: string;
	fromAddr: string;
	to: string;
	cc: string;
	subject: string;
	date: number;
	body: string;
	attachments: MailAttachment[];
	sentBy: string | null;
}

export interface MailNote {
	id: string;
	authorId: string | null;
	authorName: string;
	body: string;
	createdAt: number;
}

export interface MailThreadDetail {
	thread: MailThread;
	messages: MailMessage[];
	notes: MailNote[];
	access: MailAccess;
}

export interface MailTestResult {
	imap: string | null;
	smtp: string | null;
}

export const MAIL_PORTS = { imap: [993], smtp: [465, 587] } as const;

export const MAIL_LIMITS = { bodyLength: 20_000, noteLength: 2000 } as const;
