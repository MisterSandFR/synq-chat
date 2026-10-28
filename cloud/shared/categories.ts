export interface Category {
	id: string;
	name: string;
	position: number;
	bannerKey: string | null;
}

// Ordre complet des catégories ; salons facultatifs, dans l'ordre d'affichage avec leur catégorie.
export interface Layout {
	categories: string[];
	channels: Array<{ id: string; categoryId: string | null }>;
}

// Surcharge d'un membre : même table que les grades, clé préfixée.
export const memberKey = (userId: string) => `@${userId}`;

export const isMemberKey = (key: string) => key.startsWith('@');

export const BANNER_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export const BANNER_SIZE = 2 * 1024 * 1024;

export const bannerUrl = (workspaceId: string, category: Pick<Category, 'id' | 'bannerKey'>) =>
	category.bannerKey ? `/api/category-banners/${workspaceId}/${category.id}/${category.bannerKey}` : null;

const SPACE_EMOJI = /^:[a-z0-9_]{2,32}:$/;
const PICTOGRAPH = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]️?⃣)/u;

// '' = icône par défaut du type ; null = refus.
export function cleanChannelIcon(raw: unknown): string | null {
	if (typeof raw !== 'string') {
		return null;
	}
	const value = raw.trim();
	if (value === '' || SPACE_EMOJI.test(value)) {
		return value;
	}
	if (value.length > 32 || !PICTOGRAPH.test(value)) {
		return null;
	}
	const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)];
	return graphemes.length === 1 ? value : null;
}

export const isSpaceEmoji = (icon: string) => SPACE_EMOJI.test(icon);
