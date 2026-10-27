import { MAX_ATTACHMENTS, type LinkPreview } from '../shared/media';
import type { Attachment } from '../shared/types';
import { err, ok, type Result } from './result';

const FETCH_TIMEOUT = 4000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const UA = 'Mozilla/5.0 (compatible; SynqBot/1.0; +https://synq.team)';

// Colonne `attachments` (tableau) ; `attachment` (objet unique) seulement sur les lignes d'avant migration.
export function parseAttachments(list: string | null, legacy: string | null = null): Attachment[] {
	if (list) {
		return JSON.parse(list) as Attachment[];
	}
	return legacy ? [JSON.parse(legacy) as Attachment] : [];
}

// Métadonnées relues depuis R2, jamais depuis le client.
export async function resolveAttachments(files: R2Bucket, workspaceId: string, keys: unknown[]): Promise<Result<Attachment[]>> {
	const unique = [...new Set(keys)];
	if (unique.length > MAX_ATTACHMENTS) {
		return err(400, `${MAX_ATTACHMENTS} fichiers max par message`);
	}
	const prefix = `w/${workspaceId}/`;
	const heads = await Promise.all(unique.map((key) => (typeof key === 'string' && key.startsWith(prefix) ? files.head(key) : null)));
	const attachments: Attachment[] = [];
	for (const [i, object] of heads.entries()) {
		if (!object) {
			return err(400, 'Fichier joint introuvable');
		}
		const key = unique[i] as string;
		attachments.push({
			key,
			name: object.customMetadata?.name ?? key.split('/').pop() ?? 'fichier',
			size: object.size,
			type: object.httpMetadata?.contentType ?? 'application/octet-stream',
		});
	}
	return ok(attachments);
}

const V4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Réseaux non routables publiquement : [base, longueur du préfixe].
const BLOCKED_V4: Array<[number, number]> = [
	[0x00000000, 8],
	[0x0a000000, 8],
	[0x64400000, 10],
	[0x7f000000, 8],
	[0xa9fe0000, 16],
	[0xac100000, 12],
	[0xc0000000, 24],
	[0xc0a80000, 16],
	[0xc6120000, 15],
	[0xe0000000, 3],
];

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.intranet', '.corp'];

function blockedHost(host: string): boolean {
	// IPv6 littérale refusée en bloc : plus sûr que d'énumérer les plages privées.
	if (host.startsWith('[')) {
		return true;
	}
	const v4 = host.match(V4_RE);
	if (v4) {
		const ip = v4.slice(1).reduce((acc, part) => acc * 256 + Number(part), 0);
		return BLOCKED_V4.some(([base, bits]) => ip >>> (32 - bits) === base >>> (32 - bits));
	}
	return host === 'localhost' || !host.includes('.') || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

// DNS non résolu ici : un Worker ne joint pas les réseaux privés, seules les adresses littérales comptent.
export function safeUrl(raw: string, base?: URL): URL | null {
	if (raw.length > 2048) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(raw, base);
	} catch {
		return null;
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) {
		return null;
	}
	return blockedHost(url.hostname.toLowerCase()) ? null : url;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decodeEntities = (text: string) =>
	text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
		if (code.startsWith('#')) {
			const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
		}
		return ENTITIES[code.toLowerCase()] ?? whole;
	});

const tidy = (text: string) => decodeEntities(text).replace(/\s+/g, ' ').trim();

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const ATTR_RE = /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

export function parseOpenGraph(html: string, base: URL): LinkPreview | null {
	const meta = new Map<string, string>();
	for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
		const attrs: Record<string, string> = {};
		for (const m of tag.matchAll(ATTR_RE)) {
			attrs[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
		}
		const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
		if (key && attrs.content !== undefined && !meta.has(key)) {
			meta.set(key, tidy(attrs.content));
		}
	}
	const title = meta.get('og:title') || meta.get('twitter:title') || tidy(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '');
	const description = meta.get('og:description') || meta.get('twitter:description') || meta.get('description') || '';
	if (!title && !description) {
		return null;
	}
	const rawImage = meta.get('og:image') || meta.get('og:image:url') || meta.get('twitter:image');
	const image = rawImage ? safeUrl(rawImage, base) : null;
	return {
		url: base.toString(),
		title: clip(title, 200),
		description: clip(description, 300),
		siteName: clip(meta.get('og:site_name') || base.hostname.replace(/^www\./, ''), 80),
		image: image?.protocol === 'https:' ? image.toString() : null,
	};
}

// Lecture bornée : arrêt à la fin du <head> ou au plafond.
async function readHead(body: ReadableStream<Uint8Array>, charset: string): Promise<string> {
	let decoder: TextDecoder;
	try {
		decoder = new TextDecoder(charset);
	} catch {
		decoder = new TextDecoder();
	}
	const reader = body.getReader();
	let html = '';
	let read = 0;
	try {
		while (read < MAX_BYTES) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			read += value.byteLength;
			html += decoder.decode(value, { stream: true });
			if (/<\/head>/i.test(html)) {
				break;
			}
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	return html.slice(0, MAX_BYTES);
}

// Redirections suivies à la main : chaque saut est revalidé.
async function fetchHtml(start: URL): Promise<{ url: URL; html: string } | null> {
	const signal = AbortSignal.timeout(FETCH_TIMEOUT);
	let url = start;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const res = await fetch(url.toString(), { redirect: 'manual', signal, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' } });
		if (res.status >= 300 && res.status < 400) {
			await res.body?.cancel();
			const next = safeUrl(res.headers.get('Location') ?? '', url);
			if (!next) {
				return null;
			}
			url = next;
			continue;
		}
		const type = res.headers.get('Content-Type') ?? '';
		if (!res.ok || !res.body || !/text\/html|application\/xhtml\+xml/i.test(type)) {
			await res.body?.cancel();
			return null;
		}
		const charset = type.match(/charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8';
		return { url, html: await readHead(res.body, charset) };
	}
	return null;
}

const PREVIEW_TTL = 24 * 3600;
const MISS_TTL = 3600;

export async function unfurl(raw: string, waitUntil: (promise: Promise<unknown>) => void): Promise<Result<LinkPreview | null>> {
	const url = safeUrl(raw);
	if (!url) {
		return err(400, 'Lien non pris en charge');
	}
	url.hash = '';
	const key = new Request(`https://unfurl.synq.internal/${encodeURIComponent(url.toString())}`);
	const cached = await caches.default.match(key);
	if (cached) {
		return ok((await cached.json()) as LinkPreview | null);
	}
	let preview: LinkPreview | null = null;
	try {
		const page = await fetchHtml(url);
		preview = page ? parseOpenGraph(page.html, page.url) : null;
	} catch {
		// Délai dépassé ou site injoignable : pas d'aperçu.
	}
	const response = new Response(JSON.stringify(preview), {
		headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${preview ? PREVIEW_TTL : MISS_TTL}` },
	});
	waitUntil(caches.default.put(key, response));
	return ok(preview);
}
