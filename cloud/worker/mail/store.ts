import type { MailMessage } from '../../shared/mail';
import type { User } from '../../shared/types';
import { ImapClient } from './imap';
import { formatAddresses, parseMail } from './mime';
import { unseal } from './secret';
import { buildMessage, smtpSend, type OutgoingAttachment } from './smtp';
import type { Opener } from './wire';

export interface BoxRow {
	id: string;
	owner_id: string;
	name: string;
	address: string;
	imap_host: string;
	imap_port: number;
	smtp_host: string;
	smtp_port: number;
	username: string;
	secret: string;
	uid_validity: number;
	last_uid: number;
	synced_at: number | null;
	sync_error: string | null;
	created_at: number;
}

// Erreur métier affichable telle quelle.
export class MailError extends Error {}

const FIRST_SYNC = 50;
const PER_RUN = 25;
const MAX_ATTACHMENTS = 20;

export const bodyKey = (boxId: string, messageId: string) => `mail/${boxId}/${messageId}/body`;

export const attachmentKey = (boxId: string, messageId: string, index: number) => `mail/${boxId}/${messageId}/${index}`;

// HTML brut, assaini à la lecture : les règles peuvent évoluer sans relève.
export const htmlKey = (boxId: string, messageId: string) => `mail/${boxId}/${messageId}/html`;

const MAX_HTML = 2 * 1024 * 1024;

export const loadBox = (db: D1Database, id: string) => db.prepare('SELECT * FROM mailboxes WHERE id = ?').bind(id).first<BoxRow>();

const snippet = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 200);

async function findThread(db: D1Database, boxId: string, ids: string[]): Promise<string | null> {
	const refs = [...new Set(ids.filter(Boolean))].slice(-20);
	if (!refs.length) {
		return null;
	}
	const row = await db
		.prepare(`SELECT thread_id FROM mail_messages WHERE mailbox_id = ? AND message_id IN (${refs.map(() => '?').join(', ')}) ORDER BY date DESC LIMIT 1`)
		.bind(boxId, ...refs)
		.first<{ thread_id: string }>();
	return row?.thread_id ?? null;
}

export async function storeIncoming(env: Env, box: BoxRow, uid: number | null, raw: Uint8Array): Promise<boolean> {
	const mail = parseMail(raw);
	const messageId = mail.messageId || `<${box.id}.${uid ?? crypto.randomUUID()}@synq.invalid>`;
	if (await env.DB.prepare('SELECT 1 FROM mail_messages WHERE mailbox_id = ? AND message_id = ?').bind(box.id, messageId).first()) {
		return false;
	}
	const existing = await findThread(env.DB, box.id, [mail.inReplyTo ?? '', ...mail.references]);
	const id = crypto.randomUUID();
	const now = Date.now();
	const date = mail.date ?? now;
	const attachments = mail.attachments.slice(0, MAX_ATTACHMENTS);
	const html = mail.html.length <= MAX_HTML ? mail.html : '';
	await Promise.all([
		env.FILES.put(bodyKey(box.id, id), mail.text, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } }),
		...(html ? [env.FILES.put(htmlKey(box.id, id), html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } })] : []),
		...attachments.map((a, i) => env.FILES.put(attachmentKey(box.id, id, i), a.content, { httpMetadata: { contentType: a.type }, customMetadata: { name: a.name } })),
	]);
	const threadId = existing ?? crypto.randomUUID();
	const from = mail.from?.name || mail.from?.address || '';
	const text = snippet(mail.text);
	const subject = mail.subject.slice(0, 300);
	await env.DB.batch([
		existing
			? env.DB.prepare(
					"UPDATE mail_threads SET snippet = ?, participants = ?, message_count = message_count + 1, last_at = MAX(last_at, ?), status = 'open', snoozed_until = NULL, deleted_at = NULL WHERE id = ?",
				).bind(
					text,
					from,
					date,
					threadId,
				)
			: env.DB.prepare(
					"INSERT INTO mail_threads (id, mailbox_id, subject, snippet, participants, status, message_count, last_at, created_at) VALUES (?, ?, ?, ?, ?, 'open', 1, ?, ?)",
				).bind(threadId, box.id, subject, text, from, date, now),
		env.DB.prepare(
			"INSERT INTO mail_messages (id, mailbox_id, thread_id, uid, message_id, in_reply_to, refs, reply_to, direction, from_name, from_addr, to_addrs, cc_addrs, subject, snippet, attachments, date, created_at, has_html) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		).bind(
			id,
			box.id,
			threadId,
			uid,
			messageId,
			mail.inReplyTo,
			mail.references.join(' '),
			mail.replyTo?.address ?? null,
			mail.from?.name ?? '',
			mail.from?.address ?? '',
			formatAddresses(mail.to),
			formatAddresses(mail.cc),
			subject,
			text,
			JSON.stringify(attachments.map((a, index) => ({ index, name: a.name, size: a.content.byteLength, type: a.type, ...(a.cid ? { cid: a.cid } : {}) }))),
			date,
			now,
			html ? 1 : 0,
		),
	]);
	return true;
}

