import type { Editor, JSONContent, Range } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Mention from '@tiptap/extension-mention';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type * as Y from 'yjs';

import { CANVAS_IMAGE_TYPES, CANVAS_LIMITS, type CanvasMeta } from '../../../shared/canvas';
import type { Member } from '../../../shared/types';
import { AiAssist } from '../../ai/AiAssist';
import { errorText, upload } from '../../api';
import { Floating } from '../../floating';
import { Icon } from '../../ui';
import { EmojiPicker } from '../chat/EmojiPicker';
import { memberItems, slashExtension, suggestionRender, SuggestionMenu, type Block, type MenuItem, type MenuState } from './suggest';
import type { CanvasSync } from './sync';

type Props = {
	workspaceId: string;
	meta: CanvasMeta;
	doc: Y.Doc;
	sync: CanvasSync;
	members: Map<string, Member>;
	me: { name: string; color: string };
	title: string;
	onEditor: (editor: Editor | null) => void;
	onError: (text: string) => void;
};

const plainNodes = (text: string): JSONContent[] =>
	text.includes('\n') ? text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) : [{ type: 'text', text }];

export function CanvasEditor({ workspaceId, meta, doc, sync, members, me, title, onEditor, onError }: Props) {
	const editable = meta.access === 'write';
	const wrap = useRef<HTMLDivElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const [menu, setMenuState] = useState<MenuState>(null);
	const menuRef = useRef<MenuState>(null);
	const membersRef = useRef(members);
	membersRef.current = members;
	const [emojiAt, setEmojiAt] = useState<DOMRect | null>(null);
	const actions = useRef({ image: () => fileInput.current?.click(), emoji: (rect: DOMRect) => setEmojiAt(rect) });

	const setMenu = (next: MenuState | ((prev: MenuState) => MenuState)) =>
		setMenuState((prev) => {
			const value = typeof next === 'function' ? next(prev) : next;
			menuRef.current = value;
			return value;
		});

	const uploadImage = async (editor: Editor, file: File) => {
		if (!CANVAS_IMAGE_TYPES.includes(file.type)) {
			onError('Seules les images (PNG, JPEG, GIF, WebP, AVIF) peuvent être insérées.');
			return;
		}
		try {
			const { url } = await upload<{ url: string }>(`/w/${workspaceId}/canvases/${meta.id}/files`, file);
			editor.chain().focus().setImage({ src: url, alt: file.name }).run();
		} catch (error) {
			onError(errorText(error));
		}
	};

	const blocks = (): Block[] => {
		const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);
		return [
			{ id: 'p', label: 'Texte', hint: 'Paragraphe simple', icon: null, mark: '¶', keywords: 'paragraphe', run: (e, r) => chain(e, r).setParagraph().run() },
			{ id: 'h1', label: 'Titre 1', hint: 'Grande section', icon: null, mark: 'H1', keywords: 'heading', run: (e, r) => chain(e, r).setHeading({ level: 1 }).run() },
			{ id: 'h2', label: 'Titre 2', hint: 'Section', icon: null, mark: 'H2', keywords: 'heading', run: (e, r) => chain(e, r).setHeading({ level: 2 }).run() },
			{ id: 'h3', label: 'Titre 3', hint: 'Sous-section', icon: null, mark: 'H3', keywords: 'heading', run: (e, r) => chain(e, r).setHeading({ level: 3 }).run() },
			{ id: 'ul', label: 'Liste à puces', hint: 'Points sans ordre', icon: 'list', keywords: 'bullet', run: (e, r) => chain(e, r).toggleBulletList().run() },
			{ id: 'ol', label: 'Liste numérotée', hint: 'Étapes dans l’ordre', icon: null, mark: '1.', keywords: 'ordered numero', run: (e, r) => chain(e, r).toggleOrderedList().run() },
			{ id: 'todo', label: 'Cases à cocher', hint: 'Tâches à suivre', icon: 'check', keywords: 'todo tache checklist', run: (e, r) => chain(e, r).toggleTaskList().run() },
			{ id: 'quote', label: 'Citation', hint: 'Passage mis en retrait', icon: 'quote', keywords: 'quote', run: (e, r) => chain(e, r).toggleBlockquote().run() },
			{ id: 'code', label: 'Code', hint: 'Bloc de code', icon: 'code', keywords: 'code', run: (e, r) => chain(e, r).toggleCodeBlock().run() },
			{ id: 'hr', label: 'Séparateur', hint: 'Ligne horizontale', icon: 'minus', keywords: 'separateur divider', run: (e, r) => chain(e, r).setHorizontalRule().run() },
			{ id: 'table', label: 'Tableau', hint: '3 × 3 avec en-tête', icon: null, mark: '⊞', keywords: 'table grille', run: (e, r) => chain(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
			{ id: 'image', label: 'Image', hint: 'Depuis ton appareil', icon: 'image', keywords: 'photo image', run: (e, r) => (chain(e, r).run(), actions.current.image()) },
			{ id: 'mention', label: 'Mention', hint: 'Citer un membre', icon: 'at', keywords: 'mention personne', run: (e, r) => chain(e, r).insertContent('@').run() },
			{
				id: 'emoji',
				label: 'Emoji',
				hint: 'Choisir dans la liste',
				icon: 'smile',
				keywords: 'emoji',
				run: (e, r) => {
					chain(e, r).run();
					const at = e.view.coordsAtPos(e.state.selection.from);
					actions.current.emoji(new DOMRect(at.left, at.top, 1, at.bottom - at.top));
				},
			},
		];
	};

	const editor = useEditor(
		{
			editable,
			extensions: [
				StarterKit.configure({ undoRedo: false, link: { openOnClick: !editable, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } } }),
				Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Titre' : editable ? 'Écris, ou tape / pour insérer un bloc' : '') }),
				TaskList,
				TaskItem.configure({ nested: true }),
				Image,
				TableKit.configure({ table: { resizable: false } }),
				Mention.configure({
					HTMLAttributes: { class: 'canvas-mention' },
					suggestion: {
						items: ({ query }) => memberItems(membersRef.current.values(), query),
						command: ({ editor: e, range, props }) => {
							const item = props as unknown as MenuItem;
							if (item.kind === 'member') {
								e.chain().focus().insertContentAt(range, [{ type: 'mention', attrs: { id: item.member.id, label: item.member.name } }, { type: 'text', text: ' ' }]).run();
							}
						},
						render: suggestionRender('mention', setMenu, menuRef) as never,
					},
				}),
				slashExtension(blocks, suggestionRender('slash', setMenu, menuRef)),
				Collaboration.configure({ document: doc }),
				CollaborationCaret.configure({ provider: sync, user: me }),
			],
			editorProps: {
				attributes: { class: 'canvas-prose', 'aria-label': 'Contenu du canevas' },
				handlePaste: (_view, event) => {
					const file = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
					if (!file || !editable || !editorRef.current) {
						return false;
					}
					void uploadImage(editorRef.current, file);
					return true;
				},
			},
		},
		[doc, sync],
	);
	const editorRef = useRef<Editor | null>(null);
	editorRef.current = editor;

	useEffect(() => {
		onEditor(editor);
		return () => onEditor(null);
	}, [editor]);

	return (
		<div className='canvas-doc' ref={wrap}>
			<EditorContent editor={editor} />
			{editor && editable && <SelectionBar editor={editor} wrap={wrap} title={title} />}
			{menu && <SuggestionMenu menu={menu} onHover={(index) => setMenu({ ...menu, index })} />}
			{emojiAt && editor && (
				<EmojiPicker
					anchor={emojiAt}
					onPick={(char) => {
						editor.chain().focus().insertContent(char).run();
						setEmojiAt(null);
					}}
					onClose={() => setEmojiAt(null)}
				/>
			)}
			<input
				ref={fileInput}
				type='file'
				accept={CANVAS_IMAGE_TYPES.join(',')}
				hidden
				onChange={(e) => {
					const file = e.target.files?.[0];
					e.target.value = '';
					if (file && editor) {
						void uploadImage(editor, file);
					}
				}}
			/>
		</div>
	);
}

