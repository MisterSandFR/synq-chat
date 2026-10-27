import { useEffect } from 'react';

type Listener = (files: File[]) => void;

const listeners = new Set<Listener>();

// Dépôt sur la liste des messages : remis au composer monté sans remonter d'état dans WorkspaceView.
export const offerFiles = (files: File[]) => listeners.forEach((listener) => listener(files));

export function useOfferedFiles(listener: Listener | null): void {
	useEffect(() => {
		if (!listener) {
			return;
		}
		listeners.add(listener);
		return () => void listeners.delete(listener);
	}, [listener]);
}
