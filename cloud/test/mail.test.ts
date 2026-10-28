import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { MailboxInfo, MailThread, MailThreadDetail } from '../shared/mail';
import { ImapClient } from '../worker/mail/imap';
import { parseMail } from '../worker/mail/mime';
import { seal, unseal } from '../worker/mail/secret';
import { buildMessage, smtpSend } from '../worker/mail/smtp';
import { transport, type Duplex, type Opener } from '../worker/mail/wire';
import { privateHost } from '../worker/routes/mail';
import { workspaceWithMember } from './helpers';

const encoder = new TextEncoder();
const utf8b64 = (text: string) => btoa(String.fromCharCode(...encoder.encode(text)));

type Handler = (line: string, send: (data: string | Uint8Array) => void) => void;

// Faux serveur ligne à ligne branché sur des flux mémoire.
function fakeServer(greeting: string, handler: () => Handler) {
	const lines: string[] = [];
	const tls = { upgraded: false };
	const open: Opener = () => {
		const handle = handler();
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const readable = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
		const send = (data: string | Uint8Array) => controller.enqueue(typeof data === 'string' ? encoder.encode(data) : data);
		let pending = '';
		const writable = new WritableStream<Uint8Array>({
			write(chunk) {
				pending += new TextDecoder().decode(chunk);
				for (let end = pending.indexOf('\r\n'); end >= 0; end = pending.indexOf('\r\n')) {
					const line = pending.slice(0, end);
					pending = pending.slice(end + 2);
					lines.push(line);
					handle(line, send);
				}
			},
		});
		const duplex: Duplex = {
			readable,
			writable,
			startTls: () => {
				tls.upgraded = true;
				return duplex;
			},
			close: () => {
				try {
					controller.close();
				} catch {
					// Déjà fermé.
				}
			},
		};
		send(greeting);
		return duplex;
	};
	return { open, lines, tls };
}

const FIRST = [
	'From: "Jean Dupont" <jean@client.test>',
	'To: Support <support@synq.test>',
	`Subject: =?UTF-8?B?${utf8b64('Problème de facture')}?=`,
	'Message-ID: <m1@client.test>',
	'Date: Tue, 27 Oct 2026 09:00:00 +0100',
	'MIME-Version: 1.0',
	'Content-Type: multipart/mixed; boundary="b1"',
	'',
	'--b1',
	'Content-Type: text/plain; charset=utf-8',
	'Content-Transfer-Encoding: quoted-printable',
	'',
	'Bonjour, la facture est fausse depuis l=E2=80=99=C3=A9t=C3=A9.',
	'--b1',
	'Content-Type: application/pdf; name="facture.pdf"',
	'Content-Disposition: attachment; filename="facture.pdf"',
	'Content-Transfer-Encoding: base64',
	'',
	'JVBERi0xLjQ=',
	'--b1--',
	'',
].join('\r\n');

const SECOND = [
	'From: jean@client.test',
	'To: support@synq.test',
	'Subject: Re: Problème',
	'Message-ID: <m2@client.test>',
	'In-Reply-To: <m1@client.test>',
	'References: <m1@client.test>',
	'Date: Tue, 27 Oct 2026 10:00:00 +0100',
	'Content-Type: text/html; charset=utf-8',
	'',
	'<p>Toujours <b>bloqué</b> &amp; urgent</p>',
	'',
].join('\r\n');

const MESSAGES: Record<number, Uint8Array> = { 41: encoder.encode(FIRST), 42: encoder.encode(SECOND) };

const imapServer = () =>
	fakeServer('* OK [CAPABILITY IMAP4rev1] Dovecot ready.\r\n', () => (line, send) => {
		const [tag = '', ...rest] = line.split(' ');
		const command = rest.join(' ');
		if (command.startsWith('LOGIN ')) {
			send(command === 'LOGIN "support@synq.test" "s3cr\\"et"' ? `${tag} OK Logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n`);
		} else if (command === 'SELECT INBOX') {
			send(`* 2 EXISTS\r\n* OK [UIDVALIDITY 7] UIDs valid\r\n${tag} OK [READ-WRITE] Select completed.\r\n`);
		} else if (command.startsWith('UID SEARCH UID ')) {
			send(`* SEARCH 41 42\r\n${tag} OK Search completed.\r\n`);
		} else if (command.startsWith('UID FETCH ')) {
			const uid = Number(command.split(' ')[2]);
			const raw = MESSAGES[uid]!;
			send(`* ${uid - 40} FETCH (UID ${uid} BODY[] {${raw.length}}\r\n`);
			send(raw);
			send(`)\r\n${tag} OK Fetch completed.\r\n`);
		} else if (command === 'LOGOUT') {
			send(`* BYE Logging out\r\n${tag} OK Logout completed.\r\n`);
		} else {
			send(`${tag} BAD Unknown\r\n`);
		}
	});

