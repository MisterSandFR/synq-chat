export const AI_REPLY_EVENT = 'synq:ai-reply';

export type AiReplyDetail = { channelId: string; text: string };

export type Segment = { text: string } | { cite: number };

const CITE_RE = /\[(\d{1,2})\]/g;

// Découpe une réponse en texte et citations `[n]` valides (1..count).
export function splitCitations(text: string, count: number): Segment[] {
	const out: Segment[] = [];
	let last = 0;
	for (const match of text.matchAll(CITE_RE)) {
		const n = Number(match[1]);
		if (n < 1 || n > count) {
			continue;
		}
		if (match.index > last) {
			out.push({ text: text.slice(last, match.index) });
		}
		out.push({ cite: n });
		last = match.index + match[0].length;
	}
	if (last < text.length) {
		out.push({ text: text.slice(last) });
	}
	return out;
}

// Puces « - » du modèle ; null si le texte n'en contient pas.
export function toBullets(text: string): string[] | null {
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	const bullets = lines.filter((line) => /^[-*•]\s+/.test(line)).map((line) => line.replace(/^[-*•]\s+/, ''));
	return bullets.length > 0 && bullets.length >= lines.length - 1 ? bullets : null;
}

// Dernier id lu avant ouverture : `count` derniers messages chargés = non lus.
export function catchupAfter(ids: number[], count: number): number {
	return ids.length > count ? ids[ids.length - count - 1]! : 0;
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

// Lu par statut plutôt que `instanceof ApiError` : module importé par les tests Worker, sans DOM.
export function aiErrorText(e: unknown): string {
	const status = e instanceof Error && 'status' in e ? e.status : null;
	if (status === 429) {
		return 'Trop de demandes à l’IA. Réessaie dans une minute.';
	}
	if (status === 503) {
		return 'L’IA est indisponible pour le moment. Réessaie plus tard.';
	}
	return e instanceof Error ? e.message : 'Erreur inattendue';
}
