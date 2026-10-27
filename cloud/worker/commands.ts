import {
	BUILTIN_COMMANDS,
	COMMAND_LIMITS,
	COMMAND_NAME_RE,
	SIGNATURE_HEADER,
	TIMESTAMP_HEADER,
	type CommandConfig,
	type CommandInput,
	type CommandPayload,
	type SlashCommand,
} from '../shared/commands';
import { P, has } from '../shared/permissions';
import { LIMITS, type Actor } from '../shared/types';
import { err, ok, type Result } from './result';

type CommandRow = {
	id: string;
	name: string;
	description: string;
	usage: string;
	url: string;
	secret: string;
	ephemeral: number;
	created_by: string;
	created_at: number;
};

export type CommandTarget = { name: string; url: string; secret: string; ephemeral: boolean };

export type CallResult = { ok: true; text: string; ephemeral: boolean } | { ok: false; error: string };

const DENIED = 'Permission insuffisante';

const canManage = (actor: Actor) => has(actor.perms, P.MANAGE_COMMANDS);

const toConfig = (row: CommandRow): CommandConfig => ({
	id: row.id,
	name: row.name,
	description: row.description,
	usage: row.usage,
	url: row.url,
	ephemeral: row.ephemeral === 1,
	createdBy: row.created_by,
	createdAt: row.created_at,
});

const PRIVATE_V4: Array<[number, number]> = [
	[0x00000000, 8],
	[0x0a000000, 8],
	[0x64400000, 10],
	[0x7f000000, 8],
	[0xa9fe0000, 16],
	[0xac100000, 12],
	[0xc0000000, 24],
	[0xc0a80000, 16],
	[0xc6120000, 15],
	[0xe0000000, 4],
	[0xf0000000, 4],
];

function privateV4(host: string): boolean {
	const value = host.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
	return PRIVATE_V4.some(([base, bits]) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
}

// Loopback, lien local, ULA, multicast et adresses v4 encapsulées : refusés.
function privateV6(host: string): boolean {
	return host.startsWith('::') || /^f[c-d]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('ff') || host.startsWith('64:ff9b:');
}

// Contrôle sur l'URL normalisée : les formes 2130706433 ou 0x7f.1 deviennent 127.0.0.1.
export function isPublicHttpsUrl(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol !== 'https:' || url.username || url.password) {
		return false;
	}
	const host = url.hostname.toLowerCase().replace(/\.$/, '');
	if (host.startsWith('[')) {
		return !privateV6(host.slice(1, -1));
	}
	if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
		return !privateV4(host);
	}
	return host.includes('.') && !/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host);
}

export async function signBody(secret: string, timestamp: number, body: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`));
	return `sha256=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export const listCommands = (sql: SqlStorage): SlashCommand[] =>
	sql
		.exec<Pick<CommandRow, 'name' | 'description' | 'usage'>>('SELECT name, description, usage FROM commands ORDER BY name')
		.toArray()
		.map((row) => ({ name: row.name, description: row.description, usage: row.usage }));

export function listCommandConfigs(sql: SqlStorage, actor: Actor): Result<CommandConfig[]> {
	if (!canManage(actor)) {
		return err(403, DENIED);
	}
	return ok(sql.exec<CommandRow>('SELECT * FROM commands ORDER BY name').toArray().map(toConfig));
}

type Clean = { name: string; description: string; usage: string; url: string; secret: string; ephemeral: boolean };

const cleanText = (value: unknown, fallback: string, max: number) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : fallback);

