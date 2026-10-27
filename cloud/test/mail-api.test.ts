import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { MailAiResult, MailboxInfo, MailDraft, MailHtml, MailThread, MailThreadDetail, MailUpload } from '../shared/mail';
import type { MessagePage } from '../shared/types';
import { aiRunner } from '../worker/ai';
import { sanitizeMail } from '../worker/mail/html';
import { parseMail } from '../worker/mail/mime';
import { loadBox, storeIncoming, wakeSnoozed } from '../worker/mail/store';
import { transport, type Duplex, type Opener } from '../worker/mail/wire';
import { crc32 } from '../worker/mail/zip';
import { workspaceWithMember } from './helpers';

const encoder = new TextEncoder();
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const noInline = async () => null;
const workerEnv = env as unknown as Env;

// Faux SMTP minimal : accepte tout, garde les lignes reçues.
function smtpServer() {
	const lines: string[] = [];
	const open: Opener = () => {
		let controller!: ReadableStreamDefaultController<Uint8Array>;
		const readable = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
		const send = (data: string) => controller.enqueue(encoder.encode(data));
		let pending = '';
		let data = false;
		const writable = new WritableStream<Uint8Array>({
			write(chunk) {
				pending += new TextDecoder().decode(chunk);
				for (let end = pending.indexOf('\r\n'); end >= 0; end = pending.indexOf('\r\n')) {
					const line = pending.slice(0, end);
					pending = pending.slice(end + 2);
					lines.push(line);
					if (data) {
						if (line === '.') {
							data = false;
							send('250 Ok\r\n');
						}
					} else if (line.startsWith('EHLO')) {
						send('250-smtp.synq.test\r\n250 AUTH PLAIN\r\n');
					} else if (line === 'STARTTLS') {
						send('220 Ready\r\n');
					} else if (line.startsWith('AUTH')) {
						send('235 Ok\r\n');
					} else if (line === 'DATA') {
						data = true;
						send('354 Go\r\n');
					} else if (line === 'QUIT') {
						send('221 Bye\r\n');
					} else {
						send('250 Ok\r\n');
					}
				}
			},
		});
		const duplex: Duplex = { readable, writable, startTls: () => duplex, close: () => undefined };
		send('220 smtp.synq.test ESMTP\r\n');
		return duplex;
	};
	return { open, lines };
}

const HTML_MAIL = [
	'From: "Dupont, Jean" <jean@client.test>',
	'To: Support <support@synq.test>, "Équipe, ventes" <ventes@synq.test>',
	'Cc: chef@client.test',
	'Subject: Devis',
	'Message-ID: <h1@client.test>',
	'Date: Tue, 27 Oct 2026 09:00:00 +0100',
	'Content-Type: multipart/mixed; boundary="m"',
	'',
	'--m',
	'Content-Type: multipart/related; boundary="r"',
	'',
	'--r',
	'Content-Type: multipart/alternative; boundary="a"',
	'',
	'--a',
	'Content-Type: text/plain; charset=utf-8',
	'',
	'Voici le devis.',
	'--a',
	'Content-Type: text/html; charset=utf-8',
	'',
	'<html><head><style>p{color:red}</style><script>alert(1)</script></head><body bgcolor="#fff"><p onclick="x()">Voici le <b>devis</b>.</p><img src="cid:logo@client.test" alt="logo"><img src="https://tracker.test/p.gif"><a href="https://client.test/devis">Lien</a></body></html>',
	'--a--',
	'--r',
	'Content-Type: image/png',
	'Content-ID: <logo@client.test>',
	'Content-Transfer-Encoding: base64',
	'',
	PNG,
	'--r--',
	'--m',
	'Content-Type: application/pdf; name="devis.pdf"',
	'Content-Disposition: attachment; filename="devis.pdf"',
	'Content-Transfer-Encoding: base64',
	'',
	'JVBERi0xLjQ=',
	'--m--',
	'',
].join('\r\n');

