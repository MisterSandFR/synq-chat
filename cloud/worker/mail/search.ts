// Recherche sans FTS5 : une table virtuelle en D1 bloque `wrangler d1 export`.

// Un caractère pour un caractère : les positions trouvées dans la forme normalisée valent dans le texte d'origine.
export function fold(text: string): string {
	return Array.from(text, (ch) => ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()[0] ?? ch).join('');
}

export function searchTerms(query: string): string[] {
	const terms = fold(query.normalize('NFC'))
		.split(/\s+/)
		.map((term) => term.replace(/[%_\\]/g, ''))
		.filter((term) => term.length >= 2);
	return [...new Set(terms)].slice(0, 6);
}

export function excerpt(text: string, terms: string[], mark: readonly [string, string], radius = 70): string {
	const chars = Array.from(text);
	const folded = Array.from(fold(text));
	const flat = folded.join('');
	const first = Math.min(...terms.map((term) => flat.indexOf(term)).filter((i) => i >= 0));
	const center = Number.isFinite(first) ? Array.from(flat.slice(0, first)).length : 0;
	const start = Math.max(0, center - radius);
	const end = Math.min(chars.length, center + radius);
	const window = folded.slice(start, end).join('');
	const marked = new Array<boolean>(end - start).fill(false);
	for (const term of terms) {
		for (let at = window.indexOf(term); at >= 0; at = window.indexOf(term, at + 1)) {
			for (let i = 0; i < Array.from(term).length; i++) {
				marked[Array.from(window.slice(0, at)).length + i] = true;
			}
		}
	}
	let out = start > 0 ? '…' : '';
	for (let i = start; i < end; i++) {
		const on = marked[i - start];
		if (on && !marked[i - start - 1]) {
			out += mark[0];
		}
		out += chars[i];
		if (on && !marked[i - start + 1]) {
			out += mark[1];
		}
	}
	return (out + (end < chars.length ? '…' : '')).replace(/\s+/g, ' ');
}
