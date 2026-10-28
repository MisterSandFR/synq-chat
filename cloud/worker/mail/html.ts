import type { MailHtml } from '../../shared/mail';

// Liste blanche : tout le reste est retiré (contenu gardé) ou supprimé avec son contenu.
const KEEP = new Set(
	'a abbr address article aside b bdi bdo big blockquote br caption center cite code col colgroup dd del details dfn div dl dt em figcaption figure font footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q rp rt ruby s samp section small span strike strong style sub summary sup table tbody td tfoot th thead time tr tt u ul var wbr'.split(
		' ',
	),
);
const DROP = new Set(
	'script noscript iframe frame frameset object embed applet param svg math template title meta link base input select textarea option optgroup audio video source track canvas picture portal dialog xmp noembed noframes plaintext'.split(
		' ',
	),
);
const ATTRS = new Set(
	'abbr align alt background bgcolor border cellpadding cellspacing class color cols colspan datetime dir face headers height href hspace id lang nowrap reversed role rowspan rules scope size span src start style summary title type valign value vspace width'.split(
		' ',
	),
);
const BACKGROUND_TAGS = new Set(['body', 'table', 'td', 'th', 'tr']);
const LINK_RE = /^(https?|mailto|tel):/i;
const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const REMOTE_RE = /^https?:\/\//i;
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const UNSAFE_CSS_RE = /expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import/i;
const REMOTE_CSS_RE = /url\(\s*['"]?\s*https?:/i;
const CSS_URL_RE = /url\(\s*(['"]?)\s*(https?:\/\/[^'")\s]+)\s*\1\s*\)/gi;
const UNSAFE_CSS_GLOBAL_RE = /@import[^;]*;?|expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding/gi;

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const codePoint = (code: number) => (code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '');

// Valeur vue par le navigateur ; une entité inconnue reste telle quelle et fait échouer la validation.
export const decodeEntities = (value: string) =>
	value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (match, entity: string) => {
		if (entity[0] === '#') {
			return codePoint(entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
		}
		return NAMED[entity.toLowerCase()] ?? match;
	});

function validLink(value: string): boolean {
	if (!LINK_RE.test(value)) {
		return false;
	}
	try {
		return LINK_SCHEMES.has(new URL(value).protocol);
	} catch {
		return false;
	}
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Images passées par le proxy : seule notre origine est autorisée en plus des data URI.
export const mailCsp = (images: boolean, origin?: string) => `default-src 'none'; style-src 'unsafe-inline'; img-src data:${images ? ` ${origin ?? 'https:'}` : ''}; font-src data:`;

function wrap(body: string, images: boolean, origin?: string): string {
	return [
		'<!doctype html><html><head><meta charset="utf-8">',
		`<meta http-equiv="Content-Security-Policy" content="${mailCsp(images, origin)}">`,
		'<meta name="referrer" content="no-referrer"><base target="_blank">',
		'<style>body{margin:0;overflow-wrap:anywhere}img{max-width:100%}</style>',
		`</head><body>${body}</body></html>`,
	].join('');
}

export const textDocument = (text: string): MailHtml => ({
	html: wrap(`<div style="white-space:pre-wrap;font-family:inherit">${escapeHtml(text)}</div>`, false),
	blockedImages: 0,
});

export interface SanitizeOptions {
	images: boolean;
	// Data URI d'une image intégrée, null si absente ou trop lourde.
	inline: (cid: string) => Promise<string | null>;
	// URL du proxy pour une image distante, servie depuis `origin`.
	proxy?: { origin: string; url: (remote: string) => Promise<string> };
}

async function replaceAsync(text: string, re: RegExp, replace: (match: RegExpExecArray) => Promise<string>): Promise<string> {
	const parts: Array<string | Promise<string>> = [];
	let last = 0;
	for (const match of text.matchAll(re)) {
		parts.push(text.slice(last, match.index), replace(match as RegExpExecArray));
		last = match.index + match[0].length;
	}
	parts.push(text.slice(last));
	return (await Promise.all(parts)).join('');
}

export async function sanitizeMail(html: string, options: SanitizeOptions): Promise<MailHtml> {
	let blockedImages = 0;
	const proxy = options.images ? options.proxy : undefined;
	const proxyCss = (css: string) => (proxy ? replaceAsync(css, CSS_URL_RE, async (m) => (validLink(m[2]!) ? `url(${await proxy.url(m[2]!)})` : 'none')) : Promise.resolve(css));
	const image = async (element: Element, name: string, value: string, allowCid: boolean) => {
		if (allowCid && /^cid:/i.test(value)) {
			let cid = value.slice(4);
			try {
				cid = decodeURIComponent(cid);
			} catch {
				// Identifiant brut.
			}
			const uri = await options.inline(cid);
			if (uri) {
				element.setAttribute(name, uri);
			} else {
				element.removeAttribute(name);
			}
			return;
		}
		if (DATA_IMAGE_RE.test(value)) {
			return;
		}
		if (REMOTE_RE.test(value) && validLink(value)) {
			if (!options.images) {
				blockedImages++;
				element.removeAttribute(name);
			} else if (proxy) {
				element.setAttribute(name, await proxy.url(value));
			}
			return;
		}
		element.removeAttribute(name);
	};
	let css = '';
	const rewriter = new HTMLRewriter()
		// Feuille de style relue en entier : un motif peut chevaucher deux morceaux.
		.on('style', {
			text: async (chunk) => {
				css += chunk.text;
				chunk.remove();
				if (chunk.lastInTextNode) {
					if (!options.images) {
						blockedImages += css.match(new RegExp(REMOTE_CSS_RE.source, 'gi'))?.length ?? 0;
					}
					chunk.replace(await proxyCss(css.replace(/\\/g, '').replace(UNSAFE_CSS_GLOBAL_RE, '/* */')), { html: true });
					css = '';
				}
			},
		})
		.on('*', {
			element: async (element) => {
				const tag = element.tagName.toLowerCase();
				if (DROP.has(tag)) {
					element.remove();
					return;
				}
				if (tag !== 'body' && !KEEP.has(tag)) {
					element.removeAndKeepContent();
					return;
				}
				const attributes = [...element.attributes].map(([name = '', value = '']) => [name, name.toLowerCase(), value] as const);
				const counts = new Map<string, number>();
				for (const [, key] of attributes) {
					counts.set(key, (counts.get(key) ?? 0) + 1);
				}
				for (const [name, key, raw] of attributes) {
					// Attribut en double : le navigateur garde le premier, on retire tout.
					if (!ATTRS.has(key) || counts.get(key)! > 1) {
						for (let i = 0; i < 8 && element.hasAttribute(name); i++) {
							element.removeAttribute(name);
						}
						continue;
					}
					const value = decodeEntities(raw).trim();
					if (key === 'style') {
						if (UNSAFE_CSS_RE.test(value.replace(/\\/g, ''))) {
							element.removeAttribute(name);
						} else if (!options.images && REMOTE_CSS_RE.test(value)) {
							blockedImages++;
						} else if (proxy && REMOTE_CSS_RE.test(value)) {
							// Guillemets doubles changés en simples : la valeur réécrite ne peut pas fermer l'attribut.
							element.setAttribute(name, (await proxyCss(value)).replace(/"/g, "'"));
						}
					} else if (key === 'href') {
						if (tag !== 'a' || !validLink(value)) {
							element.removeAttribute(name);
						}
					} else if (key === 'src') {
						if (tag === 'img') {
							await image(element, name, value, true);
						} else {
							element.removeAttribute(name);
						}
					} else if (key === 'background') {
						if (BACKGROUND_TAGS.has(tag)) {
							await image(element, name, value, false);
						} else {
							element.removeAttribute(name);
						}
					}
				}
				if (tag === 'body') {
					element.tagName = 'div';
				}
				if (tag === 'a') {
					element.setAttribute('target', '_blank');
					element.setAttribute('rel', 'noopener noreferrer');
				}
			},
		})
		.onDocument({
			comments: (comment) => {
				comment.remove();
			},
		});
	const body = await rewriter.transform(new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })).text();
	return { html: wrap(body, options.images, proxy?.origin), blockedImages };
}