const XSS = [
	'<script>alert(1)</script>',
	'<img src=x onerror=alert(1)>',
	'<IMG SRC="javascript:alert(1)">',
	'<a href="javascript:alert(1)">x</a>',
	'<a href="  JaVaScRiPt:alert(1)">x</a>',
	'<a href="jav&#x09;ascript:alert(1)">x</a>',
	'<a href="&#106;avascript:alert(1)">x</a>',
	'<a href="java\tscript:alert(1)">x</a>',
	'<a href="jav&Tab;ascript&colon;alert(1)">x</a>',
	'<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
	'<a href="https://ok.test/" href="javascript:alert(1)">x</a>',
	'<svg onload=alert(1)><script>alert(1)</script></svg>',
	'<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
	'<iframe src="https://evil.test"></iframe>',
	'<object data="https://evil.test/x.swf"></object><embed src="https://evil.test/x.swf">',
	'<form action="https://evil.test"><input name=a><button formaction="javascript:alert(1)">Go</button></form>',
	'<meta http-equiv="refresh" content="0;url=https://evil.test">',
	'<base href="https://evil.test/">',
	'<link rel=stylesheet href=https://evil.test/x.css>',
	'<img srcset="https://evil.test/a.png 1x">',
	'<div style="background:url(javascript:alert(1))">x</div>',
	'<div style="width:expression(alert(1))">x</div>',
	'<div style="@import url(https://evil.test/x.css)">x</div>',
	'<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
	'<details open ontoggle=alert(1)>x</details>',
	'<textarea><img src=x onerror=alert(1)></textarea>',
	'<img src="data:image/svg+xml;base64,PHN2Zy8+">',
	'<image src=x onerror=alert(1)>',
	'<!--<img src=x onerror=alert(1)>-->',
	'<table background="javascript:alert(1)"><tr><td>x</td></tr></table>',
	'<a href="vbscript:msgbox(1)">x</a>',
	'<video><source onerror=alert(1)></video>',
	'<style>@import url(https://evil.test/x.css);</style>',
];

