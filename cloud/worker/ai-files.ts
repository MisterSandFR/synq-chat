import { AI_FILE_LABEL, AI_FILE_LIMITS, aiFileKind, type AiFile, type AiFileKind, type LayoutBlock, type PageDraft } from '../shared/ai-files';
import { CANVAS_LIMITS, PAGE_COVER_RE, PAGE_GRADIENTS, type TemplateNode } from '../shared/canvas';
import { jsonOf } from './ai-hub';

export type FileRow = {
	id: string;
	user_id: string;
	name: string;
	kind: AiFileKind;
	type: string;
	size: number;
	markdown: string;
	truncated: number;
	created_at: number;
	expires_at: number;
};

const MIME: Record<Exclude<AiFileKind, 'image'>, string> = {
	pdf: 'application/pdf',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	odt: 'application/vnd.oasis.opendocument.text',
	ods: 'application/vnd.oasis.opendocument.spreadsheet',
	csv: 'text/csv',
	text: 'text/plain',
	markdown: 'text/markdown',
	html: 'text/html',
};

const ID = /^[\w-]{1,64}$/;
const ascii = (s: string) => [...s].map((ch) => ch.charCodeAt(0));
const at = (bytes: Uint8Array, sig: number[], from = 0) => sig.every((v, i) => bytes[from + i] === v);

function contains(bytes: Uint8Array, needle: string, from: number, to: number): boolean {
	const sig = ascii(needle);
	for (let i = bytes.indexOf(sig[0]!, from); i >= 0 && i <= to - sig.length; i = bytes.indexOf(sig[0]!, i + 1)) {
		if (at(bytes, sig, i)) {
			return true;
		}
	}
	return false;
}

// DOCX et XLSX : noms d'entrées lus en clair au début (en-têtes locaux) ou à la fin (répertoire central).
function zipKind(bytes: Uint8Array): AiFileKind | null {
	if (at(bytes, ascii('mimetype'), 30)) {
		if (contains(bytes, 'application/vnd.oasis.opendocument.text', 38, 120)) {
			return 'odt';
		}
		if (contains(bytes, 'application/vnd.oasis.opendocument.spreadsheet', 38, 120)) {
			return 'ods';
		}
	}
	const span = 262_144;
	const tail = Math.max(0, bytes.length - span);
	const has = (name: string) => contains(bytes, name, 0, Math.min(bytes.length, span)) || contains(bytes, name, tail, bytes.length);
	return has('word/document.xml') ? 'docx' : has('xl/workbook.xml') ? 'xlsx' : null;
}

// Signature d'abord : un exécutable renommé en .pdf est refusé.
export function sniff(name: string, bytes: Uint8Array): { kind: AiFileKind; type: string } | null {
	const expected = aiFileKind(name);
	if (!expected || !bytes.length) {
		return null;
	}
	if (expected === 'image') {
		if (at(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
			return { kind: 'image', type: 'image/png' };
		}
		if (at(bytes, [0xff, 0xd8, 0xff])) {
			return { kind: 'image', type: 'image/jpeg' };
		}
		return at(bytes, ascii('RIFF')) && at(bytes, ascii('WEBP'), 8) ? { kind: 'image', type: 'image/webp' } : null;
	}
	if (expected === 'pdf') {
		return at(bytes, ascii('%PDF-')) ? { kind: 'pdf', type: MIME.pdf } : null;
	}
	if (expected === 'docx' || expected === 'xlsx' || expected === 'odt' || expected === 'ods') {
		return at(bytes, [0x50, 0x4b, 0x03, 0x04]) && zipKind(bytes) === expected ? { kind: expected, type: MIME[expected] } : null;
	}
	if (bytes.includes(0)) {
		return null;
	}
	try {
		new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
	} catch {
		return null;
	}
	return { kind: expected, type: MIME[expected] };
}

export function cleanName(raw: string): string {
	const base = raw.split(/[\\/]/).pop() ?? '';
	const name = base
		.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (name.length <= AI_FILE_LIMITS.name) {
		return name || 'fichier';
	}
	const ext = /\.[a-z0-9]{1,8}$/i.exec(name)?.[0] ?? '';
	return name.slice(0, AI_FILE_LIMITS.name - ext.length) + ext;
}

// Remplaçable en test, comme aiRunner.
export const fileRunner = {
	async toMarkdown(env: Env, file: { name: string; type: string; bytes: ArrayBuffer }): Promise<string> {
		const out = await env.AI.toMarkdown(
			{ name: file.name, blob: new Blob([file.bytes], { type: file.type }) },
			{ conversionOptions: { image: { descriptionLanguage: 'fr' }, pdf: { metadata: false } } },
		);
		if (out.format === 'error') {
			throw new Error(out.error);
		}
		return out.data;
	},
};

// Coupe sur une fin de ligne ou un espace proche, jamais au milieu d'un mot.
export function clipText(text: string, max: number): string {
	if (text.length <= max) {
		return text;
	}
	const cut = text.slice(0, max);
	const end = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf(' '));
	return cut.slice(0, end > max * 0.8 ? end : max).trimEnd();
}

