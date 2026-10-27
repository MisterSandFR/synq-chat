export interface MailAddress {
	name: string;
	address: string;
}

export interface ParsedAttachment {
	name: string;
	type: string;
	content: Uint8Array;
}

export interface ParsedMail {
	messageId: string;
	inReplyTo: string | null;
	references: string[];
	subject: string;
	from: MailAddress | null;
	replyTo: MailAddress | null;
	to: MailAddress[];
	cc: MailAddress[];
	date: number | null;
	text: string;
	attachments: ParsedAttachment[];
}

// Chaîne « binaire » : un caractère par octet, découpe sans casser l'encodage.
export function binary(bytes: Uint8Array): string {
	let out = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return out;
}

export function toBytes(value: string): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(value.length);
	for (let i = 0; i < value.length; i++) {
		out[i] = value.charCodeAt(i) & 0xff;
	}
	return out;
}

function decodeText(bytes: Uint8Array, charset = 'utf-8'): string {
	const label = charset.trim().toLowerCase() || 'utf-8';
	try {
		return new TextDecoder(label).decode(bytes);
	} catch {
		return /^(iso-8859-1|latin1|us-ascii|ascii)$/.test(label) ? binary(bytes) : new TextDecoder().decode(bytes);
	}
}

function safeAtob(value: string): string {
	const clean = value.replace(/[^A-Za-z0-9+/]/g, '');
	const trimmed = clean.length % 4 === 1 ? clean.slice(0, -1) : clean;
	try {
		return atob(trimmed.padEnd(Math.ceil(trimmed.length / 4) * 4, '='));
	} catch {
		return '';
	}
}

const unhex = (value: string) => value.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

// RFC 2047 : mots encodés adjacents recollés.
export function decodeWords(value: string): string {
	return value
		.replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?)/g, '$1')
		.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, charset: string, mode: string, data: string) =>
			decodeText(toBytes(mode.toUpperCase() === 'B' ? safeAtob(data) : unhex(data.replace(/_/g, ' '))), charset.split('*')[0]),
		);
}

