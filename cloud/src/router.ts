import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

window.addEventListener('popstate', emit);

export function navigate(path: string, replace = false): void {
	if (path === location.pathname) {
		return;
	}
	history[replace ? 'replaceState' : 'pushState'](null, '', path);
	emit();
}

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const usePath = () => useSyncExternalStore(subscribe, () => location.pathname);

const RETURN_KEY = 'synq_return';

// Le SSO revient toujours sur « / » : on mémorise la page d'origine.
export function rememberReturn(): void {
	try {
		sessionStorage.setItem(RETURN_KEY, location.pathname);
	} catch {
		// Stockage indisponible : retour à l'accueil.
	}
}

export function takeReturn(): string | null {
	try {
		const value = sessionStorage.getItem(RETURN_KEY);
		sessionStorage.removeItem(RETURN_KEY);
		return value;
	} catch {
		return null;
	}
}

const SSO_MESSAGES: Record<string, string> = {
	state: 'La connexion Recube a expiré. Recommence.',
	denied: 'Connexion Recube annulée.',
	provider: 'Recube n’a pas confirmé ton identité. Réessaie dans un instant.',
	email_exists: 'Un compte Synq utilise déjà cet email. Connecte-toi avec ton mot de passe, puis lie Recube depuis ton profil.',
	already_linked: 'Ce compte Recube est déjà lié à un autre compte Synq.',
	session: 'Connecte-toi d’abord pour lier ton compte Recube.',
};

export function takeSsoNotice(): { tone: 'error' | 'ok'; text: string } | null {
	const params = new URLSearchParams(location.search);
	const error = params.get('sso_error');
	const linked = params.get('linked');
	if (!error && !linked) {
		return null;
	}
	history.replaceState(null, '', location.pathname);
	if (linked) {
		return { tone: 'ok', text: 'Compte Recube lié.' };
	}
	return { tone: 'error', text: SSO_MESSAGES[error ?? ''] ?? 'Connexion Recube impossible.' };
}

const LAST_KEY = 'synq_last_workspace';

export function lastWorkspace(): string | null {
	try {
		return localStorage.getItem(LAST_KEY);
	} catch {
		return null;
	}
}

export function rememberWorkspace(id: string): void {
	try {
		localStorage.setItem(LAST_KEY, id);
	} catch {
		// Stockage indisponible : pas de reprise auto.
	}
}