export async function extract(env: Env, name: string, sniffed: { kind: AiFileKind; type: string }, bytes: ArrayBuffer): Promise<{ markdown: string; truncated: boolean }> {
	const raw =
		sniffed.kind === 'text' || sniffed.kind === 'markdown' ? new TextDecoder().decode(bytes) : await fileRunner.toMarkdown(env, { name, type: sniffed.type, bytes });
	const text = raw
		.replace(/\r\n?/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return { markdown: clipText(text, AI_FILE_LIMITS.stored), truncated: text.length > AI_FILE_LIMITS.stored };
}

export const fileKey = (userId: string, id: string) => `ai/${userId}/${id}`;

export const toFile = (row: FileRow): AiFile => ({
	id: row.id,
	name: row.name,
	kind: row.kind,
	type: row.type,
	size: row.size,
	chars: row.markdown.length,
	truncated: Boolean(row.truncated),
	preview: row.kind === 'image' ? `/api/ai/hub/files/${row.id}` : null,
	createdAt: row.created_at,
	expiresAt: row.expires_at,
});

export async function activeCount(db: D1Database, userId: string, now: number): Promise<number> {
	const row = await db.prepare('SELECT COUNT(*) AS n FROM ai_files WHERE user_id = ? AND expires_at > ?').bind(userId, now).first<{ n: number }>();
	return row?.n ?? 0;
}

export const insertFile = (db: D1Database, row: FileRow) =>
	db
		.prepare('INSERT INTO ai_files (id, user_id, name, kind, type, size, markdown, truncated, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(row.id, row.user_id, row.name, row.kind, row.type, row.size, row.markdown, row.truncated, row.created_at, row.expires_at)
		.run();

// Fichiers de la personne encore valides, dans l'ordre demandé ; null si l'un manque.
export async function ownFiles(db: D1Database, userId: string, ids: string[], now: number): Promise<FileRow[] | null> {
	if (!ids.length || ids.some((id) => !ID.test(id))) {
		return ids.length ? null : [];
	}
	const { results } = await db
		.prepare(`SELECT * FROM ai_files WHERE user_id = ? AND expires_at > ? AND id IN (${ids.map(() => '?').join(', ')})`)
		.bind(userId, now, ...ids)
		.all<FileRow>();
	const byId = new Map(results.map((row) => [row.id, row]));
	return ids.every((id) => byId.has(id)) ? ids.map((id) => byId.get(id)!) : null;
}

export async function purgeAiFiles(env: Env, now: number): Promise<void> {
	const { results } = await env.DB.prepare('SELECT id, user_id FROM ai_files WHERE expires_at <= ? LIMIT 200').bind(now).all<{ id: string; user_id: string }>();
	if (!results.length) {
		return;
	}
	await env.FILES.delete(results.map((row) => fileKey(row.user_id, row.id)));
	await env.DB.prepare(`DELETE FROM ai_files WHERE id IN (${results.map(() => '?').join(', ')})`)
		.bind(...results.map((row) => row.id))
		.run();
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

// Budget partagé entre les fichiers ; la coupure est annoncée au modèle.
export function filesPrompt(files: FileRow[]): string {
	const budget = Math.max(2000, Math.floor(AI_FILE_LIMITS.prompt / files.length));
	return files
		.map((file, i) => {
			const body = file.markdown.length > budget ? `${clipText(file.markdown, budget)}\n[… contenu tronqué : ${file.markdown.length - budget} caractères non transmis]` : file.markdown || '(contenu vide)';
			return `[Fichier ${i + 1}] ${file.name} (${AI_FILE_LABEL[file.kind]}${file.truncated ? ', extrait partiel' : ''}) :\n${body}`;
		})
		.join('\n\n');
}

const LAYOUT_RE = [/mise en page|mettre en page|mets? en page/i, /\b(fais|faire|fait|cr[ée]e|cr[ée]er|transforme|transformer|convertis|convertir)\b.{0,40}\bpage\b/i, /\bmets?\b.{0,20}\ben forme\b/i];

export const wantsLayout = (text: string) => LAYOUT_RE.some((re) => re.test(text));

const LAYOUT_SCHEMA = `Renvoie uniquement un objet JSON, sans texte autour :
{"title":"titre court","icon":"un emoji","cover":0,"blocks":[…]}
cover : numéro de dégradé de 0 à ${PAGE_GRADIENTS - 1}. Blocs possibles :
{"type":"heading","level":1,"text":"…"} (level 1, 2 ou 3)
{"type":"paragraph","text":"…"}
{"type":"bullets","items":["…"]} ; {"type":"numbered","items":["…"]} ; {"type":"todo","items":["…"]}
{"type":"callout","emoji":"💡","text":"…"}
{"type":"quote","text":"…"}
{"type":"table","rows":[["en-tête","en-tête"],["…","…"]]}
{"type":"columns","columns":[[blocs],[blocs]]} (2 ou 3 colonnes, sans colonnes imbriquées)
{"type":"toggle","text":"titre","blocks":[blocs]}
{"type":"divider"}
{"type":"image","file":1,"caption":"…"} (numéro d'image de la liste)`;

// Identifiants de fichiers remplacés par leur numéro : le modèle ne voit que la liste numérotée.
const forModel = (draft: PageDraft, imageIds: string[]) => JSON.stringify(draft, (key, value: unknown) => (key === 'file' && typeof value === 'string' ? imageIds.indexOf(value) + 1 : value));

export function layoutPrompt(input: { material: string; images: FileRow[]; instruction: string; previous: PageDraft | null }): string {
	const pictures = input.images.length
		? `=== Images disponibles ===\n${input.images.map((f, i) => `[Image ${i + 1}] ${f.name} : ${clipText(oneLine(f.markdown), 300) || 'sans description'}`).join('\n')}\n\n`
		: '';
	const current = input.previous ? `=== Page actuelle (JSON) ===\n${forModel(input.previous, input.images.map((f) => f.id))}\n\n` : '';
	const task = input.previous
		? `Ajuste la page actuelle selon cette consigne : ${input.instruction || 'améliore la mise en page'}. Garde le reste tel quel.`
		: `Mets ce contenu en page comme une belle page de wiki, en français, fidèle à la source : n'invente rien, garde les chiffres, dates et noms. Une courte introduction, des sections titrées, des listes, des tableaux pour les données, des encadrés pour les points clés, des colonnes pour comparer, des citations pour les extraits marquants. Place chaque image à l'endroit où elle sert le propos. Texte des blocs en texte brut : ni HTML, ni Markdown.${input.instruction ? `\nConsigne de la personne : ${input.instruction}` : ''}`;
	return `${input.material}${pictures}${current}=== Tâche ===\n${task}\n\n${LAYOUT_SCHEMA}`;
}

type Check = { images: string[]; model: boolean; count: number; bad: boolean };

const reject = (m: Check): null => {
	m.bad = true;
	return null;
};

const ICON_RE = /^\p{Extended_Pictographic}/u;

const str = (value: unknown, max: number = AI_FILE_LIMITS.text) =>
	typeof value === 'string'
		? value
				.replace(/\*\*(.+?)\*\*/g, '$1')
				.replace(/`([^`]+)`/g, '$1')
				// Balises que le modèle glisse malgré la consigne : le texte des blocs est brut.
				.replace(/<\/?[a-z][^>]*>/gi, '')
				.trim()
				.slice(0, max)
		: typeof value === 'number'
			? String(value)
			: '';

const emoji = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim().length <= CANVAS_LIMITS.icon && ICON_RE.test(value.trim()) ? value.trim() : fallback);

const items = (raw: unknown, max: number, length: number, keepEmpty = false) => (Array.isArray(raw) ? raw : []).slice(0, max).map((v) => str(v, length)).filter((v) => keepEmpty || v);

function blocksOf(raw: unknown, m: Check, nested: boolean): LayoutBlock[] {
	if (!Array.isArray(raw)) {
		reject(m);
		return [];
	}
	return raw.map((b) => blockOf(b, m, nested)).filter((b): b is LayoutBlock => b !== null);
}

function blockOf(raw: unknown, m: Check, nested: boolean): LayoutBlock | null {
	if (++m.count > AI_FILE_LIMITS.blocks || !raw || typeof raw !== 'object') {
		return reject(m);
	}
	const b = raw as Record<string, unknown>;
	switch (b.type) {
		case 'heading': {
			const text = str(b.text, 200);
			const level = Number(b.level);
			return text ? { type: 'heading', level: level === 1 || level === 3 ? level : 2, text } : reject(m);
		}
		case 'paragraph':
		case 'quote': {
			const text = str(b.text);
			return text ? { type: b.type, text } : reject(m);
		}
		case 'bullets':
		case 'numbered':
		case 'todo': {
			const list = items(b.items, 50, 500);
			return list.length ? { type: b.type, items: list } : reject(m);
		}
		case 'callout': {
			const text = str(b.text);
			return text ? { type: 'callout', emoji: emoji(b.emoji, '💡'), text } : reject(m);
		}
		case 'table': {
			const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 40).map((row) => items(row, 8, 300, true));
			const kept = rows.filter((row) => row.some(Boolean));
			return kept.length && kept.length === rows.length ? { type: 'table', rows: kept } : reject(m);
		}
		case 'columns': {
			const raws = Array.isArray(b.columns) ? b.columns : [];
			const columns = nested ? [] : raws.slice(0, 3).map((col) => blocksOf(col, m, true));
			return columns.length >= 2 && columns.every((col) => col.length) && raws.length <= 3 ? { type: 'columns', columns } : reject(m);
		}
		case 'toggle': {
			const text = str(b.text, 200);
			const inner = nested ? [] : blocksOf(b.blocks, m, true);
			return text && inner.length ? { type: 'toggle', text, blocks: inner } : reject(m);
		}
		case 'divider':
			return { type: 'divider' };
		case 'toc':
			return nested ? reject(m) : { type: 'toc' };
		case 'image': {
			const file = m.model ? m.images[Number(b.file) - 1] : typeof b.file === 'string' && m.images.includes(b.file) ? b.file : undefined;
			return file ? { type: 'image', file, caption: str(b.caption, 200) } : reject(m);
		}
		default:
			return reject(m);
	}
}

function draftOf(raw: Record<string, unknown>, m: Check): PageDraft | null {
	const title = str(raw.title, CANVAS_LIMITS.title);
	const blocks = blocksOf(raw.blocks, m, false);
	const n = Number(raw.cover);
	const cover =
		typeof raw.cover === 'string' && PAGE_COVER_RE.test(raw.cover)
			? raw.cover
			: Number.isInteger(n) && raw.cover !== null && n >= 0 && n < PAGE_GRADIENTS
				? `gradient:${n}`
				: m.model
					? 'gradient:0'
					: raw.cover == null
						? null
						: reject(m);
	if (!title || !blocks.length || (m.bad && !m.model)) {
		return null;
	}
	return { title, icon: emoji(raw.icon, '📄'), cover, blocks };
}

export function imagesIn(blocks: LayoutBlock[], out = new Set<string>()): Set<string> {
	for (const block of blocks) {
		if (block.type === 'image') {
			out.add(block.file);
		} else if (block.type === 'columns') {
			block.columns.forEach((col) => imagesIn(col, out));
		} else if (block.type === 'toggle') {
			imagesIn(block.blocks, out);
		}
	}
	return out;
}

// Réponse du modèle : blocs inconnus écartés, images oubliées ajoutées en fin de page.
export function draftFromModel(text: string, imageIds: string[]): PageDraft | null {
	const raw = jsonOf(text);
	const draft = raw ? draftOf(raw, { images: imageIds, model: true, count: 0, bad: false }) : null;
	if (!draft) {
		return null;
	}
	const placed = imagesIn(draft.blocks);
	imageIds.filter((id) => !placed.has(id)).forEach((file) => draft.blocks.push({ type: 'image', file, caption: '' }));
	if (draft.blocks.filter((b) => b.type === 'heading').length >= 5 && !draft.blocks.some((b) => b.type === 'toc')) {
		draft.blocks.unshift({ type: 'toc' });
	}
	return draft;
}

// Aperçu renvoyé par la personne : tout écart au schéma refuse la page entière.
export function cleanDraft(raw: unknown, imageIds: string[]): PageDraft | null {
	return raw && typeof raw === 'object' && !Array.isArray(raw) ? draftOf(raw as Record<string, unknown>, { images: imageIds, model: false, count: 0, bad: false }) : null;
}

const textNodes = (text: string): TemplateNode[] => (text ? [{ type: 'text', text }] : []);

// Un saut de ligne simple devient une espace : un paragraphe ProseMirror ne porte pas de « \n ».
const paragraphs = (text: string): TemplateNode[] =>
	text
		.split(/\n{2,}/)
		.map((part) => part.replace(/\s*\n\s*/g, ' ').trim())
		.filter(Boolean)
		.map((part) => ({ type: 'paragraph', content: textNodes(part) }));

const para = (text: string): TemplateNode => ({ type: 'paragraph', content: textNodes(text.replace(/\s*\n\s*/g, ' ')) });

export function toTemplate(blocks: LayoutBlock[], images: Map<string, { src: string; alt: string }>): TemplateNode[] {
	return blocks.flatMap((block): TemplateNode[] => {
		switch (block.type) {
			case 'heading':
				return [{ type: 'heading', attrs: { level: block.level }, content: textNodes(block.text) }];
			case 'paragraph':
				return paragraphs(block.text);
			case 'quote':
				return [{ type: 'blockquote', content: paragraphs(block.text) }];
			case 'callout':
				return [{ type: 'callout', attrs: { emoji: block.emoji }, content: paragraphs(block.text) }];
			case 'bullets':
				return [{ type: 'bulletList', content: block.items.map((text) => ({ type: 'listItem', content: [para(text)] })) }];
			case 'numbered':
				return [{ type: 'orderedList', attrs: { start: 1 }, content: block.items.map((text) => ({ type: 'listItem', content: [para(text)] })) }];
			case 'todo':
				return [{ type: 'taskList', content: block.items.map((text) => ({ type: 'taskItem', attrs: { checked: false }, content: [para(text)] })) }];
			case 'table': {
				const width = Math.max(...block.rows.map((row) => row.length));
				return [
					{
						type: 'table',
						content: block.rows.map((row, r) => ({
							type: 'tableRow',
							content: Array.from({ length: width }, (_, i) => ({ type: r === 0 && block.rows.length > 1 ? 'tableHeader' : 'tableCell', content: [para(row[i] ?? '')] })),
						})),
					},
				];
			}
			case 'columns':
				return [
					{
						type: 'columns',
						attrs: { count: block.columns.length },
						content: block.columns.map((col) => {
							const inner = toTemplate(col, images);
							return { type: 'column', content: inner.length ? inner : [para('')] };
						}),
					},
				];
			case 'toggle': {
				const inner = toTemplate(block.blocks, images);
				return [
					{
						type: 'toggle',
						attrs: { open: true },
						content: [
							{ type: 'toggleSummary', content: textNodes(block.text) },
							{ type: 'toggleBody', content: inner.length ? inner : [para('')] },
						],
					},
				];
			}
			case 'divider':
				return [{ type: 'horizontalRule' }];
			case 'toc':
				return [{ type: 'toc' }];
			case 'image': {
				const image = images.get(block.file);
				return image ? [{ type: 'image', attrs: { src: image.src, alt: block.caption || image.alt } }, ...(block.caption ? [para(block.caption)] : [])] : [];
			}
		}
	});
}
