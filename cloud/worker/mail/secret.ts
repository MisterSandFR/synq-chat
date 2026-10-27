import { binary, toBytes } from './mime';

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

// Clé AES-256 dérivée de MAIL_KEY : toute chaîne secrète convient.
function key(secret: string): Promise<CryptoKey> {
	let found = keys.get(secret);
	if (!found) {
		found = crypto.subtle
			.digest('SHA-256', encoder.encode(secret))
			.then((digest) => crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']));
		keys.set(secret, found);
	}
	return found;
}

export async function seal(secret: string, plain: string): Promise<string> {
	if (!secret) {
		throw new Error('MAIL_KEY absent');
	}
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), encoder.encode(plain));
	return `v1.${btoa(binary(iv))}.${btoa(binary(new Uint8Array(data)))}`;
}

export async function unseal(secret: string, sealed: string): Promise<string> {
	const [version, iv, data] = sealed.split('.');
	if (!secret || version !== 'v1' || !iv || !data) {
		throw new Error('Secret de boîte illisible');
	}
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBytes(atob(iv)) }, await key(secret), toBytes(atob(data)));
	return new TextDecoder().decode(plain);
}