type Box = { top: number; left: number; width: number; height: number };

// Barre de mise en forme au-dessus de la sélection ; reste ouverte tant que la sélection existe (assistant IA compris).
function SelectionBar({ editor, wrap, title }: { editor: Editor; wrap: RefObject<HTMLDivElement | null>; title: string }) {
	const anchor = useRef<HTMLSpanElement>(null);
	const aiSource = useRef<HTMLTextAreaElement>(null);
	const range = useRef({ from: 0, to: 0 });
	const [box, setBox] = useState<Box | null>(null);
	const [link, setLink] = useState<string | null>(null);
	const state = useEditorState({
		editor,
		selector: ({ editor: e }) => ({
			bold: e.isActive('bold'),
			italic: e.isActive('italic'),
			strike: e.isActive('strike'),
			code: e.isActive('code'),
			link: e.isActive('link'),
			h1: e.isActive('heading', { level: 1 }),
			h2: e.isActive('heading', { level: 2 }),
			quote: e.isActive('blockquote'),
			bullet: e.isActive('bulletList'),
			task: e.isActive('taskList'),
			text: e.state.selection.empty ? '' : e.state.doc.textBetween(e.state.selection.from, e.state.selection.to, '\n'),
		}),
	});

	useEffect(() => {
		const update = () => {
			const { from, to, empty } = editor.state.selection;
			const host = wrap.current;
			if (empty || !host || editor.isActive('image')) {
				setBox(null);
				setLink(null);
				return;
			}
			range.current = { from, to };
			const start = editor.view.coordsAtPos(from);
			const end = editor.view.coordsAtPos(to);
			const frame = host.getBoundingClientRect();
			const left = Math.min(start.left, end.left);
			setBox({ top: Math.min(start.top, end.top) - frame.top, left: left - frame.left, width: Math.max(1, Math.max(start.right, end.right) - left), height: Math.max(start.bottom, end.bottom) - Math.min(start.top, end.top) });
		};
		editor.on('selectionUpdate', update);
		return () => {
			editor.off('selectionUpdate', update);
		};
	}, [editor, wrap]);

	if (!box || !state) {
		return null;
	}
	const run = (fn: () => void) => (e: React.MouseEvent) => {
		e.preventDefault();
		fn();
	};
	const tool = (label: string, active: boolean, fn: () => void, content: React.ReactNode) => (
		<button type='button' className='canvas-tool' aria-label={label} title={label} aria-pressed={active} onMouseDown={run(fn)}>
			{content}
		</button>
	);
	const applyLink = () => {
		const raw = (link ?? '').trim();
		const href = !raw ? '' : /^(https?:|mailto:)/i.test(raw) ? raw : `https://${raw}`;
		const chain = editor.chain().focus().extendMarkRange('link');
		(href ? chain.setLink({ href }) : chain.unsetLink()).run();
		setLink(null);
	};

	return (
		<>
			<span ref={anchor} className='canvas-sel-anchor' style={box} />
			<Floating anchor={anchor} placement='top-start' offset={8} className='popover canvas-bar' role='toolbar' aria-label='Mise en forme'>
				{link === null ? (
					<>
						{tool('Gras', state.bold, () => editor.chain().focus().toggleBold().run(), <Icon name='bold' size={16} />)}
						{tool('Italique', state.italic, () => editor.chain().focus().toggleItalic().run(), <Icon name='italic' size={16} />)}
						{tool('Barré', state.strike, () => editor.chain().focus().toggleStrike().run(), <Icon name='strike' size={16} />)}
						{tool('Code', state.code, () => editor.chain().focus().toggleCode().run(), <Icon name='code' size={16} />)}
						{tool('Lien', state.link, () => setLink(editor.getAttributes('link').href ?? ''), <Icon name='link' size={16} />)}
						<span className='canvas-bar-sep' />
						{tool('Titre 1', state.h1, () => editor.chain().focus().toggleHeading({ level: 1 }).run(), <span className='canvas-tool-text'>H1</span>)}
						{tool('Titre 2', state.h2, () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <span className='canvas-tool-text'>H2</span>)}
						{tool('Citation', state.quote, () => editor.chain().focus().toggleBlockquote().run(), <Icon name='quote' size={16} />)}
						{tool('Liste à puces', state.bullet, () => editor.chain().focus().toggleBulletList().run(), <Icon name='list' size={16} />)}
						{tool('Cases à cocher', state.task, () => editor.chain().focus().toggleTaskList().run(), <Icon name='check' size={16} />)}
						<span className='canvas-bar-sep' />
						<textarea ref={aiSource} className='canvas-ai-source' value={state.text} readOnly hidden tabIndex={-1} aria-hidden />
						<AiAssist
							textarea={aiSource}
							value={state.text}
							context={title}
							onChange={(next) => editor.chain().focus().insertContentAt(range.current, plainNodes(next.slice(0, CANVAS_LIMITS.update))).run()}
						/>
					</>
				) : (
					<form
						className='canvas-link-form'
						onSubmit={(e) => {
							e.preventDefault();
							applyLink();
						}}
					>
						<input autoFocus value={link} placeholder='Colle un lien, vide pour retirer' aria-label='Adresse du lien' onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setLink(null)} />
						<button type='submit' className='btn btn-primary'>
							Appliquer
						</button>
					</form>
				)}
			</Floating>
		</>
	);
}