// Cron : fils en rappel échus de nouveau ouverts.
export async function wakeSnoozed(env: Env, now: number): Promise<void> {
	await env.DB.prepare("UPDATE mail_threads SET snoozed_until = NULL, status = 'open' WHERE snoozed_until IS NOT NULL AND snoozed_until <= ?").bind(now).run();
}

export interface Outgoing {
	// Fil existant de la même boîte, déjà vérifié par la route.
	threadId: string | null;
	to: string[];
	cc: string[];
	bcc: string[];
	subject: string;
	text: string;
	attachments: OutgoingAttachment[];
}

export async function sendMail(env: Env, box: BoxRow, user: User, out: Outgoing, opener: Opener): Promise<string> {
	const last = out.threadId
		? await env.DB.prepare('SELECT message_id, refs FROM mail_messages WHERE thread_id = ? ORDER BY date DESC, created_at DESC LIMIT 1')
				.bind(out.threadId)
				.first<{ message_id: string; refs: string }>()
		: null;
	const recipients = [...new Set([...out.to, ...out.cc, ...out.bcc])];
	if (!recipients.length) {
		throw new MailError('Destinataire requis');
	}
	const messageId = `<${crypto.randomUUID()}@${box.address.split('@')[1] ?? 'synq.invalid'}>`;
	const references = last ? [...last.refs.split(/\s+/).filter(Boolean), last.message_id].slice(-20) : [];
	const data = buildMessage({
		fromName: box.name,
		fromAddr: box.address,
		to: out.to,
		cc: out.cc,
		subject: out.subject,
		text: out.text,
		messageId,
		inReplyTo: last?.message_id ?? null,
		references,
		attachments: out.attachments,
	});
	await smtpSend(
		opener,
		{ host: box.smtp_host, port: box.smtp_port, username: box.username, password: await unseal(env.MAIL_KEY, box.secret) },
		Date.now() + 30_000,
		{ from: box.address, to: recipients, data },
	);
	const id = crypto.randomUUID();
	const now = Date.now();
	const threadId = out.threadId ?? crypto.randomUUID();
	const text = snippet(out.text);
	await Promise.all([
		env.FILES.put(bodyKey(box.id, id), out.text, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } }),
		...out.attachments.map((a, i) => env.FILES.put(attachmentKey(box.id, id, i), a.content, { httpMetadata: { contentType: a.type }, customMetadata: { name: a.name } })),
	]);
	await env.DB.batch([
		out.threadId
			? env.DB.prepare('UPDATE mail_threads SET snippet = ?, message_count = message_count + 1, last_at = ?, deleted_at = NULL WHERE id = ?').bind(text, now, threadId)
			: env.DB.prepare(
					"INSERT INTO mail_threads (id, mailbox_id, subject, snippet, participants, status, message_count, last_at, created_at) VALUES (?, ?, ?, ?, ?, 'open', 1, ?, ?)",
				).bind(threadId, box.id, out.subject.slice(0, 300), text, recipients[0]!, now, now),
		env.DB.prepare(
			"INSERT INTO mail_messages (id, mailbox_id, thread_id, uid, message_id, in_reply_to, refs, reply_to, direction, from_name, from_addr, to_addrs, cc_addrs, subject, snippet, attachments, sent_by, date, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, 'out', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		).bind(
			id,
			box.id,
			threadId,
			messageId,
			last?.message_id ?? null,
			references.join(' '),
			box.name,
			box.address,
			out.to.join(', '),
			out.cc.join(', '),
			out.subject.slice(0, 300),
			text,
			JSON.stringify(out.attachments.map((a, index) => ({ index, name: a.name, size: a.content.byteLength, type: a.type }))),
			user.id,
			now,
			now,
		),
	]);
	return threadId;
}

