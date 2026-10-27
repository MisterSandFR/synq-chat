import { emojiByName } from '../../../shared/emoji';

export type Block =
	| { kind: 'p'; text: string }
	| { kind: 'code'; text: string }
	| { kind: 'quote'; text: string }
	| { kind: 'list'; ordered: boolean; start: number; items: string[] };

const FENCE = '```';
const QUOTE_RE = /^>\s?(.*)$/;
const BULLET_RE = /^\s*[-*•]\s+(.*)$/;
const ORDERED_RE = /^\s*(\d{1,4})[.)]\s+(.*)$/;
const SHORTCODE_RE = /:([a-z0-9_+-]{1,32}):/g;

// Groupes : 1 membre, 2 salon, 3 code, 4-5 lien nommé, 6 URL, 7 gras, 8 barré, 9-10 italique, 11 emoji.
export const INLINE_RE = new RegExp(
	[
		'<@([0-9a-f-]{36})>',
		'<#([0-9a-f-]{36})>',
		'`([^`\\n]+)`',
		'\\[([^\\]\\n]{1,200})\\]\\((https?:\\/\\/[^\\s)<]+)\\)',
		"(https?:\\/\\/[^\\s<]+[^\\s<.,;:!?)\\]'\"])",
		'\\*\\*(?=\\S)([^\\n]*?\\S)\\*\\*',
		'~~(?=\\S)([^\\n]*?\\S)~~',
		'(?<![\\p{L}\\p{N}*\\\\])\\*(?=[^\\s*])([^*\\n]*?[^\\s*])\\*(?![\\p{L}\\p{N}*])',
		'(?<![\\p{L}\\p{N}_])_(?=[^\\s_])([^_\\n]*?[^\\s_])_(?![\\p{L}\\p{N}_])',
		':([a-z0-9_+-]{1,32}):',
	].join('|'),
	'gu',
);

export function parseBlocks(text: string): Block[] {
	const lines = text.split('\n');
	const blocks: Block[] = [];
	let para: string[] = [];
	let current: Block | null = null;
	const flush = () => {
		while (para.length && !para[0]!.trim()) {
			para.shift();
		}
		while (para.length && !para.at(-1)!.trim()) {
			para.pop();
		}
		if (para.length) {
			blocks.push({ kind: 'p', text: para.join('\n') });
		}
		para = [];
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const trimmed = line.trimStart();
		if (trimmed.startsWith(FENCE)) {
			flush();
			current = null;
			const after = trimmed.slice(3);
			const close = after.indexOf(FENCE);
			if (close >= 0) {
				blocks.push({ kind: 'code', text: after.slice(0, close) });
				const tail = after.slice(close + 3);
				if (tail.trim()) {
					para.push(tail);
				}
				continue;
			}
			// Mot seul après l'ouverture : nom de langage, ignoré.
			const body = /^[\w+#-]{0,20}$/.test(after.trim()) ? [] : [after];
			let j = i + 1;
			for (; j < lines.length; j++) {
				const end = lines[j]!.indexOf(FENCE);
				if (end >= 0) {
					if (lines[j]!.slice(0, end).trim()) {
						body.push(lines[j]!.slice(0, end));
					}
					break;
				}
				body.push(lines[j]!);
			}
			blocks.push({ kind: 'code', text: body.join('\n') });
			i = j;
			continue;
		}
		const quote = line.match(QUOTE_RE);
		const bullet = quote ? null : line.match(BULLET_RE);
		const ordered = quote || bullet ? null : line.match(ORDERED_RE);
		if (quote) {
			flush();
			if (current?.kind === 'quote') {
				current.text += `\n${quote[1]}`;
			} else {
				current = { kind: 'quote', text: quote[1]! };
				blocks.push(current);
			}
			continue;
		}
		if (bullet || ordered) {
			flush();
			const item = (bullet ? bullet[1] : ordered![2])!;
			if (current?.kind === 'list' && current.ordered === Boolean(ordered)) {
				current.items.push(item);
			} else {
				current = { kind: 'list', ordered: Boolean(ordered), start: ordered ? Number(ordered[1]) : 1, items: [item] };
				blocks.push(current);
			}
			continue;
		}
		current = null;
		para.push(line);
	}
	flush();
	return blocks;
}

export const withEmoji = (text: string) => text.replace(SHORTCODE_RE, (raw, name: string) => emojiByName.get(name)?.char ?? raw);

// Aperçus sur une ligne : marqueurs retirés.
export const stripMarkdown = (text: string) => withEmoji(text).replace(/```|\*\*|~~|`/g, '').replace(/^>\s?/gm, '');

const PICTO_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}️‍⃣])+$/u;

// Message fait seulement d'emojis : affiché en grand.
export function emojiOnly(body: string): boolean {
	const flat = withEmoji(body).replace(/\s+/g, '');
	return flat.length > 0 && flat.length <= 40 && PICTO_RE.test(flat);
}
