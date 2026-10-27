import { describe, expect, it } from 'vitest';

import type { MailMessage } from '../shared/mail';
import { forwardSubject, forwardText, parseAddresses, relativeDate, replySubject, replyTargets, snoozeChoices, validAddress } from '../src/mail/format';

const message = (patch: Partial<MailMessage>): MailMessage => ({
	id: 'm1',
	direction: 'in',
	fromName: 'Alice',
	fromAddr: 'alice@exemple.fr',
	to: 'support@synq.fr',
	cc: '',
	subject: 'Devis',
	date: Date.UTC(2026, 9, 20, 9),
	body: 'Bonjour',
	attachments: [],
	sentBy: null,
	hasHtml: false,
	toList: [{ name: 'Support', addr: 'support@synq.fr' }, { name: 'Bob', addr: 'bob@exemple.fr' }],
	ccList: [{ name: '', addr: 'carol@exemple.fr' }, { name: '', addr: 'ALICE@exemple.fr' }],
	...patch,
});

describe('format mail', () => {
	it('parse les adresses avec ou sans nom', () => {
		expect(parseAddresses('Alice <alice@exemple.fr>, bob@exemple.fr; "Carol C" <carol@exemple.fr>,')).toEqual([
			{ name: 'Alice', addr: 'alice@exemple.fr' },
			{ name: '', addr: 'bob@exemple.fr' },
			{ name: 'Carol C', addr: 'carol@exemple.fr' },
		]);
		expect(validAddress('a@b.fr')).toBe(true);
		expect(validAddress('pas une adresse')).toBe(false);
	});

	it('préfixe le sujet une seule fois', () => {
		expect(replySubject('Devis')).toBe('Re: Devis');
		expect(replySubject('RE: Devis')).toBe('RE: Devis');
		expect(forwardSubject('')).toBe('Fwd: (sans objet)');
	});

	it('répond à l’expéditeur, ou à tous sans soi ni doublon', () => {
		expect(replyTargets(message({}), 'support@synq.fr', false)).toEqual({ to: [{ name: 'Alice', addr: 'alice@exemple.fr' }], cc: [] });
		const all = replyTargets(message({}), 'support@synq.fr', true);
		expect(all.cc.map((address) => address.addr)).toEqual(['bob@exemple.fr', 'carol@exemple.fr']);
		expect(replyTargets(message({ direction: 'out' }), 'support@synq.fr', false).to).toHaveLength(2);
	});

	it('cite le message transféré', () => {
		const text = forwardText(message({}));
		expect(text).toContain('Message transféré');
		expect(text).toContain('De : Alice <alice@exemple.fr>');
		expect(text.endsWith('Bonjour')).toBe(true);
	});

	it('propose des rappels dans le futur, triés', () => {
		const now = new Date(2026, 9, 27, 10, 15).getTime();
		const choices = snoozeChoices(now);
		expect(choices.map((choice) => choice.key)).toEqual(['later', 'tomorrow', 'week']);
		expect(new Date(choices[1]!.at).getDate()).toBe(28);
		expect(new Date(choices[2]!.at).getDay()).toBe(1);
		expect(choices.every((choice, i) => choice.at > now && (i === 0 || choice.at > choices[i - 1]!.at))).toBe(true);
		expect(snoozeChoices(new Date(2026, 9, 27, 20, 0).getTime())[0]!.key).toBe('tomorrow');
	});

	it('date relative', () => {
		const now = new Date(2026, 9, 27, 15, 0).getTime();
		expect(relativeDate(new Date(2026, 9, 26, 9, 0).getTime(), now)).toBe('Hier');
		expect(relativeDate(new Date(2025, 0, 3).getTime(), now)).toBe('03/01/2025');
	});
});
