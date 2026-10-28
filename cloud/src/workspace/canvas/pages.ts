import { useEffect, useSyncExternalStore } from 'react';

import type { PageCategory } from '../../../shared/access';
import { canvasPath, type CanvasMeta, type PagePatch } from '../../../shared/canvas';
import { api } from '../../api';
import { navigate } from '../../router';

type Store = { items: CanvasMeta[] | null; loading: boolean; listeners: Set<() => void> };

const stores = new Map<string, Store>();

const storeOf = (workspaceId: string) => {
	let store = stores.get(workspaceId);
	if (!store) {
		store = { items: null, loading: false, listeners: new Set() };
		stores.set(workspaceId, store);
	}
	return store;
};

const emit = (store: Store) => store.listeners.forEach((fn) => fn());

export async function refreshPages(workspaceId: string): Promise<void> {
	const store = storeOf(workspaceId);
	store.loading = true;
	try {
		store.items = await api<CanvasMeta[]>('GET', `/w/${workspaceId}/canvases`);
		emit(store);
	} finally {
		store.loading = false;
	}
}

export function usePages(workspaceId: string): CanvasMeta[] | null {
	const store = storeOf(workspaceId);
	const items = useSyncExternalStore(
		(fn) => {
			store.listeners.add(fn);
			return () => store.listeners.delete(fn);
		},
		() => store.items,
	);
	useEffect(() => {
		if (store.items === null && !store.loading) {
			void refreshPages(workspaceId).catch(() => undefined);
		}
		// Les éditions des autres arrivent au retour sur l'onglet.
		const onFocus = () => void refreshPages(workspaceId).catch(() => undefined);
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [workspaceId]);
	return items;
}

// Titre saisi dans une page ouverte : reflété tout de suite dans l'arbre.
export function localPage(workspaceId: string, id: string, fields: Partial<CanvasMeta>): void {
	const store = storeOf(workspaceId);
	if (store.items?.some((p) => p.id === id)) {
		store.items = store.items.map((p) => (p.id === id ? { ...p, ...fields } : p));
		emit(store);
	}
}

export const pageById = (workspaceId: string, id: string) => storeOf(workspaceId).items?.find((p) => p.id === id) ?? null;

export const childrenOf = (items: CanvasMeta[], parentId: string | null) => items.filter((p) => p.parentId === parentId).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);

// Parente absente de la liste (archivée ou invisible) : la page s'affiche à la racine.
export const rootsOf = (items: CanvasMeta[]) => {
	const ids = new Set(items.map((p) => p.id));
	return items.filter((p) => !p.parentId || !ids.has(p.parentId)).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
};

export const isInside = (items: CanvasMeta[], id: string, ancestorId: string) => {
	const byId = new Map(items.map((p) => [p.id, p]));
	for (let current = byId.get(id), depth = 0; current && depth < 64; current = current.parentId ? byId.get(current.parentId) : undefined, depth++) {
		if (current.id === ancestorId) {
			return true;
		}
	}
	return false;
};

export async function patchPage(workspaceId: string, id: string, patch: PagePatch): Promise<CanvasMeta> {
	const meta = await api<CanvasMeta>('PATCH', `/w/${workspaceId}/canvases/${id}`, patch);
	await refreshPages(workspaceId);
	return meta;
}

export async function createPage(workspaceId: string, input: { parentId?: string | null; categoryId?: string | null; template?: string; title?: string } = {}, open = true): Promise<CanvasMeta> {
	const meta = await api<CanvasMeta>('POST', `/w/${workspaceId}/canvases`, { title: input.title ?? '', parentId: input.parentId ?? null, categoryId: input.categoryId ?? null, template: input.template });
	await refreshPages(workspaceId);
	if (open) {
		navigate(canvasPath(workspaceId, meta.id));
	}
	return meta;
}

export async function duplicatePage(workspaceId: string, id: string): Promise<CanvasMeta> {
	const meta = await api<CanvasMeta>('POST', `/w/${workspaceId}/canvases/${id}/duplicate`);
	await refreshPages(workspaceId);
	return meta;
}

// Position entre deux voisines, ou au bord de la liste.
export function positionAt(siblings: CanvasMeta[], index: number): number {
	const before = siblings[index - 1];
	const after = siblings[index];
	if (before && after) {
		return (before.position + after.position) / 2;
	}
	return before ? before.position + 1 : after ? after.position - 1 : 1;
}

export const pageLabel = (page: { title: string } | null | undefined) => page?.title || 'Sans titre';

// --- Catégories de pages ---

type CategoryStore = { items: PageCategory[] | null; listeners: Set<() => void> };
const categoryStores = new Map<string, CategoryStore>();
const NO_CATEGORIES: PageCategory[] = [];

function categoryStore(workspaceId: string): CategoryStore {
	let store = categoryStores.get(workspaceId);
	if (!store) {
		store = { items: null, listeners: new Set() };
		categoryStores.set(workspaceId, store);
	}
	return store;
}

export async function refreshCategories(workspaceId: string): Promise<void> {
	const store = categoryStore(workspaceId);
	store.items = (await api<PageCategory[]>('GET', `/w/${workspaceId}/page-categories`)).sort((a, b) => a.position - b.position);
	store.listeners.forEach((fn) => fn());
}

export function usePageCategories(workspaceId: string): PageCategory[] {
	const store = categoryStore(workspaceId);
	const items = useSyncExternalStore(
		(fn) => {
			store.listeners.add(fn);
			return () => store.listeners.delete(fn);
		},
		() => store.items,
	);
	useEffect(() => {
		if (!store.items) {
			void refreshCategories(workspaceId).catch(() => undefined);
		}
	}, [workspaceId, store]);
	return items ?? NO_CATEGORIES;
}

export async function createCategory(workspaceId: string, name: string): Promise<PageCategory> {
	const created = await api<PageCategory>('POST', `/w/${workspaceId}/page-categories`, { name });
	await refreshCategories(workspaceId);
	return created;
}

export async function patchCategory(workspaceId: string, id: string, patch: { name?: string; icon?: string | null; position?: number }): Promise<void> {
	await api('PATCH', `/w/${workspaceId}/page-categories/${id}`, patch);
	await refreshCategories(workspaceId);
}

export async function deleteCategory(workspaceId: string, id: string): Promise<void> {
	await api('DELETE', `/w/${workspaceId}/page-categories/${id}`);
	await Promise.all([refreshCategories(workspaceId), refreshPages(workspaceId)]);
}
