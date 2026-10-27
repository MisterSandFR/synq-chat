import { connect } from 'cloudflare:sockets';

export interface Duplex {
	readable: ReadableStream<Uint8Array>;
	writable: WritableStream<Uint8Array>;
	startTls?: () => Duplex;
	close: () => Promise<void> | void;
}

export type TlsMode = 'on' | 'starttls';

export type Opener = (host: string, port: number, tls: TlsMode) => Duplex;

type Socket = ReturnType<typeof connect>;

const wrap = (socket: Socket): Duplex => ({
	readable: socket.readable as ReadableStream<Uint8Array>,
	writable: socket.writable as WritableStream<Uint8Array>,
	startTls: () => wrap(socket.startTls()),
	close: () => socket.close(),
});

// Remplaçable en test : aucun vrai serveur mail.
export const transport: { open: Opener } = {
	open: (hostname, port, tls) => wrap(connect({ hostname, port }, { secureTransport: tls, allowHalfOpen: false })),
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Lecture ligne à ligne ou octets bruts, avec échéance globale.
export class Wire {
	private reader: ReadableStreamDefaultReader<Uint8Array>;
	private writer: WritableStreamDefaultWriter<Uint8Array>;
	private buffer: Uint8Array = new Uint8Array(0);

	constructor(
		private readonly duplex: Duplex,
		private readonly deadline: number,
	) {
		this.reader = duplex.readable.getReader();
		this.writer = duplex.writable.getWriter();
	}

	private async fill(): Promise<void> {
		const remaining = this.deadline - Date.now();
		if (remaining <= 0) {
			throw new Error('Délai dépassé');
		}
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('Délai dépassé')), remaining);
		});
		try {
			const { value, done } = await Promise.race([this.reader.read(), timeout]);
			if (done || !value) {
				throw new Error('Connexion fermée par le serveur');
			}
			if (this.buffer.length) {
				const next = new Uint8Array(this.buffer.length + value.length);
				next.set(this.buffer);
				next.set(value, this.buffer.length);
				this.buffer = next;
			} else {
				this.buffer = value;
			}
		} finally {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		}
	}

	async line(): Promise<string> {
		for (;;) {
			const end = this.buffer.indexOf(10);
			if (end >= 0) {
				const text = decoder.decode(this.buffer.subarray(0, end > 0 && this.buffer[end - 1] === 13 ? end - 1 : end));
				this.buffer = this.buffer.subarray(end + 1);
				return text;
			}
			if (this.buffer.length > 64 * 1024) {
				throw new Error('Ligne trop longue');
			}
			await this.fill();
		}
	}

	// `keep` faux : octets lus puis jetés (message trop gros).
	async bytes(count: number, keep: boolean): Promise<Uint8Array | null> {
		const out = keep ? new Uint8Array(count) : null;
		let got = 0;
		while (got < count) {
			if (!this.buffer.length) {
				await this.fill();
			}
			const take = Math.min(count - got, this.buffer.length);
			out?.set(this.buffer.subarray(0, take), got);
			got += take;
			this.buffer = this.buffer.subarray(take);
		}
		return out;
	}

	async write(data: string | Uint8Array): Promise<void> {
		await this.writer.write(typeof data === 'string' ? encoder.encode(data) : data);
	}

	// Flux libérés avant STARTTLS : le socket chiffré repart de zéro.
	upgrade(): Wire {
		if (!this.duplex.startTls) {
			throw new Error('STARTTLS indisponible');
		}
		this.release();
		return new Wire(this.duplex.startTls(), this.deadline);
	}

	async close(): Promise<void> {
		this.release();
		try {
			await this.duplex.close();
		} catch {
			// Déjà fermé.
		}
	}

	private release(): void {
		try {
			this.reader.releaseLock();
			this.writer.releaseLock();
		} catch {
			// Lecture en attente après délai dépassé.
		}
	}
}
