export interface SlashCommand {
	name: string;
	description: string;
	usage: string;
}

// Le secret n'en fait jamais partie : il ne repart jamais vers le client.
export interface CommandConfig extends SlashCommand {
	id: string;
	url: string;
	ephemeral: boolean;
	createdBy: string;
	createdAt: number;
}

export interface CommandInput {
	name?: string;
	description?: string;
	usage?: string;
	url?: string;
	// Vide à l'édition : secret inchangé.
	secret?: string;
	ephemeral?: boolean;
}

// Corps du POST signé envoyé à l'URL de la commande.
export interface CommandPayload {
	command: string;
	text: string;
	user: { id: string; name: string };
	channel: { id: string; name: string };
	workspace: { id: string; name: string };
}

// `text` vide : rien à afficher.
export interface CommandReply {
	ephemeral: boolean;
	text: string;
}

export const BUILTIN_COMMANDS: SlashCommand[] = [
	{ name: 'me', description: 'Décrire ce que tu fais', usage: '[action]' },
	{ name: 'shrug', description: 'Ajouter ¯\\_(ツ)_/¯ au message', usage: '[message]' },
	{ name: 'sujet', description: 'Changer le sujet du salon', usage: '[nouveau sujet]' },
];

export const COMMAND_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const COMMAND_LIMITS = {
	perWorkspace: 50,
	descriptionLength: 100,
	usageLength: 60,
	urlLength: 500,
	secretMin: 16,
	secretMax: 128,
	replyBytes: 16 * 1024,
	timeoutMs: 5000,
} as const;

export const SIGNATURE_HEADER = 'X-Synq-Signature';
export const TIMESTAMP_HEADER = 'X-Synq-Timestamp';

// Auteur des messages publiés par une commande.
export const APP_PREFIX = 'app:';

export const appUserId = (name: string) => `${APP_PREFIX}${name}`;

export const appName = (userId: string) => (userId.startsWith(APP_PREFIX) ? userId.slice(APP_PREFIX.length) : null);

// « /nom » seul ou suivi d'arguments ; « /a/b » reste du texte.
export function parseCommand(text: string): { name: string; args: string } | null {
	const match = /^\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,31})(?:\s+([\s\S]*))?$/.exec(text);
	return match ? { name: match[1]!.toLowerCase(), args: (match[2] ?? '').trim() } : null;
}
