export const P = {
	ADMINISTRATOR: 1 << 0,
	MANAGE_WORKSPACE: 1 << 1,
	MANAGE_GRADES: 1 << 2,
	MANAGE_CHANNELS: 1 << 3,
	KICK_MEMBERS: 1 << 4,
	CREATE_INVITES: 1 << 5,
	VIEW_CHANNEL: 1 << 6,
	SEND_MESSAGES: 1 << 7,
	ATTACH_FILES: 1 << 8,
	MANAGE_MESSAGES: 1 << 9,
	DRIVE_UPLOAD: 1 << 10,
	DRIVE_MANAGE: 1 << 11,
	VOICE_CONNECT: 1 << 12,
	VOICE_SPEAK: 1 << 13,
	VOICE_VIDEO: 1 << 14,
	VOICE_SCREEN: 1 << 15,
	VOICE_MODERATE: 1 << 16,
	BYPASS_LIMIT: 1 << 17,
	VOICE_MOVE: 1 << 18,
	MANAGE_COMMANDS: 1 << 19,
	MENTION_EVERYONE: 1 << 20,
	PIN_MESSAGES: 1 << 21,
	ADD_REACTIONS: 1 << 22,
	VIEW_EVENTS: 1 << 23,
	CREATE_EVENTS: 1 << 24,
	MANAGE_EVENTS: 1 << 25,
} as const;

export type PermKey = keyof typeof P;

export const ALL_PERMS = (1 << 26) - 1;

export const DEFAULT_GRADE = 'default';
export const ADMIN_GRADE = 'admin';

export const DEFAULT_MEMBER_PERMS =
	P.VIEW_CHANNEL | P.SEND_MESSAGES | P.ATTACH_FILES | P.DRIVE_UPLOAD | P.VOICE_CONNECT | P.VOICE_SPEAK | P.VOICE_VIDEO | P.VOICE_SCREEN | P.ADD_REACTIONS | P.VIEW_EVENTS | P.CREATE_EVENTS;

export const READ_ONLY_DENY = P.SEND_MESSAGES | P.ATTACH_FILES | P.DRIVE_UPLOAD;

export type PermGroup = 'Espace' | 'Salons' | 'Messages' | 'Fichiers' | 'Vocal';

