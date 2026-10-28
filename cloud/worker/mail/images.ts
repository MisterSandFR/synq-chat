import { safeUrl } from '../media';
import { binary } from './mime';

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();
const TIMEOUT = 8000;
const MAX_REDIRECTS = 4;
export const IMAGE_MAX = 10 * 1024 * 1024;
const UA = 'Mozilla/5.0 (compatible; SynqImageProxy/1.0)';
// image/jpg et image/pjpeg : variantes non standard servies par de vieux serveurs d'emailing.
const TYPES: Record<string, string> = {
	'image/png': 'image/png',
	'image/jpeg': 'image/jpeg',
	'image/jpg': 'image/jpeg',
	'image/pjpeg': 'image/jpeg',
	'image/gif': 'image/gif',
	'image/webp': 'image/webp',
	'image/avif': 'image/avif',
	'image/bmp': 'image/bmp',
	'image/x-icon': 'image/x-icon',
	'image/vnd.microsoft.icon': 'image/x-icon',
};

// Clé HMAC distincte de la clé AES des mots de passe, dérivée du même secret.
function key(secret: string): Promise<CryptoKey> {
	let found = keys.get(secret);
	if (!found) {
		found = crypto.subtle
			.digest('SHA-256', encoder.encode(`mail-images:${secret}`))
			.then((digest) => crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
		keys.set(secret, found);
	}
	return found;
}

const base64url = (bytes: Uint8Array) => btoa(binary(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function signImage(secret: string, url: string): Promise<string> {
	const mac = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(url));
	return base64url(new Uint8Array(mac).slice(0, 18));
}

export async function proxiedImage(secret: string, origin: string, url: string): Promise<string> {
	// Parenthèses et apostrophes encodées : l'URL va aussi dans un url() CSS sans guillemets.
	const u = encodeURIComponent(url).replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
	return `${origin}/api/mail/img?u=${u}&s=${await signImage(secret, url)}`;
}

export async function validImageSignature(secret: string, url: string, signature: string): Promise<boolean> {
	const expected = await signImage(secret, url);
	if (expected.length !== signature.length) {
		return false;
	}
	let diff = 0;
	for (let i = 0; i < expected.length; i++) {
		diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
	}
	return diff === 0;
}

export type FetchedImage = { body: ReadableStream<Uint8Array>; type: string; size: number | null };

// Redirections suivies à la main : chaque saut est revalidé, y compris contre notre propre hôte.
export async function fetchImage(start: URL, ownHost: string): Promise<FetchedImage | null> {
	const signal = AbortSignal.timeout(TIMEOUT);
	let url: URL | null = start;
	for (let hop = 0; hop <= MAX_REDIRECTS && url; hop++) {
		if (url.hostname.toLowerCase() === ownHost) {
			return null;
		}
		const res = await fetch(url.toString(), {
			redirect: 'manual',
			signal,
			headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/png,image/*;q=0.8' },
		});
		if (res.status >= 300 && res.status < 400) {
			await res.body?.cancel();
			url = safeUrl(res.headers.get('Location') ?? '', url);
			continue;
		}
		const type = TYPES[(res.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase()];
		const length = Number(res.headers.get('Content-Length') ?? NaN);
		if (!res.ok || !res.body || !type || length > IMAGE_MAX) {
			await res.body?.cancel();
			return null;
		}
		let seen = 0;
		const body = res.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					seen += chunk.byteLength;
					if (seen > IMAGE_MAX) {
						controller.error(new Error('Image trop lourde'));
						return;
					}
					controller.enqueue(chunk);
				},
			}),
		);
		return { body, type, size: Number.isFinite(length) ? length : null };
	}
	return null;
}
