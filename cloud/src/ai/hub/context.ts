import type { AiHubContext, AiIntent } from '../../../shared/ai-hub';

export type ContextKind = 'channel' | 'mail' | 'page' | 'list' | 'day' | 'none';

export type HubContext = { kind: ContextKind; label: string; ctx: Partial<AiHubContext> };

const RESERVED = new Set(['messages', 'activite', 'fils', 'brouillons', 'listes', 'canevas', 'pages', 'bases']);

const today = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Lu dans l'URL à chaque rendu : le mail change de fil par replaceState, sans événement.
export function readContext(workspaceId: string | null): HubContext {
	const path = location.pathname;
	const search = new URLSearchParams(location.search);
	const base = { workspaceId };
	if (path === '/mail') {
		const thread = search.get('thread');
		return thread ? { kind: 'mail', label: 'Ce mail', ctx: { ...base, mailThreadId: thread } } : { kind: 'none', label: 'Partout', ctx: base };
	}
	if (path === '/calendrier') {
		return { kind: 'day', label: 'Aujourd’hui', ctx: { ...base, day: today() } };
	}
	const m = /^\/w\/([\w-]+)(?:\/([\w-]+)(?:\/([\w-]+))?)?$/.exec(path);
	if (!m) {
		return { kind: 'none', label: 'Partout', ctx: base };
	}
	const [, wid, first, second] = m;
	const inSpace = { workspaceId: wid! };
	if ((first === 'canevas' || first === 'pages') && second) {
		return { kind: 'page', label: 'Cette page', ctx: { ...inSpace, pageId: second } };
	}
	if ((first === 'listes' || first === 'bases') && second && second !== 'nouvelle') {
		return { kind: 'list', label: 'Ce suivi', ctx: { ...inSpace, listId: second } };
	}
	if (first && !RESERVED.has(first)) {
		return { kind: 'channel', label: 'Ce salon', ctx: { ...inSpace, channelId: first } };
	}
	return { kind: 'none', label: 'Partout', ctx: inSpace };
}

export type Suggestion = { intent: AiIntent; label: string; needsText?: boolean };

const EVENT: Suggestion = { intent: 'event', label: 'Créer un événement', needsText: true };
const ABSENCE: Suggestion = { intent: 'absence', label: 'Poser une absence', needsText: true };

export function suggestionsFor(kind: ContextKind): Suggestion[] {
	switch (kind) {
		case 'channel':
			return [
				{ intent: 'summarize', label: 'Résumer ce salon' },
				{ intent: 'cards', label: 'Créer des cartes depuis la discussion' },
				{ intent: 'page', label: 'Rédiger un compte-rendu' },
				EVENT,
			];
		case 'mail':
			return [
				{ intent: 'summarize', label: 'Résumer ce mail' },
				{ intent: 'mail_reply', label: 'Préparer une réponse' },
				{ intent: 'cards', label: 'Créer des cartes depuis ce mail' },
				EVENT,
			];
		case 'page':
			return [{ intent: 'summarize', label: 'Résumer cette page' }, EVENT, ABSENCE];
		case 'list':
			return [{ intent: 'summarize', label: 'Résumer ce suivi' }, EVENT, ABSENCE];
		case 'day':
			return [{ intent: 'summarize', label: 'Résumer ma journée' }, EVENT, ABSENCE];
		default:
			return [EVENT, ABSENCE];
	}
}

export const PLACEHOLDER: Partial<Record<AiIntent, string>> = {
	event: 'Décris l’événement : point produit jeudi à 14 h, 30 min',
	absence: 'Décris l’absence : congé du 3 au 7 novembre',
	cards: 'Consigne facultative, puis Entrée',
	page: 'Consigne facultative, puis Entrée',
	mail_reply: 'Consigne facultative : ton, points à couvrir',
	layout: 'Consigne facultative : public, ton, structure',
};
