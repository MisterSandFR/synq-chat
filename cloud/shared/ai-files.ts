export const AI_FILE_LIMITS = {
	files: 10,
	size: 20 * 1024 * 1024,
	// Fichiers actifs par personne sur 24 h.
	active: 40,
	ttl: 86_400_000,
	name: 120,
	stored: 120_000,
	// Caractères transmis au modèle, tous fichiers confondus.
	prompt: 24_000,
	blocks: 160,
	text: 2000,
} as const;

export type AiFileKind = 'pdf' | 'docx' | 'xlsx' | 'odt' | 'ods' | 'csv' | 'text' | 'markdown' | 'html' | 'image';

export const AI_FILE_EXT: Record<string, AiFileKind> = {
	pdf: 'pdf',
	docx: 'docx',
	xlsx: 'xlsx',
	odt: 'odt',
	ods: 'ods',
	csv: 'csv',
	txt: 'text',
	md: 'markdown',
	markdown: 'markdown',
	html: 'html',
	htm: 'html',
	png: 'image',
	jpg: 'image',
	jpeg: 'image',
	webp: 'image',
};

export const AI_FILE_ACCEPT = Object.keys(AI_FILE_EXT)
	.map((ext) => `.${ext}`)
	.join(',');

export const AI_FILE_LABEL: Record<AiFileKind, string> = {
	pdf: 'PDF',
	docx: 'Word',
	xlsx: 'Excel',
	odt: 'Texte OpenDocument',
	ods: 'Tableur OpenDocument',
	csv: 'CSV',
	text: 'Texte',
	markdown: 'Markdown',
	html: 'HTML',
	image: 'Image',
};

export const aiFileKind = (name: string): AiFileKind | null => AI_FILE_EXT[/\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase() ?? ''] ?? null;

export interface AiFile {
	id: string;
	name: string;
	kind: AiFileKind;
	type: string;
	size: number;
	chars: number;
	truncated: boolean;
	// URL privée de l'image, servie à son seul propriétaire.
	preview: string | null;
	createdAt: number;
	expiresAt: number;
}

// Structure simple produite par le modèle, convertie en nœuds de l'éditeur à la création.
export type LayoutBlock =
	| { type: 'heading'; level: 1 | 2 | 3; text: string }
	| { type: 'paragraph'; text: string }
	| { type: 'bullets' | 'numbered' | 'todo'; items: string[] }
	| { type: 'callout'; emoji: string; text: string }
	| { type: 'quote'; text: string }
	| { type: 'table'; rows: string[][] }
	| { type: 'columns'; columns: LayoutBlock[][] }
	| { type: 'toggle'; text: string; blocks: LayoutBlock[] }
	| { type: 'divider' }
	| { type: 'toc' }
	| { type: 'image'; file: string; caption: string };

export interface PageDraft {
	title: string;
	icon: string;
	// `gradient:N` ou aucune.
	cover: string | null;
	blocks: LayoutBlock[];
}
