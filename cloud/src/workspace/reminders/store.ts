import { useEffect, useSyncExternalStore } from 'react';

import type { LaterItem, Reminder, ReminderInput, ReminderPatch } from '../../../shared/reminders';
import { api } from '../../api';
import { useUserEvents } from '../../userEvents';

let state: { workspaceId: string | null; items: LaterItem[] } = { workspaceId: null, items: [] };
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export async function reloadLater(workspaceId: string): Promise<void> {
	const items = await api<LaterItem[]>('GET', `/w/${workspaceId}/later`);
	// Réponse d'un espace quitté entre-temps : ignorée.
	if (state.workspaceId === workspaceId) {
		state = { workspaceId, items };
		emit();
	}
}

const refresh = <T>(workspaceId: string) => (value: T) => {
	void reloadLater(workspaceId).catch(() => undefined);
	return value;
};

export const setReminder = (workspaceId: string, input: ReminderInput) => api<Reminder>('POST', `/w/${workspaceId}/reminders`, input).then(refresh<Reminder>(workspaceId));

export const patchReminder = (workspaceId: string, id: number, patch: ReminderPatch) => api<Reminder>('PATCH', `/w/${workspaceId}/reminders/${id}`, patch).then(refresh<Reminder>(workspaceId));

export const removeReminder = (workspaceId: string, id: number) => api<null>('DELETE', `/w/${workspaceId}/reminders/${id}`).then(refresh<null>(workspaceId));

// `savedVersion` : liste des enregistrés de useRc, relue à chaque signet posé ou retiré.
export function useLaterLoader(workspaceId: string, savedVersion: unknown): void {
	useEffect(() => {
		if (state.workspaceId !== workspaceId) {
			state = { workspaceId, items: [] };
			emit();
		}
		void reloadLater(workspaceId).catch(() => undefined);
	}, [workspaceId, savedVersion]);
	useUserEvents((event) => {
		if (event.t === 'resync' || (event.t === 'reminders' && event.workspaceId === workspaceId)) {
			void reloadLater(workspaceId).catch(() => undefined);
		}
	});
}

export const useLater = (): LaterItem[] => useSyncExternalStore(subscribe, () => state.items);

// Rappels sonnés et pas encore traités.
export const laterBadge = (items: LaterItem[]) => items.filter((item) => item.reminder?.firedAt && !item.reminder.doneAt).length;
