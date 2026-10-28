import type { JSONContent } from '@tiptap/core';

const absolute = (src: string) => (src.startsWith('/') ? `${location.origin}${src}` : src);

function inline(nodes: JSONContent[] = []): string {
	return nodes
		.map((node) => {
			if (node.type === 'text') {
				let text = node.text ?? '';
				for (const mark of node.marks ?? []) {
					if (mark.type === 'code') {
						text = `\`${text}\``;
					} else if (mark.type === 'bold') {
						text = `**${text}**`;
					} else if (mark.type === 'italic') {
						text = `_${text}_`;
					} else if (mark.type === 'strike') {
						text = `~~${text}~~`;
					} else if (mark.type === 'link') {
						text = `[${text}](${String(mark.attrs?.href ?? '')})`;
					}
				}
				return text;
			}
			if (node.type === 'mention') {
				return `@${String(node.attrs?.label ?? node.attrs?.id ?? '')}`;
			}
			if (node.type === 'hardBreak') {
				return '  \n';
			}
			if (node.type === 'image') {
				return `![${String(node.attrs?.alt ?? '')}](${absolute(String(node.attrs?.src ?? ''))})`;
			}
			return inline(node.content);
		})
		.join('');
}

function list(node: JSONContent, indent: string): string {
	return (node.content ?? [])
		.map((item, i) => {
			const marker = node.type === 'orderedList' ? `${Number(node.attrs?.start ?? 1) + i}.` : node.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}]` : '-';
			const [first, ...rest] = item.content ?? [];
			const head = `${indent}${marker} ${first ? inline(first.content) : ''}`;
			const tail = rest.map((child) =>
				child.type?.endsWith('List')
					? list(child, `${indent}  `)
					: block(child)
							.split('\n')
							.map((line) => `${indent}  ${line}`)
							.join('\n'),
			);
			return [head, ...tail].join('\n');
		})
		.join('\n');
}

function table(node: JSONContent): string {
	const rows = (node.content ?? []).map((row) => (row.content ?? []).map((cell) => (cell.content ?? []).map((p) => inline(p.content)).join(' ').replace(/\|/g, '\\|')));
	if (!rows.length) {
		return '';
	}
	const width = Math.max(...rows.map((r) => r.length));
	const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
	return [line(rows[0]!), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}

function block(node: JSONContent): string {
	switch (node.type) {
		case 'heading':
			return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inline(node.content)}`;
		case 'paragraph':
			return inline(node.content);
		case 'blockquote':
			return (node.content ?? [])
				.map(block)
				.join('\n\n')
				.split('\n')
				.map((line) => `> ${line}`)
				.join('\n');
		case 'codeBlock':
			return `\`\`\`${String(node.attrs?.language ?? '')}\n${inline(node.content)}\n\`\`\``;
		case 'horizontalRule':
			return '---';
		case 'bulletList':
		case 'orderedList':
		case 'taskList':
			return list(node, '');
		case 'image':
			return inline([node]);
		case 'table':
			return table(node);
		default:
			return (node.content ?? []).map(block).join('\n\n');
	}
}

export function toMarkdown(title: string, doc: JSONContent): string {
	const body = (doc.content ?? []).map(block).filter((part) => part.trim() !== '');
	return `${[`# ${title}`, ...body].join('\n\n')}\n`;
}
