export const MAX_ATTACHMENTS = 10;

export const CLIP_MAX_MS = 5 * 60 * 1000;

export interface LinkPreview {
	url: string;
	title: string;
	description: string;
	siteName: string;
	image: string | null;
}

const URL_RE = /https?:\/\/[^\s<>"'`]+/i;

// Ponctuation finale exclue : « voir https://x.fr. » vise https://x.fr.
export const firstUrl = (body: string) => body.match(URL_RE)?.[0]?.replace(/[).,;:!?\]]+$/, '') ?? null;
