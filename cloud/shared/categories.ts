export interface Category {
	id: string;
	name: string;
	position: number;
}

// Ordre complet des catégories ; salons facultatifs, dans l'ordre d'affichage avec leur catégorie.
export interface Layout {
	categories: string[];
	channels: Array<{ id: string; categoryId: string | null }>;
}

// Surcharge d'un membre : même table que les grades, clé préfixée.
export const memberKey = (userId: string) => `@${userId}`;

export const isMemberKey = (key: string) => key.startsWith('@');
