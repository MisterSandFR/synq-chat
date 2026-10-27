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
	// Optionnels tant que le serveur ne les renvoie pas partout.
	pinned?: boolean;
	snoozedUntil?: number | null;
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
	hasHtml?: boolean;
	toList?: MailAddress[];
	ccList?: MailAddress[];
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

export interface MailAddress {
	name: string;
	addr: string;
}

export interface MailUpload {
	key: string;
	name: string;
	size: number;
	type: string;
}

export interface MailDraft {
	id: string;
	mailboxId: string;
	threadId: string | null;
	to: MailAddress[];
	cc: MailAddress[];
	subject: string;
	text: string;
	attachments: MailUpload[];
	updatedAt: number;
}

export interface MailSendInput {
	mailboxId: string;
	threadId?: string | null;
	forwardOf?: string | null;
	to: string[];
	cc?: string[];
	bcc?: string[];
	subject: string;
	text: string;
	attachments?: string[];
	draftId?: string | null;
}

export type MailAiAction = 'reply' | 'quick' | 'summary' | 'ask';

export interface MailAiInput {
	action: MailAiAction;
	prompt?: string;
	tone?: 'neutre' | 'chaleureux' | 'formel' | 'bref';
}

export interface MailAiResult {
	text?: string;
	suggestions?: Array<{ label: string; text: string }>;
}

export interface MailCardRef {
	threadId: string;
	subject: string;
	from: string;
	snippet: string;
}

declare module './types' {
	interface Message {
		mailCard?: MailCardRef;
	}
}

export const MAIL_PORTS = { imap: [993], smtp: [465, 587] } as const;

export const MAIL_LIMITS = { bodyLength: 20_000, noteLength: 2000 } as const;