const smtpServer = () =>
	fakeServer('220 smtp.synq.test ESMTP\r\n', () => {
		let data = false;
		return (line, send) => {
			if (data) {
				if (line === '.') {
					data = false;
					send('250 2.0.0 Ok: queued\r\n');
				}
				return;
			}
			if (line.startsWith('EHLO')) {
				send('250-smtp.synq.test\r\n250-STARTTLS\r\n250 AUTH PLAIN LOGIN\r\n');
			} else if (line === 'STARTTLS') {
				send('220 2.0.0 Ready to start TLS\r\n');
			} else if (line.startsWith('AUTH PLAIN ')) {
				send(atob(line.slice(11)) === '\0support@synq.test\0s3cr"et' ? '235 2.7.0 Authentication successful\r\n' : '535 5.7.8 Authentication failed\r\n');
			} else if (line.startsWith('MAIL FROM:') || line.startsWith('RCPT TO:')) {
				send('250 2.1.0 Ok\r\n');
			} else if (line === 'DATA') {
				data = true;
				send('354 End data with <CR><LF>.<CR><LF>\r\n');
			} else if (line === 'QUIT') {
				send('221 2.0.0 Bye\r\n');
			}
		};
	});

const CONFIG = { host: 'mail.synq.test', username: 'support@synq.test', password: 's3cr"et' };

// Jamais de vrai réseau, y compris pour les alarmes des boîtes créées ici.
transport.open = () => {
	throw new Error('Hors ligne');
};

describe('mail : parsing MIME', () => {
	it('multipart, quoted-printable, base64, mots encodés', () => {
		const mail = parseMail(MESSAGES[41]!);
		expect(mail.subject).toBe('Problème de facture');
		expect(mail.from).toEqual({ name: 'Jean Dupont', address: 'jean@client.test' });
		expect(mail.to).toEqual([{ name: 'Support', address: 'support@synq.test' }]);
		expect(mail.messageId).toBe('<m1@client.test>');
		expect(mail.text).toBe('Bonjour, la facture est fausse depuis l’été.');
		expect(mail.attachments).toHaveLength(1);
		expect(mail.attachments[0]!.name).toBe('facture.pdf');
		expect(new TextDecoder().decode(mail.attachments[0]!.content)).toBe('%PDF-1.4');
		expect(mail.date).toBe(Date.parse('2026-10-27T08:00:00Z'));
	});

	it('HTML seul converti en texte, en-têtes UTF-8 bruts, fil', () => {
		const mail = parseMail(MESSAGES[42]!);
		expect(mail.subject).toBe('Re: Problème');
		expect(mail.text).toBe('Toujours bloqué & urgent');
		expect(mail.inReplyTo).toBe('<m1@client.test>');
		expect(mail.references).toEqual(['<m1@client.test>']);
	});

	it('message construit relu par le parseur', () => {
		const raw = buildMessage({
			fromName: 'Équipe support',
			fromAddr: 'support@synq.test',
			to: ['jean@client.test'],
			subject: 'Re: Problème',
			text: 'Ligne 1\n.Ligne 2',
			messageId: '<r1@synq.test>',
			inReplyTo: '<m1@client.test>',
			references: ['<m1@client.test>'],
		});
		const mail = parseMail(encoder.encode(raw));
		expect(mail).toMatchObject({ subject: 'Re: Problème', inReplyTo: '<m1@client.test>', from: { name: 'Équipe support', address: 'support@synq.test' } });
		expect(mail.text).toBe('Ligne 1\r\n.Ligne 2');
	});
});

describe('mail : secret et hôtes', () => {
	it('chiffrement AES-GCM réversible, aléatoire, lié à la clé', async () => {
		const a = await seal('cle', 'mot de passe');
		expect(a).not.toBe(await seal('cle', 'mot de passe'));
		expect(a).not.toContain('mot');
		expect(await unseal('cle', a)).toBe('mot de passe');
		await expect(unseal('autre', a)).rejects.toThrow();
	});

	it('hôtes internes refusés', () => {
		expect(['localhost', '10.0.0.1', '127.0.0.1', '192.168.1.2', '172.20.0.1', '169.254.1.1', 'mail.local'].every(privateHost)).toBe(true);
		expect(['mail.exemple.fr', '8.8.8.8'].some(privateHost)).toBe(false);
	});
});

