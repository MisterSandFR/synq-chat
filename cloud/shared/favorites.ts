// Salons texte et vocaux comme conversations privées : tous des rangées `channels` du DO.
export type FavoriteKind = 'channel' | 'canvas' | 'list';

export const FAVORITE_KINDS: readonly FavoriteKind[] = ['channel', 'canvas', 'list'];

export const FAVORITES_MAX = 100;

export interface FavoriteRef {
	kind: FavoriteKind;
	refId: string;
}

// Titre lu en D1 pour les canevas et listes ; vide pour un salon, nommé côté client.
export interface Favorite extends FavoriteRef {
	position: number;
	title: string;
}