function clean(input: Partial<CommandInput>, current: CommandRow | null): Result<Clean> {
	const name = typeof input.name === 'string' ? input.name.trim().replace(/^\//, '').toLowerCase() : (current?.name ?? '');
	if (!COMMAND_NAME_RE.test(name)) {
		return err(400, 'Nom invalide : minuscules, chiffres, - ou _, 32 caractères max');
	}
	if (BUILTIN_COMMANDS.some((b) => b.name === name)) {
		return err(400, `/${name} est une commande intégrée`);
	}
	const url = typeof input.url === 'string' ? input.url.trim() : (current?.url ?? '');
	if (url.length > COMMAND_LIMITS.urlLength || !isPublicHttpsUrl(url)) {
		return err(400, 'URL refusée : https vers une adresse publique uniquement');
	}
	const secret = typeof input.secret === 'string' && input.secret !== '' ? input.secret : (current?.secret ?? '');
	if (secret.length < COMMAND_LIMITS.secretMin || secret.length > COMMAND_LIMITS.secretMax) {
		return err(400, `Secret : ${COMMAND_LIMITS.secretMin} à ${COMMAND_LIMITS.secretMax} caractères`);
	}
	return ok({
		name,
		description: cleanText(input.description, current?.description ?? '', COMMAND_LIMITS.descriptionLength),
		usage: cleanText(input.usage, current?.usage ?? '', COMMAND_LIMITS.usageLength),
		url,
		secret,
		ephemeral: typeof input.ephemeral === 'boolean' ? input.ephemeral : current?.ephemeral === 1,
	});
}

const nameTaken = (sql: SqlStorage, name: string, exceptId: string) => sql.exec('SELECT 1 FROM commands WHERE name = ? AND id != ?', name, exceptId).toArray().length > 0;

export function insertCommand(sql: SqlStorage, actor: Actor, input: Partial<CommandInput>): Result<CommandConfig> {
	if (!canManage(actor)) {
		return err(403, DENIED);
	}
	const cleaned = clean(input, null);
	if (!cleaned.ok) {
		return err(cleaned.status, cleaned.error);
	}
	const value = cleaned.value;
	if (nameTaken(sql, value.name, '')) {
		return err(409, `La commande /${value.name} existe déjà`);
	}
	const { n } = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM commands').one();
	if (n >= COMMAND_LIMITS.perWorkspace) {
		return err(400, `${COMMAND_LIMITS.perWorkspace} commandes maximum par espace`);
	}
	const row = sql
		.exec<CommandRow>(
			'INSERT INTO commands (id, name, description, usage, url, secret, ephemeral, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
			crypto.randomUUID(),
			value.name,
			value.description,
			value.usage,
			value.url,
			value.secret,
			value.ephemeral ? 1 : 0,
			actor.id,
			Date.now(),
		)
		.one();
	return ok(toConfig(row));
}

export function editCommand(sql: SqlStorage, actor: Actor, id: string, input: Partial<CommandInput>): Result<CommandConfig> {
	if (!canManage(actor)) {
		return err(403, DENIED);
	}
	const current = sql.exec<CommandRow>('SELECT * FROM commands WHERE id = ?', id).toArray()[0];
	if (!current) {
		return err(404, 'Commande introuvable');
	}
	const cleaned = clean(input, current);
	if (!cleaned.ok) {
		return err(cleaned.status, cleaned.error);
	}
	const value = cleaned.value;
	if (nameTaken(sql, value.name, id)) {
		return err(409, `La commande /${value.name} existe déjà`);
	}
	const row = sql
		.exec<CommandRow>(
			'UPDATE commands SET name = ?, description = ?, usage = ?, url = ?, secret = ?, ephemeral = ? WHERE id = ? RETURNING *',
			value.name,
			value.description,
			value.usage,
			value.url,
			value.secret,
			value.ephemeral ? 1 : 0,
			id,
		)
		.one();
	return ok(toConfig(row));
}

export function removeCommand(sql: SqlStorage, actor: Actor, id: string): Result<null> {
	if (!canManage(actor)) {
		return err(403, DENIED);
	}
	return sql.exec('DELETE FROM commands WHERE id = ? RETURNING id', id).toArray().length ? ok(null) : err(404, 'Commande introuvable');
}

export function findCommand(sql: SqlStorage, name: string): CommandTarget | null {
	const row = sql.exec<CommandRow>('SELECT * FROM commands WHERE name = ?', name).toArray()[0];
	return row ? { name: row.name, url: row.url, secret: row.secret, ephemeral: row.ephemeral === 1 } : null;
}

// Lecture bornée : on coupe dès que la limite est dépassée, sans tout bufferiser.
async function readCapped(response: Response, max: number): Promise<string | null> {
	if (Number(response.headers.get('content-length')) > max) {
		await response.body?.cancel();
		return null;
	}
	if (!response.body) {
		return '';
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		size += value.byteLength;
		if (size > max) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const all = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		all.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(all);
}

// Pas de suivi de redirection : une 3xx pourrait viser une adresse interne.
export async function callCommand(target: CommandTarget, payload: CommandPayload): Promise<CallResult> {
	const label = `/${target.name}`;
	if (!isPublicHttpsUrl(target.url)) {
		return { ok: false, error: `URL de ${label} refusée` };
	}
	const body = JSON.stringify(payload);
	const timestamp = Math.floor(Date.now() / 1000);
	const signal = AbortSignal.timeout(COMMAND_LIMITS.timeoutMs);
	const late = { ok: false, error: `${label} n’a pas répondu à temps` } as const;
	let response: Response;
	try {
		response = await fetch(target.url, {
			method: 'POST',
			redirect: 'manual',
			signal,
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': 'Synq-Commands/1',
				[TIMESTAMP_HEADER]: String(timestamp),
				[SIGNATURE_HEADER]: await signBody(target.secret, timestamp, body),
			},
			body,
		});
	} catch {
		return signal.aborted ? late : { ok: false, error: `${label} est injoignable` };
	}
	if (response.status < 200 || response.status >= 300) {
		await response.body?.cancel();
		return { ok: false, error: `${label} a répondu ${response.status}` };
	}
	let raw: string | null;
	try {
		raw = await readCapped(response, COMMAND_LIMITS.replyBytes);
	} catch {
		return late;
	}
	if (raw === null) {
		return { ok: false, error: `Réponse de ${label} trop volumineuse (16 Ko max)` };
	}
	if (!raw.trim()) {
		return { ok: true, text: '', ephemeral: false };
	}
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		data = null;
	}
	const reply = data as { text?: unknown; ephemeral?: unknown } | null;
	if (!reply || typeof reply !== 'object' || (reply.text !== undefined && typeof reply.text !== 'string')) {
		return { ok: false, error: `Réponse de ${label} invalide : JSON { text, ephemeral } attendu` };
	}
	return { ok: true, text: ((reply.text as string | undefined) ?? '').trim().slice(0, LIMITS.messageLength), ephemeral: reply.ephemeral === true };
}
