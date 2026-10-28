export type CanvasAccess = 'write' | 'read';

export type CanvasMeta = {
	id: string;
	workspaceId: string;
	channelId: string | null;
	title: string;
	excerpt: string;
	// Derniers éditeurs, le plus récent d'abord.
	editors: string[];
	createdBy: string;
	createdAt: number;
	updatedAt: number;
	access: CanvasAccess;
	parentId: string | null;
	icon: string | null;
	// `gradient:N` ou URL d'image servie par la route des fichiers.
	cover: string | null;
	position: number;
	archivedAt: number | null;
};

export type PageRef = { id: string; title: string; icon: string | null };

export type PageRelated = { ancestors: PageRef[]; children: PageRef[]; backlinks: PageRef[] };

export type PageComment = {
	id: string;
	threadId: string;
	quote: string;
	authorId: string;
	body: string;
	createdAt: number;
	resolvedAt: number | null;
};

export type PagePatch = {
	title?: string;
	icon?: string | null;
	cover?: string | null;
	parentId?: string | null;
	position?: number;
	archived?: boolean;
};

// Premier octet de chaque trame binaire du WebSocket de canevas.
export const CANVAS_MSG = { sync: 0, update: 1, awareness: 2, query: 3 } as const;

export const CANVAS_LIMITS = { title: 120, excerpt: 240, update: 1_000_000, awareness: 16_384, editors: 6, icon: 16, comment: 4000, quote: 300, depth: 32, pages: 2000 };

export const CANVAS_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

export const PAGE_GRADIENTS = 6;

export const PAGE_COVER_RE = /^gradient:[0-5]$/;

export const canvasPath = (workspaceId: string, id: string) => `/w/${workspaceId}/canevas/${id}`;

export const CANVAS_LINK_RE = /\/w\/([\w-]+)\/(?:canevas|pages)\/([\w-]+)/;

export const canvasFrame = (type: number, payload: Uint8Array) => {
	const out = new Uint8Array(payload.length + 1);
	out[0] = type;
	out.set(payload, 1);
	return out;
};

// Nœud de modèle converti en Yjs par le DO : mêmes noms que le schéma de l'éditeur.
export type TemplateNode = { type: string; attrs?: Record<string, string | number | boolean>; text?: string; content?: TemplateNode[] };

export type PageTemplate = { id: string; title: string; icon: string; description: string; blocks: TemplateNode[] };

const p = (text = ''): TemplateNode => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const h = (level: number, text: string): TemplateNode => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const todo = (...items: string[]): TemplateNode => ({ type: 'taskList', content: items.map((text) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(text)] })) });
const bullets = (...items: string[]): TemplateNode => ({ type: 'bulletList', content: items.map((text) => ({ type: 'listItem', content: [p(text)] })) });
const callout = (emoji: string, text: string): TemplateNode => ({ type: 'callout', attrs: { emoji }, content: [p(text)] });

export const PAGE_TEMPLATES: PageTemplate[] = [
	{
		id: 'meeting',
		title: 'Compte-rendu de réunion',
		icon: '📝',
		description: 'Participants, ordre du jour, décisions et actions',
		blocks: [callout('📅', 'Date, heure et lieu de la réunion'), h(2, 'Participants'), bullets(''), h(2, 'Ordre du jour'), bullets(''), h(2, 'Décisions'), bullets(''), h(2, 'Actions'), todo('')],
	},
	{
		id: 'project',
		title: 'Fiche projet',
		icon: '🚀',
		description: 'Objectif, périmètre, équipe, jalons et risques',
		blocks: [
			callout('🎯', 'Objectif du projet en une phrase'),
			h(2, 'Contexte'),
			p(),
			h(2, 'Périmètre'),
			bullets('Inclus', 'Exclu'),
			h(2, 'Équipe'),
			bullets(''),
			h(2, 'Jalons'),
			todo('Cadrage', 'Réalisation', 'Livraison'),
			h(2, 'Risques'),
			bullets(''),
		],
	},
	{
		id: 'wiki',
		title: 'Wiki',
		icon: '📚',
		description: 'Accueil avec sommaire et sections',
		blocks: [{ type: 'toc' }, h(2, 'Présentation'), p(), h(2, 'Comment contribuer'), p(), h(2, 'Ressources'), bullets('')],
	},
	{
		id: 'roadmap',
		title: 'Feuille de route',
		icon: '🗺️',
		description: 'Maintenant, ensuite, plus tard',
		blocks: [
			callout('🧭', 'Cap pour les prochains mois'),
			{ type: 'columns', attrs: { count: 3 }, content: ['Maintenant', 'Ensuite', 'Plus tard'].map((title) => ({ type: 'column', content: [h(3, title), todo('')] })) },
			h(2, 'Notes'),
			p(),
		],
	},
];

export const pageTemplate = (id: unknown) => PAGE_TEMPLATES.find((t) => t.id === id) ?? null;