// Null : boîte supprimée, l'alarme s'arrête.
export async function syncMailbox(env: Env, id: string, opener: Opener): Promise<{ fetched: number } | null> {
	const box = await loadBox(env.DB, id);
	if (!box) {
		return null;
	}
	let fetched = 0;
	let error: string | null = null;
	try {
		const client = await ImapClient.open(opener, box.imap_host, box.imap_port, Date.now() + 50_000);
		try {
			await client.login(box.username, await unseal(env.MAIL_KEY, box.secret));
			const { uidValidity } = await client.select();
			// UIDVALIDITY changée : on repart de zéro, la déduplication passe par Message-ID.
			const lastUid = box.uid_validity && box.uid_validity !== uidValidity ? 0 : box.last_uid;
			const found = await client.searchSince(lastUid);
			const uids = (lastUid === 0 ? found.slice(-FIRST_SYNC) : found).slice(0, PER_RUN);
			for (const uid of uids) {
				const message = await client.fetch(uid);
				try {
					if (message?.raw && (await storeIncoming(env, box, uid, message.raw))) {
						fetched++;
					}
				} catch (cause) {
					// Message illisible : sauté, sinon la relève bloque dessus.
					console.error(JSON.stringify({ level: 'error', message: 'mail store', mailbox: id, uid, error: String(cause) }));
				}
				await env.DB.prepare('UPDATE mailboxes SET last_uid = ?, uid_validity = ? WHERE id = ?').bind(uid, uidValidity, id).run();
			}
			if (!uids.length) {
				await env.DB.prepare('UPDATE mailboxes SET last_uid = ?, uid_validity = ? WHERE id = ?').bind(lastUid, uidValidity, id).run();
			}
		} finally {
			await client.logout();
		}
	} catch (cause) {
		error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 300);
	}
	await env.DB.prepare('UPDATE mailboxes SET synced_at = ?, sync_error = ? WHERE id = ?').bind(Date.now(), error, id).run();
	return { fetched };
}

export async function sendReply(env: Env, box: BoxRow, threadId: string, user: User, text: string, opener: Opener): Promise<MailMessage> {
	const [lastRes, incomingRes, threadRes] = await env.DB.batch([
		env.DB.prepare('SELECT message_id, refs FROM mail_messages WHERE thread_id = ? ORDER BY date DESC, created_at DESC LIMIT 1').bind(threadId),
		env.DB.prepare("SELECT from_addr, reply_to FROM mail_messages WHERE thread_id = ? AND direction = 'in' ORDER BY date DESC LIMIT 1").bind(threadId),
		env.DB.prepare('SELECT subject FROM mail_threads WHERE id = ?').bind(threadId),
	]);
	const last = lastRes!.results[0] as { message_id: string; refs: string } | undefined;
	const incoming = incomingRes!.results[0] as { from_addr: string; reply_to: string | null } | undefined;
	const base = (threadRes!.results[0] as { subject: string } | undefined)?.subject ?? '';
	const to = incoming?.reply_to || incoming?.from_addr;
	if (!to || !last) {
		throw new MailError('Aucun destinataire pour cette conversation');
	}
	const subject = /^re\s*:/i.test(base) ? base : `Re: ${base}`;
	const messageId = `<${crypto.randomUUID()}@${box.address.split('@')[1] ?? 'synq.invalid'}>`;
	const references = [...last.refs.split(/\s+/).filter(Boolean), last.message_id].slice(-20);
	const data = buildMessage({ fromName: box.name, fromAddr: box.address, to: [to], subject, text, messageId, inReplyTo: last.message_id, references });
	await smtpSend(
		opener,
		{ host: box.smtp_host, port: box.smtp_port, username: box.username, password: await unseal(env.MAIL_KEY, box.secret) },
		Date.now() + 30_000,
		{ from: box.address, to: [to], data },
	);
	const id = crypto.randomUUID();
	const now = Date.now();
	await env.FILES.put(bodyKey(box.id, id), text, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } });
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO mail_messages (id, mailbox_id, thread_id, uid, message_id, in_reply_to, refs, reply_to, direction, from_name, from_addr, to_addrs, cc_addrs, subject, snippet, attachments, sent_by, date, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, 'out', ?, ?, ?, '', ?, ?, '[]', ?, ?, ?)",
		).bind(id, box.id, threadId, messageId, last.message_id, references.join(' '), box.name, box.address, to, subject, snippet(text), user.id, now, now),
		env.DB.prepare('UPDATE mail_threads SET snippet = ?, message_count = message_count + 1, last_at = ? WHERE id = ?').bind(snippet(text), now, threadId),
	]);
	return {
		id,
		direction: 'out',
		fromName: box.name,
		fromAddr: box.address,
		to,
		cc: '',
		subject,
		date: now,
		body: text,
		attachments: [],
		sentBy: user.id,
		hasHtml: false,
		toList: [{ name: '', addr: to }],
		ccList: [],
	};
}
