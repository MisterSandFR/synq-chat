import { useEffect, useSyncExternalStore } from 'react';

import type { Draft, ScheduledMessage } from '../../../shared/drafts';
import type { ServerEvent } from '../../../shared/types';
import { api } from '../../api';

export const DRAFTS_EVENT = 'synq:drafts';

export type DraftsEvent = Extract<ServerEvent, { t: 'draft' | 'scheduled' }>;

type Snapshot = { workspaceId: string | null; drafts: Draft[]; scheduled: ScheduledMessage[]; loaded: boolean };

// Un seul espace ouvert à la fois : état du module, partagé par la sidebar, le composer et la page.
let snapshot: Snapshot = { workspaceId: null, drafts: [], scheduled: [], loaded: false };
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

export const useDrafts = () => useSyncExternalStore(subscribe, () => snapshot);

export const sameDraft = (draft: Draft, channelId: string, threadRoot: number) => draft.channelId === channelId && draft.threadRoot === threadRoot;

export function putDraft(channelId: string, threadRoot: number, draft: Draft | null): void {
	const rest = snapshot.drafts.filter((d) => !sameDraft(d, channelId, threadRoot));
	update({ drafts: draft ? [draft, ...rest] : rest });
}

export const putScheduled = (scheduled: ScheduledMessage[]) => update({ scheduled });

export const addScheduled = (item: ScheduledMessage) => putScheduled([...snapshot.scheduled.filter((s) => s.id !== item.id), item].sort((a, b) => a.sendAt - b.sendAt));

export function useDraftsLoader(workspaceId: string, connId: string | null): void {
	useEffect(() => {
		if (snapshot.workspaceId !== workspaceId) {
			update({ workspaceId, drafts: [], scheduled: [], loaded: false });
		}
		if (!connId) {
			return;
		}
		let live = true;
		Promise.all([api<Draft[]>('GET', `/w/${workspaceId}/drafts`), api<ScheduledMessage[]>('GET', `/w/${workspaceId}/scheduled`)])
			.then(([drafts, scheduled]) => live && update({ drafts, scheduled, loaded: true }))
			// Invité ou erreur : composer utilisable sans brouillon.
			.catch(() => live && update({ loaded: true }));
		return () => {
			live = false;
		};
	}, [workspaceId, connId]);

	useEffect(() => {
		const onEvent = (e: Event) => {
			const event = (e as CustomEvent<DraftsEvent>).detail;
			if (event.t === 'draft') {
				putDraft(event.channelId, event.threadRoot, event.draft);
			} else {
				putScheduled(event.items);
			}
		};
		window.addEventListener(DRAFTS_EVENT, onEvent);
		return () => window.removeEventListener(DRAFTS_EVENT, onEvent);
	}, []);
}
