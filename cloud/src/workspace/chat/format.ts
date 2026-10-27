export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'quote' | 'list' | 'ordered' | 'codeblock';

export type Edit = { value: string; start: number; end: number };

// Renvoie le texte et la sélection à appliquer au champ.
export function applyFormat(value: string, start: number, end: number, kind: FormatKind): Edit {
	const selected = value.slice(start, end);
	const wrap = (left: string, right: string, placeholder: string): Edit => {
		const inner = selected || placeholder;
		return { value: value.slice(0, start) + left + inner + right + value.slice(end), start: start + left.length, end: start + left.length + inner.length };
	};
	switch (kind) {
		case 'bold':
			return wrap('**', '**', 'texte');
		case 'italic':
			return wrap('_', '_', 'texte');
		case 'strike':
			return wrap('~~', '~~', 'texte');
		case 'code':
			return wrap('`', '`', 'code');
		case 'codeblock':
			return wrap(`${start > 0 && value[start - 1] !== '\n' ? '\n' : ''}\`\`\`\n`, '\n```', 'code');
		case 'link': {
			if (/^https?:\/\/\S+$/.test(selected)) {
				return { value: `${value.slice(0, start)}[texte](${selected})${value.slice(end)}`, start: start + 1, end: start + 6 };
			}
			const label = selected || 'texte';
			const urlStart = start + label.length + 3;
			return { value: `${value.slice(0, start)}[${label}](https://)${value.slice(end)}`, start: urlStart, end: urlStart + 8 };
		}
		default: {
			const lineStart = value.lastIndexOf('\n', start - 1) + 1;
			const found = value.indexOf('\n', end);
			const lineEnd = found < 0 ? value.length : found;
			const lines = value.slice(lineStart, lineEnd).split('\n');
			const prefixed = lines.map((line, i) => `${kind === 'quote' ? '> ' : kind === 'list' ? '- ' : `${i + 1}. `}${line}`).join('\n');
			return { value: value.slice(0, lineStart) + prefixed + value.slice(lineEnd), start: lineStart + prefixed.length, end: lineStart + prefixed.length };
		}
	}
}
