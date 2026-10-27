import { useEffect, useState } from 'react';

import type { EventCard } from '../../../shared/calendar';
import { api, errorText } from '../../api';

export const EVENT_CARD_EVENT = 'synq:event-card';

export type CardEntry = { card: EventCard | null; error: string | null };

// Partagé entre les cartes d'un même événement : une seule requête par changement.
const cache = new Map<string, CardEntry>();
const loading = new Map<string, Promise<void>>();
const stale = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

function load(workspaceId: string, eventId: string): Promise<void> {
	const key = `${workspaceId}:${eventId}`;
	const pending = loading.get(key);
	if (pending) {
		// Changement reçu pendant le chargement : relire après.
		stale.add(key);
		return pending;
	}
	const run = api<EventCard>('GET', `/w/${workspaceId}/event-cards/${eventId}`)
		.then((card) => void cache.set(key, { card, error: null }))
		.catch((e) => void cache.set(key, { card: cache.get(key)?.card ?? null, error: errorText(e) }))
		.finally(() => {
			loading.delete(key);
			listeners.get(key)?.forEach((listener) => listener());
			if (stale.delete(key)) {
				void load(workspaceId, eventId);
			}
		});
	loading.set(key, run);
	return run;
}

export function useEventCard(workspaceId: string, eventId: string) {
	const key = `${workspaceId}:${eventId}`;
	const [entry, setEntry] = useState<CardEntry | null>(() => cache.get(key) ?? null);
	useEffect(() => {
		const set = listeners.get(key) ?? new Set<() => void>();
		listeners.set(key, set);
		const update = () => setEntry(cache.get(key) ?? null);
		set.add(update);
		if (cache.has(key)) {
			update();
		} else {
			void load(workspaceId, eventId);
		}
		const onChange = (event: Event) => (event as CustomEvent<string>).detail === eventId && void load(workspaceId, eventId);
		window.addEventListener(EVENT_CARD_EVENT, onChange);
		return () => {
			set.delete(update);
			window.removeEventListener(EVENT_CARD_EVENT, onChange);
		};
	}, [key, workspaceId, eventId]);
	return { entry, reload: () => load(workspaceId, eventId) };
}
