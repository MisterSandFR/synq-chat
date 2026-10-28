import { Mark, Node, mergeAttributes, type Editor } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Suspense, lazy, useEffect, useMemo, useState, type ComponentType } from 'react';

import { canvasPath } from '../../../shared/canvas';
import type { ListSummary } from '../../../shared/lists';
import type { LinkPreview } from '../../../shared/media';
import { api } from '../../api';
import { navigate } from '../../router';
import { Icon } from '../../ui';
import { pageById, pageLabel, usePages } from './pages';
import { PageIcon } from './PageTree';

export type PageBlockOptions = { workspaceId: string };

const wid = (props: NodeViewProps) => (props.extension.options as PageBlockOptions).workspaceId;

// Bascule : titre toujours visible, contenu replié ou non (état partagé).
export const Toggle = Node.create({
	name: 'toggle',
	group: 'block',
	content: 'toggleSummary toggleBody',
	defining: true,
	addAttributes: () => ({
		open: { default: true, parseHTML: (el) => el.getAttribute('data-open') !== 'false', renderHTML: (attrs) => ({ 'data-open': String(attrs.open) }) },
	}),
	parseHTML: () => [{ tag: 'div[data-type="toggle"]' }],
	renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle', class: 'page-toggle' }), 0],
	addNodeView:
		() =>
		({ node, getPos, editor }) => {
			let current = node;
			const dom = document.createElement('div');
			dom.className = 'page-toggle';
			dom.dataset.open = String(node.attrs.open);
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'page-toggle-btn';
			button.contentEditable = 'false';
			button.setAttribute('aria-label', 'Déplier ou replier');
			button.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 6 6 6-6 6"/></svg>';
			button.addEventListener('mousedown', (e) => e.preventDefault());
			button.addEventListener('click', () => {
				const pos = typeof getPos === 'function' ? getPos() : null;
				if (editor.isEditable && typeof pos === 'number') {
					editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, open: !current.attrs.open }));
				} else {
					dom.dataset.open = dom.dataset.open === 'true' ? 'false' : 'true';
				}
			});
			const content = document.createElement('div');
			content.className = 'page-toggle-inner';
			dom.append(button, content);
			return {
				dom,
				contentDOM: content,
				update: (next) => {
					if (next.type !== current.type) {
						return false;
					}
					current = next;
					dom.dataset.open = String(next.attrs.open);
					return true;
				},
				ignoreMutation: (m) => m.type !== 'selection' && button.contains(m.target),
			};
		},
});

export const ToggleSummary = Node.create({
	name: 'toggleSummary',
	content: 'inline*',
	parseHTML: () => [{ tag: 'div.page-toggle-summary' }],
	renderHTML: () => ['div', { class: 'page-toggle-summary' }, 0],
});

export const ToggleBody = Node.create({
	name: 'toggleBody',
	content: 'block+',
	parseHTML: () => [{ tag: 'div.page-toggle-body' }],
	renderHTML: () => ['div', { class: 'page-toggle-body' }, 0],
});

// Encadré : emoji cliquable, choisi dans le sélecteur de l'éditeur.
export const Callout = Node.create<{ onEmoji: (pos: number, rect: DOMRect) => void }>({
	name: 'callout',
	group: 'block',
	content: 'block+',
	defining: true,
	addOptions: () => ({ onEmoji: () => undefined }),
	addAttributes: () => ({ emoji: { default: '💡' } }),
	parseHTML: () => [{ tag: 'div[data-type="callout"]', getAttrs: (el) => ({ emoji: (el as HTMLElement).getAttribute('data-emoji') ?? '💡' }) }],
	renderHTML: ({ node }) => ['div', { 'data-type': 'callout', 'data-emoji': node.attrs.emoji, class: 'page-callout' }, 0],
	addNodeView() {
		const options = this.options;
		return ({ node, getPos, editor }) => {
			const dom = document.createElement('div');
			dom.className = 'page-callout';
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'page-callout-emoji';
			button.contentEditable = 'false';
			button.textContent = node.attrs.emoji;
			button.setAttribute('aria-label', 'Changer l’emoji');
			button.addEventListener('mousedown', (e) => e.preventDefault());
			button.addEventListener('click', () => {
				const pos = typeof getPos === 'function' ? getPos() : null;
				if (editor.isEditable && typeof pos === 'number') {
					options.onEmoji(pos, button.getBoundingClientRect());
				}
			});
			const content = document.createElement('div');
			content.className = 'page-callout-body';
			dom.append(button, content);
			return {
				dom,
				contentDOM: content,
				update: (next) => {
					if (next.type.name !== 'callout') {
						return false;
					}
					button.textContent = next.attrs.emoji;
					return true;
				},
				ignoreMutation: (m) => m.type !== 'selection' && button.contains(m.target),
			};
		};
	},
});

