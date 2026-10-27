import { describe, expect, it } from 'vitest';

import { SEARCH_MARK } from '../shared/mail';
import { excerpt, fold, searchTerms } from '../worker/mail/search';

describe('mail : recherche', () => {
	it('normalise sans décaler les positions', () => {
		const text = 'Réunion Élodie à 14 h';
		expect(fold(text)).toBe('reunion elodie a 14 h');
		expect(Array.from(fold(text)).length).toBe(Array.from(text).length);
	});

	it('termes nettoyés, jokers SQL retirés', () => {
		expect(searchTerms('  Échéance 100%_ loyer a ')).toEqual(['echeance', '100', 'loyer']);
	});

	it('extrait centré et surligné sur le texte d’origine', () => {
		const text = `${'Intro '.repeat(30)}Votre appel de loyer pour l’appartement T3 est disponible. ${'Fin '.repeat(30)}`;
		const out = excerpt(text, searchTerms('loyer APPARTEMENT'), SEARCH_MARK);
		expect(out.startsWith('…')).toBe(true);
		expect(out).toContain(`${SEARCH_MARK[0]}loyer${SEARCH_MARK[1]}`);
		expect(out).toContain(`${SEARCH_MARK[0]}appartement${SEARCH_MARK[1]}`);
	});
});

describe('mail : route de recherche', () => {
	it('trouve un mail par son corps, sans accents ni casse, limité à ses boîtes', async () => {
		const { env } = await import('cloudflare:workers');
		const { signup } = await import('./helpers');
		const owner = await signup('Paul');
		const other = await signup('Intrus');
		const now = Date.now();
		const text = 'Avis d’échéance\nGestion <compta@exemple.fr>\nVotre appel de loyer pour l’appartement T3 est disponible.';
		await env.DB.batch([
			env.DB.prepare("INSERT INTO mailboxes (id, owner_id, name, address, imap_host, smtp_host, username, secret, created_at) VALUES ('b1', ?, 'Perso', 'paul@exemple.fr', 'imap.exemple.fr', 'smtp.exemple.fr', 'paul', 'x', ?)").bind(owner.user.id, now),
			env.DB.prepare("INSERT INTO mail_threads (id, mailbox_id, subject, last_at, created_at) VALUES ('t1', 'b1', 'Avis d’échéance', ?, ?)").bind(now, now),
			env.DB.prepare("INSERT INTO mail_messages (id, mailbox_id, thread_id, message_id, direction, date, created_at) VALUES ('m1', 'b1', 't1', '<m1@exemple.fr>', 'in', ?, ?)").bind(now, now),
			env.DB.prepare("INSERT INTO mail_search (mid, mailbox_id, text, norm) VALUES ('m1', 'b1', ?, ?)").bind(text, fold(text)),
		]);
		const found = await owner.req<Array<{ id: string; match: string }>>('GET', `/api/mail/search?q=${encodeURIComponent('ECHEANCE loyer')}`);
		expect(found.status).toBe(200);
		expect(found.data.map((t) => t.id)).toEqual(['t1']);
		expect(found.data[0]!.match).toContain(`${SEARCH_MARK[0]}loyer${SEARCH_MARK[1]}`);
		expect((await owner.req<unknown[]>('GET', '/api/mail/search?q=introuvable')).data).toEqual([]);
		expect((await other.req<unknown[]>('GET', '/api/mail/search?q=loyer')).data).toEqual([]);
	});
});