describe('mail : protocoles', () => {
	it('IMAP : LOGIN échappé, SELECT, UID SEARCH, UID FETCH littéral', async () => {
		const server = imapServer();
		const client = await ImapClient.open(server.open, 'imap.synq.test', 993, Date.now() + 5000);
		await client.login(CONFIG.username, CONFIG.password);
		expect(await client.select()).toEqual({ uidValidity: 7, exists: 2 });
		expect(await client.searchSince(41)).toEqual([42]);
		const fetched = await client.fetch(42);
		expect(fetched?.size).toBe(MESSAGES[42]!.length);
		expect(new TextDecoder().decode(fetched!.raw!)).toBe(SECOND);
		await client.logout();
		expect(server.lines).toContain('A1 LOGIN "support@synq.test" "s3cr\\"et"');
		expect(server.lines).toContain('A4 UID FETCH 42 BODY.PEEK[]');
	});

	it('IMAP : refus d’authentification remonté', async () => {
		const client = await ImapClient.open(imapServer().open, 'imap.synq.test', 993, Date.now() + 5000);
		await expect(client.login(CONFIG.username, 'faux')).rejects.toThrow(/AUTHENTICATIONFAILED/);
		await client.logout();
	});

	it('connexion coupée avant l’accueil : certificat ou port signalé', async () => {
		const closed: Opener = () => ({
			readable: new ReadableStream({ start: (controller) => controller.close() }),
			writable: new WritableStream(),
			close: () => undefined,
		});
		await expect(ImapClient.open(closed, 'mail.example.org', 993, Date.now() + 2000)).rejects.toThrow('certificat du serveur ne correspond pas');
	});

	it('SMTP 587 : STARTTLS, AUTH PLAIN, dot-stuffing', async () => {
		const server = smtpServer();
		await smtpSend(server.open, { ...CONFIG, port: 587 }, Date.now() + 5000, { from: 'support@synq.test', to: ['jean@client.test'], data: 'Subject: x\r\n\r\n.ligne\nfin' });
		expect(server.tls.upgraded).toBe(true);
		expect(server.lines).toEqual(expect.arrayContaining(['STARTTLS', 'MAIL FROM:<support@synq.test>', 'RCPT TO:<jean@client.test>', '..ligne', 'fin', '.', 'QUIT']));
	});

	it('SMTP 465 : TLS direct, refus d’authentification', async () => {
		const server = smtpServer();
		await expect(smtpSend(server.open, { ...CONFIG, password: 'faux', port: 465 }, Date.now() + 5000)).rejects.toThrow(/535/);
		expect(server.tls.upgraded).toBe(false);
		expect(server.lines).not.toContain('STARTTLS');
	});
});