export const Columns = Node.create({
	name: 'columns',
	group: 'block',
	content: 'column{2,3}',
	isolating: true,
	addAttributes: () => ({ count: { default: 2 } }),
	parseHTML: () => [{ tag: 'div[data-type="columns"]' }],
	renderHTML: ({ node }) => ['div', { 'data-type': 'columns', class: 'page-columns', style: `--cols: ${node.childCount || node.attrs.count}` }, 0],
});

export const Column = Node.create({
	name: 'column',
	content: 'block+',
	isolating: true,
	parseHTML: () => [{ tag: 'div[data-type="column"]' }],
	renderHTML: () => ['div', { 'data-type': 'column', class: 'page-column' }, 0],
});

export const columnsContent = (count: number) => ({ type: 'columns', attrs: { count }, content: Array.from({ length: count }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })) });

type Heading = { level: number; text: string; pos: number };

const headingsOf = (editor: Editor): Heading[] => {
	const out: Heading[] = [];
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === 'heading') {
			out.push({ level: Number(node.attrs.level) || 1, text: node.textContent, pos });
		}
	});
	return out;
};

function TocView({ editor }: NodeViewProps) {
	const [items, setItems] = useState<Heading[]>(() => headingsOf(editor));
	useEffect(() => {
		const update = () => setItems(headingsOf(editor));
		editor.on('update', update);
		return () => {
			editor.off('update', update);
		};
	}, [editor]);
	return (
		<NodeViewWrapper className='page-toc' contentEditable={false}>
			{items.length === 0 ? (
				<p className='muted'>Ajoute des titres : ils apparaîtront ici.</p>
			) : (
				<ul>
					{items.map((h) => (
						<li key={h.pos} style={{ paddingLeft: (h.level - 1) * 16 }}>
							<button
								type='button'
								onClick={() => {
									const dom = editor.view.nodeDOM(h.pos);
									(dom instanceof HTMLElement ? dom : null)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
								}}
							>
								{h.text || 'Titre sans texte'}
							</button>
						</li>
					))}
				</ul>
			)}
		</NodeViewWrapper>
	);
}

export const TableOfContents = Node.create<PageBlockOptions>({
	name: 'toc',
	group: 'block',
	atom: true,
	selectable: true,
	parseHTML: () => [{ tag: 'div[data-type="toc"]' }],
	renderHTML: () => ['div', { 'data-type': 'toc' }],
	addNodeView: () => ReactNodeViewRenderer(TocView),
});

function BookmarkView(props: NodeViewProps) {
	const { node, updateAttributes, editor } = props;
	const url = String(node.attrs.url ?? '');
	const [draft, setDraft] = useState('');
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (!url || node.attrs.title || !editor.isEditable) {
			return;
		}
		api<LinkPreview | null>('GET', `/w/${wid(props)}/unfurl?url=${encodeURIComponent(url)}`)
			.then((p) => updateAttributes({ title: p?.title || url, description: p?.description ?? '', image: p?.image ?? '', site: p?.siteName ?? '' }))
			.catch(() => updateAttributes({ title: url }));
	}, [url]);
	if (!url) {
		return (
			<NodeViewWrapper className='page-bookmark page-bookmark-empty' contentEditable={false}>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						const raw = draft.trim();
						if (!/^https?:\/\//i.test(raw)) {
							setError('Lien en http:// ou https:// attendu');
							return;
						}
						updateAttributes({ url: raw });
					}}
				>
					<Icon name='bookmark' size={16} />
					<input value={draft} autoFocus placeholder='Colle un lien pour créer un signet' aria-label='Adresse du signet' onChange={(e) => setDraft(e.target.value)} />
					<button type='submit' className='btn'>
						Créer
					</button>
				</form>
				{error && <p className='page-block-error'>{error}</p>}
			</NodeViewWrapper>
		);
	}
	let host = url;
	try {
		host = new URL(url).hostname;
	} catch {
		// Lien déjà validé à la saisie.
	}
	return (
		<NodeViewWrapper className='page-bookmark' contentEditable={false}>
			<a href={url} target='_blank' rel='noopener noreferrer nofollow'>
				<span className='page-bookmark-text'>
					<strong className='ellipsis'>{node.attrs.title || url}</strong>
					{node.attrs.description && <span className='page-bookmark-desc'>{node.attrs.description}</span>}
					<span className='page-bookmark-site ellipsis'>
						<Icon name='link' size={12} /> {node.attrs.site || host}
					</span>
				</span>
				{node.attrs.image && <img src={node.attrs.image} alt='' loading='lazy' referrerPolicy='no-referrer' />}
			</a>
		</NodeViewWrapper>
	);
}

