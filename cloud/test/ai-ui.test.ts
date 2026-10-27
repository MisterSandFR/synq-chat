import { describe, expect, it } from 'vitest';

import { aiErrorText, catchupAfter, splitCitations, toBullets } from '../src/ai/parse';

describe('ai-ui : analyse des réponses', () => {
	it('découpe les citations valides et ignore les autres', () => {
		expect(splitCitations('Oui [1], voir [3] et [9].', 3)).toEqual([
			{ text: 'Oui ' },
			{ cite: 1 },
			{ text: ', voir ' },
			{ cite: 3 },
			{ text: ' et [9].' },
		]);
		expect(splitCitations('Sans source', 0)).toEqual([{ text: 'Sans source' }]);
		expect(splitCitations('[2]', 2)).toEqual([{ cite: 2 }]);
	});

	it('extrait les puces du modèle', () => {
		expect(toBullets('- un\n- deux\n\n* trois')).toEqual(['un', 'deux', 'trois']);
		expect(toBullets('Voici :\n- un\n- deux')).toEqual(['un', 'deux']);
		expect(toBullets('Un paragraphe simple.')).toBeNull();
	});

	it('retrouve le dernier message lu avant ouverture', () => {
		expect(catchupAfter([10, 11, 12, 13, 14], 2)).toBe(12);
		expect(catchupAfter([10, 11], 2)).toBe(0);
		expect(catchupAfter([10, 11], 5)).toBe(0);
	});

	const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });

	it('affiche en clair les limites et pannes de l’IA', () => {
		expect(aiErrorText(apiError(429, 'x'))).toContain('Réessaie dans une minute');
		expect(aiErrorText(apiError(503, 'x'))).toContain('indisponible');
		expect(aiErrorText(apiError(400, 'Message sans texte'))).toBe('Message sans texte');
	});
});
