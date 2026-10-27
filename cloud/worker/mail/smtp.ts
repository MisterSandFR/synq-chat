import { binary } from './mime';
import { Wire, type Opener } from './wire';

export type SmtpConfig = { host: string; port: number; username: string; password: string };

const encoder = new TextEncoder();
const ADDRESS_RE = /^[^\s<>]+@[^\s<>]+$/;

const b64 = (text: string) => btoa(binary(encoder.encode(text)));

async function reply(wire: Wire): Promise<{ code: number; text: string }> {
	const lines: string[] = [];
	for (;;) {
		const line = await wire.line();
		lines.push(line.slice(4));
		if (line[3] !== '-') {
			return { code: Number(line.slice(0, 3)), text: lines.join(' ') };
		}
	}
}

async function expectCode(wire: Wire, codes: number[], step: string): Promise<void> {
	const { code, text } = await reply(wire);
	if (!codes.includes(code)) {
		throw new Error(`SMTP ${step} : ${code} ${text}`.slice(0, 300));
	}
}

export const dotStuff = (data: string) => data.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');

// 465 : TLS direct ; 587 : STARTTLS. Sans `mail`, vérifie seulement l'authentification.
export async function smtpSend(opener: Opener, config: SmtpConfig, deadline: number, mail?: { from: string; to: string[]; data: string }): Promise<void> {
	const starttls = config.port === 587;
	if (mail && (!ADDRESS_RE.test(mail.from) || !mail.to.length || !mail.to.every((to) => ADDRESS_RE.test(to)))) {
		throw new Error('SMTP : adresse invalide');
	}
	let wire = new Wire(opener(config.host, config.port, starttls ? 'starttls' : 'on'), deadline);
	try {
		await expectCode(wire, [220], 'accueil');
		await wire.write('EHLO synq\r\n');
		await expectCode(wire, [250], 'EHLO');
		if (starttls) {
			await wire.write('STARTTLS\r\n');
			await expectCode(wire, [220], 'STARTTLS');
			wire = wire.upgrade();
			await wire.write('EHLO synq\r\n');
			await expectCode(wire, [250], 'EHLO');
		}
		await wire.write(`AUTH PLAIN ${b64(`\0${config.username}\0${config.password}`)}\r\n`);
		await expectCode(wire, [235], 'authentification');
		if (mail) {
			await wire.write(`MAIL FROM:<${mail.from}>\r\n`);
			await expectCode(wire, [250], 'MAIL FROM');
			for (const to of mail.to) {
				await wire.write(`RCPT TO:<${to}>\r\n`);
				await expectCode(wire, [250, 251], 'RCPT TO');
			}
			await wire.write('DATA\r\n');
			await expectCode(wire, [354], 'DATA');
			const body = dotStuff(mail.data);
			await wire.write(`${body}${body.endsWith('\r\n') ? '' : '\r\n'}.\r\n`);
			await expectCode(wire, [250], 'envoi');
		}
		await wire.write('QUIT\r\n');
		await reply(wire).catch(() => null);
	} finally {
		await wire.close();
	}
}

const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

const word = (value: string) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`);

function sender(name: string, address: string): string {
	if (!name) {
		return `<${address}>`;
	}
	const display = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '')}"` : word(name);
	return `${display} <${address}>`;
}

export function buildMessage(m: {
	fromName: string;
	fromAddr: string;
	to: string[];
	subject: string;
	text: string;
	messageId: string;
	inReplyTo?: string | null;
	references?: string[];
	date?: Date;
}): string {
	const headers = [
		`From: ${sender(oneLine(m.fromName), m.fromAddr)}`,
		`To: ${m.to.map((to) => `<${to}>`).join(', ')}`,
		`Subject: ${word(oneLine(m.subject))}`,
		`Date: ${(m.date ?? new Date()).toUTCString()}`,
		`Message-ID: ${m.messageId}`,
		...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
		...(m.references?.length ? [`References: ${m.references.join('\r\n ')}`] : []),
		'MIME-Version: 1.0',
		'Content-Type: text/plain; charset=utf-8',
		'Content-Transfer-Encoding: base64',
	];
	const body = b64(m.text.replace(/\r?\n/g, '\r\n')).replace(/.{1,76}/g, '$&\r\n');
	return `${headers.join('\r\n')}\r\n\r\n${body}`;
}