export const Bookmark = Node.create<PageBlockOptions>({
	name: 'bookmark',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: true,
	addOptions: () => ({ workspaceId: '' }),
	addAttributes: () => ({ url: { default: '' }, title: { default: '' }, description: { default: '' }, image: { default: '' }, site: { default: '' } }),
	parseHTML: () => [{ tag: 'div[data-type="bookmark"]' }],
	renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'bookmark' })],
	addNodeView: () => ReactNodeViewRenderer(BookmarkView),
});

const sizeText = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

function FileView({ node }: NodeViewProps) {
	return (
		<NodeViewWrapper className='page-file' contentEditable={false}>
			<a href={node.attrs.url} download={node.attrs.name}>
				<Icon name='paperclip' size={16} />
				<span className='grow ellipsis'>{node.attrs.name || 'Fichier'}</span>
				{Number(node.attrs.size) > 0 && <span className='muted'>{sizeText(Number(node.attrs.size))}</span>}
				<Icon name='download' size={15} />
			</a>
		</NodeViewWrapper>
	);
}

export const FileAttachment = Node.create({
	name: 'fileAttachment',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: true,
	addAttributes: () => ({ url: { default: '' }, name: { default: '' }, size: { default: 0 }, type: { default: '' } }),
	parseHTML: () => [{ tag: 'div[data-type="file"]' }],
	renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'file' })],
	addNodeView: () => ReactNodeViewRenderer(FileView),
});

function PageLinkView(props: NodeViewProps) {
	const workspaceId = wid(props);
	usePages(workspaceId);
	const id = String(props.node.attrs.id);
	const page = pageById(workspaceId, id);
	const href = canvasPath(workspaceId, id);
	return (
		<NodeViewWrapper as='span' className={`page-link${page ? '' : ' page-link-missing'}`} contentEditable={false}>
			<a
				href={href}
				onClick={(e) => {
					e.preventDefault();
					navigate(href);
				}}
			>
				<PageIcon icon={page?.icon ?? null} size={13} />
				<span>{page ? pageLabel(page) : props.node.attrs.label || 'Page inaccessible'}</span>
			</a>
		</NodeViewWrapper>
	);
}

export const PageLink = Node.create<PageBlockOptions>({
	name: 'pageLink',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	addOptions: () => ({ workspaceId: '' }),
	addAttributes: () => ({ id: { default: '' }, label: { default: '' } }),
	parseHTML: () => [{ tag: 'span[data-type="page-link"]' }],
	renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'page-link' })],
	renderText: ({ node }) => `[[${node.attrs.label || 'page'}]]`,
	addNodeView: () => ReactNodeViewRenderer(PageLinkView),
});

function SubpageView(props: NodeViewProps) {
	const workspaceId = wid(props);
	usePages(workspaceId);
	const page = pageById(workspaceId, String(props.node.attrs.id));
	const href = canvasPath(workspaceId, String(props.node.attrs.id));
	return (
		<NodeViewWrapper className='page-subpage' contentEditable={false}>
			<a
				href={href}
				onClick={(e) => {
					e.preventDefault();
					navigate(href);
				}}
			>
				<PageIcon icon={page?.icon ?? null} size={16} />
				<span className='ellipsis'>{page ? pageLabel(page) : 'Page archivée ou inaccessible'}</span>
			</a>
		</NodeViewWrapper>
	);
}

export const Subpage = Node.create<PageBlockOptions>({
	name: 'subpage',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: true,
	addOptions: () => ({ workspaceId: '' }),
	addAttributes: () => ({ id: { default: '' } }),
	parseHTML: () => [{ tag: 'div[data-type="subpage"]' }],
	renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'subpage' })],
	addNodeView: () => ReactNodeViewRenderer(SubpageView),
});

