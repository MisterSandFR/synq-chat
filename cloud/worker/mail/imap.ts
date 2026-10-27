import { Wire, type Opener } from './wire';

export const MAX_MESSAGE = 20 * 1024 * 1024;

type Untagged = { line: string; literal: Uint8Array | null; size: number };

const quote = (value: string) => `"${value.replace(/[\\"]/g, (ch) => `\\${ch}`)}"`;

// Sous-ensemble IMAP4rev1 : LOGIN, SELECT, UID SEARCH, UID FETCH BODY.PEEK[].
export class ImapClient {
	private seq = 0;

	private constructor(private readonly wire: Wire) {}

	static async open(opener: Opener, host: string, port: number, deadline: number): Promise<ImapClient> {
		const wire = new Wire(opener(host, port, 'on'), deadline);
		try {
			const greeting = await wire.line();
			if (!/^\* (OK|PREAUTH)\b/i.test(greeting)) {
				throw new Error(`IMAP : accueil inattendu (${greeting.slice(0, 80)})`);
			}
		} catch (error) {
			await wire.close();
			throw error;
		}
		return new ImapClient(wire);
	}

	async command(text: string): Promise<Untagged[]> {
		const tag = `A${++this.seq}`;
		await this.wire.write(`${tag} ${text}\r\n`);
		const untagged: Untagged[] = [];
		for (;;) {
			const line = await this.wire.line();
			if (line.startsWith(`${tag} `)) {
				const status = line.slice(tag.length + 1);
				if (!/^OK\b/i.test(status)) {
					throw new Error(`IMAP : ${status.slice(0, 200)}`);
				}
				return untagged;
			}
			const entry: Untagged = { line, literal: null, size: -1 };
			let match = line.match(/\{(\d+)\}$/);
			while (match) {
				const size = Number(match[1]);
				const data = await this.wire.bytes(size, size <= MAX_MESSAGE);
				if (entry.size < 0) {
					entry.size = size;
					entry.literal = data;
				}
				const rest = await this.wire.line();
				entry.line += ` ${rest}`;
				match = rest.match(/\{(\d+)\}$/);
			}
			untagged.push(entry);
		}
	}

	async login(username: string, password: string): Promise<void> {
		if (/[\r\n]/.test(username + password)) {
			throw new Error('IMAP : identifiants invalides');
		}
		await this.command(`LOGIN ${quote(username)} ${quote(password)}`);
	}

	async select(): Promise<{ uidValidity: number; exists: number }> {
		let uidValidity = 0;
		let exists = 0;
		for (const { line } of await this.command('SELECT INBOX')) {
			const validity = line.match(/\[UIDVALIDITY (\d+)\]/i);
			const count = line.match(/^\* (\d+) EXISTS/i);
			uidValidity = validity ? Number(validity[1]) : uidValidity;
			exists = count ? Number(count[1]) : exists;
		}
		return { uidValidity, exists };
	}

	// `n:*` renvoie toujours le dernier message : filtrage sur l'UID.
	async searchSince(lastUid: number): Promise<number[]> {
		const entries = await this.command(`UID SEARCH UID ${lastUid + 1}:*`);
		const uids = entries.flatMap(({ line }) => (/^\* SEARCH\b/i.test(line) ? line.slice(8).trim().split(/\s+/).filter(Boolean).map(Number) : []));
		return uids.filter((uid) => Number.isInteger(uid) && uid > lastUid).sort((a, b) => a - b);
	}

	async fetch(uid: number): Promise<{ raw: Uint8Array | null; size: number } | null> {
		const entries = await this.command(`UID FETCH ${uid} BODY.PEEK[]`);
		const hit = entries.find((entry) => /^\* \d+ FETCH\b/i.test(entry.line) && entry.size >= 0);
		return hit ? { raw: hit.literal, size: hit.size } : null;
	}

	async logout(): Promise<void> {
		try {
			await this.command('LOGOUT');
		} catch {
			// Serveur déjà parti.
		}
		await this.wire.close();
	}
}
