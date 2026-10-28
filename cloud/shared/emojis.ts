export interface CustomEmoji {
	name: string;
	url: string;
	animated: boolean;
	createdBy: string;
	createdAt: number;
}

export const CUSTOM_EMOJI_LIMITS = { count: 200, size: 256 * 1024, dimension: 128 } as const;

export const CUSTOM_EMOJI_TYPES = ['image/png', 'image/gif', 'image/webp', 'image/jpeg'];

export const CUSTOM_EMOJI_NAME_RE = /^[a-z0-9_]{2,32}$/;

// Réaction avec un emoji d'espace : stockée sous la forme `:nom:`.
export const CUSTOM_REACTION_RE = /^:([a-z0-9_]{2,32}):$/;

export const CUSTOM_SHORTCODE_RE = /:([a-z0-9_]{2,32}):/g;

// Nom proposé depuis un nom de fichier : « Party Parrot.gif » donne « party_parrot ».
export function emojiNameFrom(fileName: string): string {
	const base = fileName
		.replace(/\.[^.]+$/, '')
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 32);
	return base.length >= 2 ? base : `emoji_${base}`.slice(0, 32);
}