describe('mail : routes', () => {
	const INPUT = {
		name: 'Support',
		address: 'support@synq.test',
		imapHost: 'imap.synq.test',
		imapPort: 993,
		smtpHost: 'smtp.synq.test',
		smtpPort: 587,
		username: CONFIG.username,
		password: CONFIG.password,
	};

	it('création, partage, grades, relève, assignation, réponse, suppression', async () => {
		const { owner: alice, member: bob, wid, general } = await workspaceWithMember();
		const imap = imapServer();
		const smtp = smtpServer();
		transport.open = (host, port, tls) => (port === 993 ? imap.open : smtp.open)(host, port, tls);

		expect((await alice.req('POST', '/api/mail/boxes', { ...INPUT, imapHost: '10.0.0.5' })).status).toBe(400);
		expect((await alice.req('POST', '/api/mail/boxes', { ...INPUT, smtpPort: 25 })).status).toBe(400);
		expect((await alice.req('POST', '/api/mail/boxes', { ...INPUT, password: '' })).status).toBe(400);
		const created = await alice.req<MailboxInfo>('POST', '/api/mail/boxes', INPUT);
		expect(created.status).toBe(201);
		expect(JSON.stringify(created.data)).not.toContain('s3cr');
		const id = created.data.id;
		const stored = await env.DB.prepare('SELECT secret FROM mailboxes WHERE id = ?').bind(id).first<{ secret: string }>();
		expect(stored!.secret).not.toContain('s3cr');

		// Boîte personnelle : invisible pour Bob.
		expect((await bob.req<MailboxInfo[]>('GET', '/api/mail/boxes')).data.map((b) => b.id)).not.toContain(id);
		expect((await bob.req('PATCH', `/api/mail/boxes/${id}`, INPUT)).status).toBe(404);

		// Bob ne partage pas la boîte d'Alice.
		expect((await bob.req('PUT', `/api/mail/boxes/${id}/shares/${wid}`, { channelIds: [] })).status).toBe(403);

		const shared = await alice.req<MailboxInfo>('PUT', `/api/mail/boxes/${id}/shares/${wid}`, { channelIds: [general.id, 'inconnu'] });
		expect(shared.data.shares).toEqual([{ workspaceId: wid, workspaceName: 'Équipe', channelIds: [general.id], grades: [], reach: 1 }]);
		// Partagée sans grade : rien pour Bob.
		expect((await bob.req<MailboxInfo[]>('GET', '/api/mail/boxes')).data.map((b) => b.id)).not.toContain(id);

		expect((await alice.req('POST', `/api/mail/boxes/${id}/sync`)).status).toBe(200);
		const threads = await alice.req<MailThread[]>('GET', `/api/mail/threads?box=${id}`);
		expect(threads.data).toHaveLength(1);
		const thread = threads.data[0]!;
		expect(thread).toMatchObject({ subject: 'Problème de facture', messageCount: 2, status: 'open', from: 'jean@client.test' });
		expect((await alice.req<MailThread[]>('GET', `/api/mail/threads?workspace=${wid}`)).data).toHaveLength(1);

		expect((await alice.req('PATCH', `/api/mail/threads/${thread.id}`, { assigneeId: bob.user.id })).status).toBe(400);
		expect((await alice.req('PUT', `/api/mail/boxes/${id}/shares/${wid}/grades`, { grades: [{ gradeId: 'default', level: 'view' }] })).status).toBe(200);
		const seen = (await bob.req<MailboxInfo[]>('GET', '/api/mail/boxes')).data.find((b) => b.id === id)!;
		expect(seen.access).toEqual({ owner: false, view: true, reply: false, manage: false });
		expect(seen.config).toBeNull();
		// Lecture seule : pas attribuable.
		expect((await alice.req('PATCH', `/api/mail/threads/${thread.id}`, { assigneeId: bob.user.id })).status).toBe(400);

		const detail = await bob.req<MailThreadDetail>('GET', `/api/mail/threads/${thread.id}`);
		expect(detail.data.messages.map((m) => m.body)).toEqual(['Bonjour, la facture est fausse depuis l’été.', 'Toujours bloqué & urgent']);
		expect((await bob.req('POST', `/api/mail/threads/${thread.id}/reply`, { body: 'Salut' })).status).toBe(403);
		expect((await bob.req('POST', `/api/mail/threads/${thread.id}/notes`, { body: 'Note' })).status).toBe(403);
		expect((await bob.req('PATCH', `/api/mail/threads/${thread.id}`, { status: 'open' })).status).toBe(403);
		const first = detail.data.messages[0]!;
		const file = await bob.raw('GET', `/api/mail/messages/${first.id}/attachments/${first.attachments[0]!.index}`);
		expect(file.headers.get('content-disposition')).toContain('attachment');
		expect(new TextDecoder().decode(await file.arrayBuffer())).toBe('%PDF-1.4');

		expect((await alice.req('PUT', `/api/mail/boxes/${id}/shares/${wid}/grades`, { grades: [{ gradeId: 'default', level: 'reply' }] })).status).toBe(200);
		const socket = await bob.socket(wid);
		const assigned = await alice.req<MailThread>('PATCH', `/api/mail/threads/${thread.id}`, { assigneeId: bob.user.id, status: 'done' });
		expect(assigned.data).toMatchObject({ assigneeId: bob.user.id, assigneeName: 'Bob', status: 'done' });
		expect(await socket.next('mail_assigned')).toMatchObject({ threadId: thread.id, mailboxId: id, by: alice.user.id });
		socket.ws.close();
		expect((await bob.req<MailThread[]>('GET', '/api/mail/threads?status=done&mine=1')).data.map((t) => t.id)).toEqual([thread.id]);

		expect((await alice.req('POST', `/api/mail/threads/${thread.id}/notes`, { body: 'Client prioritaire' })).status).toBe(201);
		const replied = await alice.req('POST', `/api/mail/threads/${thread.id}/reply`, { body: 'Merci, on corrige.' });
		expect(replied.status).toBe(201);
		expect(smtp.tls.upgraded).toBe(true);
		expect(smtp.lines).toEqual(expect.arrayContaining(['RCPT TO:<jean@client.test>', 'In-Reply-To: <m2@client.test>', 'References: <m1@client.test>', ' <m2@client.test>']));
		const after = await alice.req<MailThreadDetail>('GET', `/api/mail/threads/${thread.id}`);
		expect(after.data.messages.map((m) => m.direction)).toEqual(['in', 'in', 'out']);
		expect(after.data.notes.map((n) => n.body)).toEqual(['Client prioritaire']);

		expect((await bob.req('DELETE', `/api/mail/boxes/${id}`)).status).toBe(403);
		expect((await alice.req('DELETE', `/api/mail/boxes/${id}`)).status).toBe(200);
		expect((await alice.req('GET', `/api/mail/threads/${thread.id}`)).status).toBe(404);
	});
});
