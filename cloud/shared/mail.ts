export type MailStatus = 'open' | 'done';

export interface MailAccess {
	owner: boolean;
	view: boolean;
	// Répondre, assigner, changer le statut, annoter.
	reply: boolean;
	// Partager et rattacher aux salons.
	manage: boolean;
}

export type MailLevel = 'view' | 'reply' | 'manage';

export const MAIL_LEVELS: MailLevel[] = ['view', 'reply', 'manage'];

export interface MailShareGrade {
	gradeId: string;
	level: MailLevel;
}

export interface MailShare {
	workspaceId: string;
	workspaceName: string;
	channelIds: string[];
	grades: MailShareGrade[];
	// Membres de l'espace qui ouvrent la boîte, propriétaire compris.
	reach: number;
}

export interface MailShareUpdate {
	channelIds?: string[];
	grades?: MailShareGrade[];
}

export interface MailAssignee {
	id: string;
	name: string;
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
	signature?: string;
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
	// Ajoutée par le serveur à chaque envoi.
	signature: string;
	// Fils ouverts non lus par l'utilisateur courant.
	unread: number;
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
	pinned: boolean;
	snoozedUntil: number | null;
	unread: boolean;
	// Recherche : extrait du corps, termes trouvés entre SEARCH_MARK.
	match?: string;
}

export interface MailAttachment {
	index: number;
	name: string;
	size: number;
	type: string;
	// Image intégrée au HTML (cid:).
	cid?: string;
}

export interface MailAddress {
	name: string;
	addr: string;
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
	hasHtml: boolean;
	toList: MailAddress[];
	ccList: MailAddress[];
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
	bcc: MailAddress[];
	forwardOf: string | null;
	subject: string;
	text: string;
	attachments: MailUpload[];
	updatedAt: number;
	// Envoi différé par le cron ; erreur du dernier essai.
	sendAt: number | null;
	sendError: string | null;
}

export interface MailTemplate {
	id: string;
	name: string;
	body: string;
	updatedAt: number;
}

export interface MailTemplateInput {
	name: string;
	body: string;
}

export interface MailScheduleInput {
	sendAt: number | null;
}

export interface MailTranslateInput {
	lang: 'fr' | 'en';
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

export interface MailHtml {
	html: string;
	blockedImages: number;
}

// Carte d'un fil partagé dans un salon.
export interface MailCard {
	threadId: string;
	subject: string;
	from: string;
	snippet: string;
}

export interface MailShareInput {
	workspaceId: string;
	channelId: string;
	comment?: string;
}

export const MAIL_PORTS = { imap: [993], smtp: [465, 587] } as const;

export const MAIL_LIMITS = {
	bodyLength: 20_000,
	noteLength: 2000,
	uploadSize: 20 * 1024 * 1024,
	sendSize: 20 * 1024 * 1024,
	recipients: 50,
	attachments: 20,
	subjectLength: 300,
	aiPrompt: 500,
	signature: 2000,
	templates: 50,
	templateName: 80,
	templateBody: 5000,
	search: 200,
	scheduleMax: 366 * 24 * 3600 * 1000,
	shareGrades: 100,
} as const;

// Bornes des termes surlignés dans `MailThread.match`.
export const SEARCH_MARK = ['\u0002', '\u0003'] as const;