// `channel` : réglable par salon dans la matrice.
export const PERMISSIONS: Array<{ key: PermKey; label: string; hint: string; group: PermGroup; channel: boolean }> = [
	{ key: 'ADMINISTRATOR', label: 'Administrateur', hint: 'Toutes les permissions, partout. À réserver.', group: 'Espace', channel: false },
	{ key: 'MANAGE_WORKSPACE', label: 'Gérer l’espace', hint: 'Nom et couleur de l’espace.', group: 'Espace', channel: false },
	{ key: 'MANAGE_GRADES', label: 'Gérer les grades', hint: 'Créer, modifier et attribuer les grades inférieurs au sien.', group: 'Espace', channel: false },
	{ key: 'KICK_MEMBERS', label: 'Retirer des membres', hint: 'Exclure les membres de grade inférieur.', group: 'Espace', channel: false },
	{ key: 'CREATE_INVITES', label: 'Inviter', hint: 'Générer des liens d’invitation.', group: 'Espace', channel: false },
	{ key: 'MANAGE_CHANNELS', label: 'Gérer les salons', hint: 'Créer, modifier, supprimer les salons et leurs permissions.', group: 'Salons', channel: false },
	{ key: 'VIEW_CHANNEL', label: 'Voir le salon', hint: 'Sans elle, le salon est invisible.', group: 'Salons', channel: true },
	{ key: 'SEND_MESSAGES', label: 'Écrire', hint: 'Envoyer des messages.', group: 'Messages', channel: true },
	{ key: 'ATTACH_FILES', label: 'Joindre des fichiers', hint: 'Pièces jointes dans les messages.', group: 'Messages', channel: true },
	{ key: 'MANAGE_MESSAGES', label: 'Modérer les messages', hint: 'Supprimer les messages des autres.', group: 'Messages', channel: true },
	{ key: 'ADD_REACTIONS', label: 'Réagir', hint: 'Ajouter des réactions aux messages.', group: 'Messages', channel: true },
	{ key: 'PIN_MESSAGES', label: 'Épingler des messages', hint: 'Épingler et désépingler les messages du salon.', group: 'Messages', channel: true },
	{ key: 'DRIVE_UPLOAD', label: 'Déposer des fichiers', hint: 'Importer et créer des dossiers dans le drive.', group: 'Fichiers', channel: true },
	{ key: 'DRIVE_MANAGE', label: 'Gérer le drive', hint: 'Renommer et supprimer les fichiers des autres.', group: 'Fichiers', channel: true },
	{ key: 'VOICE_CONNECT', label: 'Rejoindre le vocal', hint: 'Entrer dans le salon vocal.', group: 'Vocal', channel: true },
	{ key: 'VOICE_SPEAK', label: 'Parler', hint: 'Sans elle, écoute seule.', group: 'Vocal', channel: true },
	{ key: 'VOICE_VIDEO', label: 'Caméra', hint: 'Activer sa caméra.', group: 'Vocal', channel: true },
	{ key: 'VOICE_SCREEN', label: 'Partage d’écran', hint: 'Partager son écran.', group: 'Vocal', channel: true },
	{ key: 'VOICE_MODERATE', label: 'Modérer le vocal', hint: 'Couper le micro ou expulser un grade inférieur.', group: 'Vocal', channel: true },
	{ key: 'VOICE_MOVE', label: 'Déplacer des membres', hint: 'Déplacer les membres de grade inférieur d’un salon vocal à un autre.', group: 'Vocal', channel: true },
	{ key: 'BYPASS_LIMIT', label: 'Ignorer la limite de places', hint: 'Entrer dans un salon vocal complet.', group: 'Vocal', channel: true },
	{ key: 'MANAGE_COMMANDS', label: 'Gérer les commandes', hint: 'Créer, modifier et supprimer les commandes slash personnalisées.', group: 'Espace', channel: false },
	{ key: 'MENTION_EVERYONE', label: 'Mentionner @all et @here', hint: 'Notifier tout le salon ou ses membres en ligne.', group: 'Messages', channel: true },
	{ key: 'VIEW_EVENTS', label: 'Voir le calendrier', hint: 'Voir les événements de l’espace.', group: 'Espace', channel: false },
	{ key: 'CREATE_EVENTS', label: 'Créer des événements', hint: 'Créer des événements et modifier les siens.', group: 'Espace', channel: false },
	{ key: 'MANAGE_EVENTS', label: 'Gérer les événements', hint: 'Modifier et supprimer les événements des autres.', group: 'Espace', channel: false },
];

export type Override = { allow: number; deny: number };

export interface PermSubject {
	owner: boolean;
	base: number;
	// Toujours avec le grade par défaut.
	grades: string[];
	// Surcharge propre au membre, appliquée en dernier.
	id?: string;
}

export const has = (perms: number, flag: number) => (perms & flag) === flag;

export function basePerms(owner: boolean, grades: Array<{ permissions: number }>): number {
	if (owner) {
		return ALL_PERMS;
	}
	const merged = grades.reduce((acc, grade) => acc | grade.permissions, 0);
	return has(merged, P.ADMINISTRATOR) ? ALL_PERMS : merged;
}

// Même ordre que Discord : défaut d'abord, puis refus et autorisations cumulés des autres grades.
export function channelPerms(subject: PermSubject, overrides: Record<string, Override>): number {
	if (subject.owner || has(subject.base, P.ADMINISTRATOR)) {
		return ALL_PERMS;
	}
	let perms = subject.base;
	const fallback = overrides[DEFAULT_GRADE];
	if (fallback) {
		perms = (perms & ~fallback.deny) | fallback.allow;
	}
	let deny = 0;
	let allow = 0;
	for (const grade of subject.grades) {
		const override = grade === DEFAULT_GRADE ? undefined : overrides[grade];
		if (override) {
			deny |= override.deny;
			allow |= override.allow;
		}
	}
	const merged = (perms & ~deny) | allow;
	const own = subject.id ? overrides[`@${subject.id}`] : undefined;
	return own ? (merged & ~own.deny) | own.allow : merged;
}