const FORBIDDEN = /<script|onerror|onload|ontoggle|onclick|javascript|vbscript|<iframe|<object|<embed|<form|<input|<button|<svg|<math|<link|<textarea|<video|srcset|formaction|expression\(|evil\.test|data:text|svg\+xml|http-equiv="refresh"/i;

describe('mail : assainissement HTML', () => {
	it('charges XSS classiques neutralisées', async () => {
		for (const payload of XSS) {
			const { html } = await sanitizeMail(payload, { images: true, inline: noInline });
			const body = html.slice(html.indexOf('<body>'));
			expect(body, payload).not.toMatch(FORBIDDEN);
			expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: https:; font-src data:">');
			expect(html).toContain('<base target="_blank">');
		}
	});

	it('liens forcés, images distantes comptées, style gardé', async () => {
		const source = '<style>p{color:red}</style><p>ok</p><a href="https://ok.test/?a=1&amp;b=2" target="_self">lien</a><img src="https://img.test/a.png" alt="a"><td background="https://img.test/b.png">';
		const blocked = await sanitizeMail(source, { images: false, inline: noInline });
		expect(blocked.blockedImages).toBe(2);
		expect(blocked.html).toContain("img-src data:; font-src");
		expect(blocked.html).not.toContain('img.test');
		expect(blocked.html).toContain('<a href="https://ok.test/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">');
		expect(blocked.html).toContain('<style>p{color:red}</style>');
		const shown = await sanitizeMail(source, { images: true, inline: noInline });
		expect(shown.blockedImages).toBe(0);
		expect(shown.html).toContain('src="https://img.test/a.png"');
	});

	it('crc32 de référence', () => {
		expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
	});
});

describe('mail : API v2', () => {
	const INPUT = {
		name: 'Support',
		address: 'support@synq.test',
		imapHost: 'imap.synq.test',
		imapPort: 993,
		smtpHost: 'smtp.synq.test',
		smtpPort: 587,
		username: 'support@synq.test',
		password: 'secret',
	};

	it('HTML, zip, envoi, brouillons, rappel, corbeille, partage, IA', async () => {
		const { owner: alice, member: bob, wid, general } = await workspaceWithMember();
		const smtp = smtpServer();
		transport.open = (host, port, tls) => {
			if (port === 993) {
				throw new Error('Hors ligne');
			}
			return smtp.open(host, port, tls);
		};
		expect(parseMail(encoder.encode(HTML_MAIL)).attachments[0]!.cid).toBe('logo@client.test');

		const box = (await alice.req<MailboxInfo>('POST', '/api/mail/boxes', INPUT)).data;
		expect(await storeIncoming(workerEnv, (await loadBox(env.DB, box.id))!, 7, encoder.encode(HTML_MAIL))).toBe(true);
		const [thread] = (await alice.req<MailThread[]>('GET', `/api/mail/threads?box=${box.id}`)).data;
		expect(thread).toMatchObject({ subject: 'Devis', pinned: false, snoozedUntil: null });
		const detail = (await alice.req<MailThreadDetail>('GET', `/api/mail/threads/${thread!.id}`)).data;
		const incoming = detail.messages[0]!;
		expect(incoming).toMatchObject({
			hasHtml: true,
			body: 'Voici le devis.',
			toList: [
				{ name: 'Support', addr: 'support@synq.test' },
				{ name: 'Équipe, ventes', addr: 'ventes@synq.test' },
			],
			ccList: [{ name: '', addr: 'chef@client.test' }],
		});

		const html = await alice.req<MailHtml>('GET', `/api/mail/messages/${incoming.id}/html?images=0`);
		expect(html.data.blockedImages).toBe(1);
		expect(html.data.html).toContain(`src="data:image/png;base64,${PNG}"`);
		expect(html.data.html).not.toMatch(/<script|onclick|tracker\.test/);
		expect(html.data.html).toContain('<div bgcolor="#fff">');
		expect((await alice.req<MailHtml>('GET', `/api/mail/messages/${incoming.id}/html?images=1`)).data.html).toContain('tracker.test');
		expect((await bob.req('GET', `/api/mail/messages/${incoming.id}/html`)).status).toBe(404);

		const zip = await alice.raw('GET', `/api/mail/messages/${incoming.id}/attachments.zip`);
		expect(zip.headers.get('content-type')).toBe('application/zip');
		const bytes = new Uint8Array(await zip.arrayBuffer());
		expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(0x04034b50);
		expect(new TextDecoder().decode(bytes)).toContain('devis.pdf');
		expect(new TextDecoder().decode(bytes)).toContain('%PDF-1.4');

		const upload = await alice.req<MailUpload>('POST', '/api/mail/uploads', 'contenu', { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent('note é.txt') });
		expect(upload.status).toBe(201);
		expect(upload.data).toMatchObject({ name: 'note é.txt', size: 7, type: 'text/plain' });
		const foreign = await bob.req<MailUpload>('POST', '/api/mail/uploads', 'x', { 'content-type': 'text/plain' });

		const draftId = crypto.randomUUID();
		const draft = await alice.req<MailDraft>('PUT', `/api/mail/drafts/${draftId}`, { mailboxId: box.id, threadId: null, to: [{ name: 'Paul', addr: 'paul@' }], subject: 'Brouillon', text: 'à finir', attachments: [upload.data] });
		expect(draft.data).toMatchObject({ id: draftId, to: [{ name: 'Paul', addr: 'paul@' }], attachments: [upload.data] });
		expect((await alice.req('PUT', `/api/mail/drafts/${draftId}`, { mailboxId: box.id, attachments: [foreign.data] })).status).toBe(400);
		expect((await bob.req('PUT', `/api/mail/drafts/${draftId}`, { mailboxId: box.id })).status).toBe(404);
		expect((await bob.req<MailDraft[]>('GET', '/api/mail/drafts')).data).toEqual([]);
		expect((await alice.req<MailDraft[]>('GET', '/api/mail/drafts')).data.map((d) => d.id)).toEqual([draftId]);

		expect((await alice.req('POST', '/api/mail/send', { mailboxId: box.id, to: ['pas une adresse'], subject: 'x', text: 'x' })).status).toBe(400);
		expect((await alice.req('POST', '/api/mail/send', { mailboxId: box.id, to: ['a@b.test'], text: 'x', attachments: [foreign.data.key] })).status).toBe(400);
		expect((await bob.req('POST', '/api/mail/send', { mailboxId: box.id, to: ['a@b.test'], text: 'x' })).status).toBe(404);
		const sent = await alice.req<MailThreadDetail>('POST', '/api/mail/send', {
			mailboxId: box.id,
			to: ['paul@client.test'],
			cc: ['chef@client.test'],
			bcc: ['archive@synq.test'],
			subject: 'Nouveau',
			text: 'Bonjour Paul',
			attachments: [upload.data.key],
			draftId,
		});
		expect(sent.status).toBe(201);
		expect(sent.data.thread).toMatchObject({ subject: 'Nouveau', messageCount: 1 });
		expect(sent.data.messages[0]).toMatchObject({ direction: 'out', toList: [{ name: '', addr: 'paul@client.test' }], ccList: [{ name: '', addr: 'chef@client.test' }] });
		expect(sent.data.messages[0]!.attachments).toEqual([{ index: 0, name: 'note é.txt', size: 7, type: 'text/plain' }]);
		expect(smtp.lines).toEqual(expect.arrayContaining(['RCPT TO:<paul@client.test>', 'RCPT TO:<chef@client.test>', 'RCPT TO:<archive@synq.test>', 'Cc: <chef@client.test>']));
		expect(smtp.lines.some((line) => line.startsWith('Content-Type: multipart/mixed'))).toBe(true);
		expect(smtp.lines.some((line) => line.includes("filename*=UTF-8''note%20%C3%A9.txt"))).toBe(true);
		expect(smtp.lines.some((line) => line.startsWith('Bcc'))).toBe(false);
		expect((await alice.req<MailDraft[]>('GET', '/api/mail/drafts')).data).toEqual([]);
		expect(await env.FILES.get(upload.data.key)).toBeNull();

		smtp.lines.length = 0;
		const replied = await alice.req<MailThreadDetail>('POST', '/api/mail/send', { mailboxId: box.id, threadId: thread!.id, to: ['jean@client.test'], text: 'Merci' });
		expect(replied.data.messages.map((m) => m.direction)).toEqual(['in', 'out']);
		expect(replied.data.messages[1]!.subject).toBe('Re: Devis');
		expect(smtp.lines).toEqual(expect.arrayContaining(['In-Reply-To: <h1@client.test>', 'References: <h1@client.test>']));

		smtp.lines.length = 0;
		const forward = await alice.req<MailThreadDetail>('POST', '/api/mail/send', { mailboxId: box.id, forwardOf: incoming.id, to: ['compta@synq.test'], text: 'Pour info' });
		expect(forward.data.thread.subject).toBe('Tr: Devis');
		expect(forward.data.messages[0]!.attachments.map((a) => a.name)).toEqual(['piece-jointe-1', 'devis.pdf']);
		expect(forward.data.messages[0]!.body).toContain('---------- Message transféré ----------');

		const later = Date.now() + 3_600_000;
		expect((await alice.req('PATCH', `/api/mail/threads/${thread!.id}`, { snoozedUntil: Date.now() - 1 })).status).toBe(400);
		expect((await alice.req<MailThread>('PATCH', `/api/mail/threads/${thread!.id}`, { snoozedUntil: later })).data.snoozedUntil).toBe(later);
		expect((await alice.req<MailThread>('PATCH', `/api/mail/threads/${forward.data.thread.id}`, { pinned: true })).data.pinned).toBe(true);
		const open = (await alice.req<MailThread[]>('GET', `/api/mail/threads?box=${box.id}`)).data;
		expect(open[0]!.id).toBe(forward.data.thread.id);
		expect(open.map((t) => t.id)).not.toContain(thread!.id);
		expect((await alice.req<MailThread[]>('GET', `/api/mail/threads?box=${box.id}&status=snoozed`)).data.map((t) => t.id)).toEqual([thread!.id]);
		await wakeSnoozed(workerEnv, later);
		expect((await alice.req<MailThread[]>('GET', `/api/mail/threads?box=${box.id}`)).data.map((t) => t.id)).toContain(thread!.id);

		expect((await alice.req('DELETE', `/api/mail/threads/${sent.data.thread.id}`)).status).toBe(200);
		expect((await alice.req<MailThread[]>('GET', `/api/mail/threads?box=${box.id}`)).data.map((t) => t.id)).not.toContain(sent.data.thread.id);
		expect((await alice.req('GET', `/api/mail/threads/${sent.data.thread.id}`)).status).toBe(404);

		expect((await bob.req('POST', `/api/mail/threads/${thread!.id}/share`, { workspaceId: wid, channelId: general.id })).status).toBe(404);
		expect((await alice.req('POST', `/api/mail/threads/${thread!.id}/share`, { workspaceId: wid, channelId: 'inconnu' })).status).toBe(404);
		const shared = await alice.req('POST', `/api/mail/threads/${thread!.id}/share`, { workspaceId: wid, channelId: general.id, comment: 'À traiter' });
		expect(shared.status).toBe(200);
		const page = await bob.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.at(-1)).toMatchObject({ body: 'À traiter', mailCard: { threadId: thread!.id, subject: 'Devis', from: 'Dupont, Jean' } });

		const prompts: string[] = [];
		aiRunner.run = async (_env, task) => {
			prompts.push(task.prompt);
			return task.prompt.includes('tableau JSON') ? 'Voici : [{"label":"Accepter","text":"Ça me va."},{"label":"","text":"x"}]' : '- Devis reçu';
		};
		expect((await alice.req<MailAiResult>('POST', `/api/mail/threads/${thread!.id}/ai`, { action: 'quick' })).data).toEqual({ suggestions: [{ label: 'Accepter', text: 'Ça me va.' }] });
		expect((await alice.req<MailAiResult>('POST', `/api/mail/threads/${thread!.id}/ai`, { action: 'summary' })).data).toEqual({ text: '- Devis reçu' });
		expect(prompts[1]).toContain('Voici le devis.');
		expect((await alice.req('POST', `/api/mail/threads/${thread!.id}/ai`, { action: 'ask' })).status).toBe(400);
		expect((await alice.req('POST', `/api/mail/threads/${thread!.id}/ai`, { action: 'autre' })).status).toBe(400);
		expect((await bob.req('POST', `/api/mail/threads/${thread!.id}/ai`, { action: 'summary' })).status).toBe(404);

		expect((await alice.req('POST', '/api/ai/rewrite', { action: 'inconnu', text: 'x' })).status).toBe(400);
		expect((await alice.req('POST', '/api/ai/rewrite', { action: 'corriger', text: 'x'.repeat(8001) })).status).toBe(400);
		expect((await alice.req<{ text: string }>('POST', '/api/ai/rewrite', { action: 'corriger', text: 'Bonjour **toi**' })).data).toEqual({ text: '- Devis reçu' });
		expect(prompts.at(-1)).toContain('Bonjour **toi**');
		aiRunner.run = async () => {
			throw new Error('panne');
		};
		expect((await alice.req('POST', '/api/ai/rewrite', { action: 'raccourcir', text: 'x' })).status).toBe(503);
	});
});
