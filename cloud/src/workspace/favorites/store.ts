import { useEffect, useSyncExternalStore } from 'react';

import type { Favorite, FavoriteRef } from '../../../shared/favorites';
import { api } from '../../api';

export const FAVORITES_EVENT = 'synq:favorites';

type Snapshot = { workspaceId: string | null; items: Favorite[]; dragging: boolean };

// Un seul espace ouvert : état du module, partagé par la sidebar et les étoiles des en-têtes.
let snapshot: Snapshot = { workspaceId: null, items: [], dragging: false };
const listeners = new Set<() => void>();

function update(change: Partial<Snapshot>): void {
	snapshot = { ...snapshot, ...change };
	listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const useFavorites = () => useSyncExternalStore(subscribe, () => snapshot);

export const currentFavorites = () => snapshot.items;

export const sameRef = (a: FavoriteRef, b: FavoriteRef) => a.kind === b.kind && a.refId === b.refId;

export const isFavorite = (items: Favorite[], ref: FavoriteRef) => items.some((f) => sameRef(f, ref));

async function reload(): Promise<void> {
	const workspaceId = snapshot.workspaceId;
	if (!workspaceId) {
		return;
	}
	const items = await api<Favorite[]>('GET', `/w/${workspaceId}/favorites`).catch(() => null);
	if (items && snapshot.workspaceId === workspaceId) {
		update({ items });
	}
}

// Optimiste ; l'event `favorites` recale tous les appareils.
export async function toggleFavorite(ref: FavoriteRef, favorite: boolean, title = ''): Promise<void> {
	const workspaceId = snapshot.workspaceId;
	if (!workspaceId) {
		return;
	}
	const rest = snapshot.items.filter((f) => !sameRef(f, ref));
	update({ items: favorite ? [...rest, { kind: ref.kind, refId: ref.refId, title, position: rest.length }] : rest });
	await api('PUT', `/w/${workspaceId}/favorites`, { kind: ref.kind, refId: ref.refId, favorite }).catch(() => reload());
}

// Ajout ou déplacement avant `before` (fin si null).
export async function placeFavorite(ref: FavoriteRef, before: FavoriteRef | null, title = ''): Promise<void> {
	const workspaceId = snapshot.workspaceId;
	if (!workspaceId || (before && sameRef(ref, before))) {
		return;
	}
	const current = snapshot.items.find((f) => sameRef(f, ref));
	const rest = snapshot.items.filter((f) => !sameRef(f, ref));
	const found = before ? rest.findIndex((f) => sameRef(f, before)) : -1;
	const at = found < 0 ? rest.length : found;
	const items = [...rest.slice(0, at), current ?? { kind: ref.kind, refId: ref.refId, title, position: 0 }, ...rest.slice(at)].map((f, position) => ({ ...f, position }));
	update({ items });
	try {
		if (!current) {
			await api('PUT', `/w/${workspaceId}/favorites`, { kind: ref.kind, refId: ref.refId, favorite: true });
		}
		await api('PUT', `/w/${workspaceId}/favorites/order`, { items: items.map(({ kind, refId }) => ({ kind, refId })) });
	} catch {
		await reload();
	}
}

// Glisser vers la section, hors du glisser des catégories (réservé aux gestionnaires).
export const favoriteDrag: { ref: FavoriteRef | null } = { ref: null };

export function startFavoriteDrag(ref: FavoriteRef): void {
	favoriteDrag.ref = { kind: ref.kind, refId: ref.refId };
	// Rendu différé : modifier le DOM pendant dragstart annule le glisser dans Chrome.
	window.setTimeout(() => favoriteDrag.ref && update({ dragging: true }), 0);
}

export function endFavoriteDrag(): void {
	favoriteDrag.ref = null;
	if (snapshot.dragging) {
		update({ dragging: false });
	}
}

export function useFavoritesLoader(workspaceId: string, connId: string | null): void {
	useEffect(() => {
		if (snapshot.workspaceId !== workspaceId) {
			update({ workspaceId, items: [] });
		}
		if (connId) {
			void reload();
		}
	}, [workspaceId, connId]);

	useEffect(() => {
		const onEvent = () => void reload();
		window.addEventListener(FAVORITES_EVENT, onEvent);
		return () => window.removeEventListener(FAVORITES_EVENT, onEvent);
	}, []);
}