// Point d'accroche des bases : `ListView` fourni par `../lists/ListView.tsx` quand il existe, sinon carte de remplacement.
type ListViewProps = { workspaceId: string; listId: string; viewId?: string; compact?: boolean };
const listViews = import.meta.glob<{ ListView: ComponentType<ListViewProps> }>('../lists/ListView.tsx');
const loadListView = Object.values(listViews)[0];

function DatabaseView(props: NodeViewProps) {
	const workspaceId = wid(props);
	const listId = String(props.node.attrs.listId ?? '');
	const [lists, setLists] = useState<ListSummary[] | null>(null);
	const View = useMemo(() => (loadListView ? lazy(() => loadListView().then((m) => ({ default: m.ListView }))) : null), []);
	useEffect(() => {
		void api<ListSummary[]>('GET', `/w/${workspaceId}/lists`)
			.then(setLists)
			.catch(() => setLists([]));
	}, [workspaceId]);
	const list = lists?.find((l) => l.id === listId);
	return (
		<NodeViewWrapper className='page-database' contentEditable={false}>
			{!listId ? (
				<div className='page-database-pick'>
					<Icon name='list' size={16} />
					<select aria-label='Base à intégrer' defaultValue='' disabled={!props.editor.isEditable} onChange={(e) => e.target.value && props.updateAttributes({ listId: e.target.value })}>
						<option value=''>{lists === null ? 'Chargement…' : lists.length ? 'Choisis une base à intégrer' : 'Aucune base dans cet espace'}</option>
						{lists?.map((l) => (
							<option key={l.id} value={l.id}>
								{l.title}
							</option>
						))}
					</select>
				</div>
			) : View ? (
				<Suspense fallback={<div className='spinner' aria-busy />}>
					<View workspaceId={workspaceId} listId={listId} viewId={props.node.attrs.viewId || undefined} compact />
				</Suspense>
			) : (
				<a
					className='page-database-card'
					href={`/w/${workspaceId}/listes/${listId}`}
					onClick={(e) => {
						e.preventDefault();
						navigate(`/w/${workspaceId}/listes/${listId}`);
					}}
				>
					<Icon name='list' size={18} />
					<span className='grow'>
						<strong>{list?.title ?? 'Base intégrée'}</strong>
						<span className='muted'>Ouvrir la base</span>
					</span>
					<Icon name='expand' size={15} />
				</a>
			)}
		</NodeViewWrapper>
	);
}

export const Database = Node.create<PageBlockOptions>({
	name: 'database',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: true,
	addOptions: () => ({ workspaceId: '' }),
	addAttributes: () => ({ listId: { default: '' }, viewId: { default: '' } }),
	parseHTML: () => [{ tag: 'div[data-type="database"]' }],
	renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'database' })],
	addNodeView: () => ReactNodeViewRenderer(DatabaseView),
});

// Ancre d'un fil de commentaires ; le texte du fil vit en D1.
export const CommentMark = Mark.create({
	name: 'comment',
	inclusive: false,
	excludes: '',
	addAttributes: () => ({ thread: { default: '' } }),
	parseHTML: () => [{ tag: 'span[data-thread]', getAttrs: (el) => ({ thread: (el as HTMLElement).getAttribute('data-thread') }) }],
	renderHTML: ({ mark }) => ['span', { 'data-thread': mark.attrs.thread, class: 'page-comment-mark' }, 0],
});

export function removeThreadMark(editor: Editor, thread: string): void {
	const type = editor.schema.marks.comment;
	if (!type || !editor.isEditable) {
		return;
	}
	const tr = editor.state.tr;
	editor.state.doc.descendants((node, pos) => {
		const mark = node.marks.find((m) => m.type === type && m.attrs.thread === thread);
		if (mark) {
			tr.removeMark(pos, pos + node.nodeSize, mark);
		}
	});
	if (tr.docChanged) {
		editor.view.dispatch(tr);
	}
}

export const pageExtensions = (workspaceId: string, onCalloutEmoji: (pos: number, rect: DOMRect) => void) => [
	Toggle,
	ToggleSummary,
	ToggleBody,
	Callout.configure({ onEmoji: onCalloutEmoji }),
	Columns,
	Column,
	TableOfContents,
	Bookmark.configure({ workspaceId }),
	FileAttachment,
	PageLink.configure({ workspaceId }),
	Subpage.configure({ workspaceId }),
	Database.configure({ workspaceId }),
	CommentMark,
];