function parseParams(value: string): { value: string; params: Record<string, string> } {
	const parts: string[] = [];
	let current = '';
	let quoted = false;
	for (const ch of value) {
		if (ch === '"') {
			quoted = !quoted;
		}
		if (ch === ';' && !quoted) {
			parts.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	parts.push(current);
	const [first = '', ...rest] = parts;
	const params: Record<string, string> = {};
	// RFC 2231 : nom*0*=utf-8''..., nom*1*=...
	const extended: Record<string, Array<{ index: number; value: string; encoded: boolean }>> = {};
	for (const part of rest) {
		const eq = part.indexOf('=');
		if (eq < 0) {
			continue;
		}
		const key = part.slice(0, eq).trim().toLowerCase();
		let val = part.slice(eq + 1).trim();
		if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
			val = val.slice(1, -1).replace(/\\(.)/g, '$1');
		}
		const match = key.match(/^([^*]+)(?:\*(\d+))?(\*)?$/);
		if (!match) {
			continue;
		}
		const name = match[1]!;
		if (match[2] === undefined && !match[3]) {
			params[name] = val;
		} else {
			(extended[name] ??= []).push({ index: Number(match[2] ?? 0), value: val, encoded: Boolean(match[3]) });
		}
	}
	for (const [name, pieces] of Object.entries(extended)) {
		let charset = 'utf-8';
		let raw = '';
		for (const piece of pieces.sort((a, b) => a.index - b.index)) {
			let val = piece.value;
			if (piece.encoded && piece.index === 0) {
				const head = val.match(/^([^']*)'[^']*'(.*)$/);
				if (head) {
					charset = head[1] || charset;
					val = head[2]!;
				}
			}
			raw += piece.encoded ? val.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : val;
		}
		params[name] = decodeText(toBytes(raw), charset);
	}
	return { value: first.trim(), params };
}

function splitPart(raw: string): { headers: Map<string, string>; body: string } {
	const headers = new Map<string, string>();
	const leading = raw.match(/^\r?\n/);
	if (leading) {
		return { headers, body: raw.slice(leading[0].length) };
	}
	const match = /\r?\n\r?\n/.exec(raw);
	const head = match ? raw.slice(0, match.index) : raw;
	const body = match ? raw.slice(match.index + match[0].length) : '';
	for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
		const colon = line.indexOf(':');
		if (colon <= 0) {
			continue;
		}
		const name = line.slice(0, colon).trim().toLowerCase();
		if (!headers.has(name)) {
			headers.set(name, decodeText(toBytes(line.slice(colon + 1).trim())));
		}
	}
	return { headers, body };
}

function splitMultipart(body: string, boundary: string): string[] {
	const delimiter = `--${boundary}`;
	const parts: string[] = [];
	let current: string[] | null = null;
	for (const line of body.split(/\r?\n/)) {
		if (line.startsWith(delimiter)) {
			if (current) {
				parts.push(current.join('\r\n'));
			}
			if (line.slice(delimiter.length).startsWith('--')) {
				return parts;
			}
			current = [];
			continue;
		}
		current?.push(line);
	}
	if (current) {
		parts.push(current.join('\r\n'));
	}
	return parts;
}

function decodeBody(body: string, encoding: string): Uint8Array {
	if (encoding === 'base64') {
		return toBytes(safeAtob(body));
	}
	if (encoding === 'quoted-printable') {
		return toBytes(unhex(body.replace(/=\r?\n/g, '')));
	}
	return toBytes(body);
}

const safeChar = (code: number) => (code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '');

// Rendu texte seul : jamais de HTML distant servi au client.
export function htmlToText(html: string): string {
	return html
		.replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, n: string) => safeChar(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n: string) => safeChar(parseInt(n, 16)))
		.replace(/&amp;/g, '&')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n');
}

export function parseAddresses(value: string): MailAddress[] {
	const parts: string[] = [];
	let current = '';
	let quoted = false;
	let angle = 0;
	for (const ch of value) {
		if (ch === '"') {
			quoted = !quoted;
		} else if (!quoted && ch === '<') {
			angle++;
		} else if (!quoted && ch === '>') {
			angle = Math.max(0, angle - 1);
		}
		if (ch === ',' && !quoted && !angle) {
			parts.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	parts.push(current);
	return parts.flatMap((part) => {
		const match = part.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
		const address = (match ? match[2]! : part).trim().replace(/^mailto:/i, '');
		if (!/^[^\s@]+@[^\s@]+$/.test(address)) {
			return [];
		}
		const name = match ? decodeWords(match[1]!.replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1')).trim() : '';
		return [{ name, address: address.toLowerCase() }];
	});
}

export const formatAddresses = (list: MailAddress[]) => list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');

const ids = (value = '') => [...value.matchAll(/<([^<>\s]+)>/g)].map((m) => `<${m[1]}>`);

type Collected = { text: string; html: string; attachments: ParsedAttachment[] };

function walk(raw: string, out: Collected, depth: number): void {
	const { headers, body } = splitPart(raw);
	const contentType = parseParams(headers.get('content-type') ?? 'text/plain');
	const type = contentType.value.toLowerCase() || 'text/plain';
	const boundary = contentType.params.boundary;
	if (type.startsWith('multipart/') && boundary && depth < 8) {
		for (const part of splitMultipart(body, boundary)) {
			walk(part, out, depth + 1);
		}
		return;
	}
	const disposition = parseParams(headers.get('content-disposition') ?? '');
	const name = decodeWords(disposition.params.filename ?? contentType.params.name ?? '')
		.replace(/[/\\\0]/g, '_')
		.slice(0, 120);
	const content = decodeBody(body, (headers.get('content-transfer-encoding') ?? '').trim().toLowerCase());
	const inline = disposition.value.toLowerCase() !== 'attachment' && !name;
	if (inline && type === 'text/plain' && !out.text) {
		out.text = decodeText(content, contentType.params.charset);
	} else if (inline && type === 'text/html' && !out.html) {
		out.html = decodeText(content, contentType.params.charset);
	} else {
		out.attachments.push({ name: name || `piece-jointe-${out.attachments.length + 1}`, type: type.replace(/[^\w.+/-]/g, '') || 'application/octet-stream', content });
	}
}

export function parseMail(raw: Uint8Array): ParsedMail {
	const source = binary(raw);
	const { headers } = splitPart(source);
	const out: Collected = { text: '', html: '', attachments: [] };
	walk(source, out, 0);
	const date = Date.parse(headers.get('date') ?? '');
	return {
		messageId: ids(headers.get('message-id'))[0] ?? '',
		inReplyTo: ids(headers.get('in-reply-to'))[0] ?? null,
		references: ids(headers.get('references')).slice(-20),
		subject: decodeWords(headers.get('subject') ?? '')
			.replace(/\s+/g, ' ')
			.trim(),
		from: parseAddresses(headers.get('from') ?? '')[0] ?? null,
		replyTo: parseAddresses(headers.get('reply-to') ?? '')[0] ?? null,
		to: parseAddresses(headers.get('to') ?? ''),
		cc: parseAddresses(headers.get('cc') ?? ''),
		date: Number.isNaN(date) ? null : date,
		text: (out.text || htmlToText(out.html)).trim(),
		attachments: out.attachments,
	};
}
