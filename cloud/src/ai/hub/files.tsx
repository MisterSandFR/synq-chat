import { useEffect, useState, type CSSProperties } from 'react';

import type { PageCategory } from '../../../shared/access';
import { AI_FILE_LABEL, AI_FILE_LIMITS, aiFileKind, type AiFile, type LayoutBlock, type PageDraft } from '../../../shared/ai-files';
import type { AiAction, AiDone, AiIntent, AiTurn } from '../../../shared/ai-hub';
import { PAGE_GRADIENTS, type CanvasMeta } from '../../../shared/canvas';
import { api, upload } from '../../api';
import { Icon, formatSize, type IconName } from '../../ui';
import { aiErrorText } from '../parse';
import { readContext } from './context';
import './files.css';

export type Attachment = { key: string; name: string; size: number; local: string | null; progress: number; file: AiFile | null; error: string };

export function useAttachments() {
	const [items, setItems] = useState<Attachment[]>([]);
	const [notice, setNotice] = useState('');
	const patch = (key: string, change: Partial<Attachment>) => setItems((list) => list.map((a) => (a.key === key ? { ...a, ...change } : a)));

	const add = (picked: File[]) => {
		const room = Math.max(0, AI_FILE_LIMITS.files - items.length);
		setNotice(picked.length > room ? `${AI_FILE_LIMITS.files} fichiers au plus par conversation` : '');
		for (const file of picked.slice(0, room)) {
			const kind = aiFileKind(file.name);
			const key = crypto.randomUUID();
			const error = !kind ? 'Type non pris en charge' : file.size > AI_FILE_LIMITS.size ? 'Plus de 20 Mo' : '';
			const local = kind === 'image' && !error ? URL.createObjectURL(file) : null;
			setItems((list) => [...list, { key, name: file.name, size: file.size, local, progress: 0, file: null, error }]);
			if (!error) {
				upload<AiFile>('/ai/hub/files', file, (ratio) => patch(key, { progress: ratio }))
					.then((saved) => patch(key, { file: saved, progress: 1 }))
					.catch((e) => patch(key, { error: aiErrorText(e) }));
			}
		}
	};

	const remove = (key: string) => {
		const item = items.find((a) => a.key === key);
		if (item?.file) {
			void api('DELETE', `/ai/hub/files/${item.file.id}`).catch(() => undefined);
		}
		if (item?.local) {
			URL.revokeObjectURL(item.local);
		}
		setItems((list) => list.filter((a) => a.key !== key));
		setNotice('');
	};

	const clear = () => {
		items.forEach((a) => a.local && URL.revokeObjectURL(a.local));
		setItems([]);
		setNotice('');
	};

	return { items, add, remove, clear, notice, ready: items.flatMap((a) => (a.file ? [a.file.id] : [])), pending: items.some((a) => !a.file && !a.error) };
}

export function FileChips({ items, onRemove }: { items: Attachment[]; onRemove: (key: string) => void }) {
	if (!items.length) {
		return null;
	}
	return (
		<ul className='hub-files' aria-label='Fichiers joints'>
			{items.map((a) => {
				const thumb = a.local ?? a.file?.preview ?? null;
				const meta = a.error || (a.file ? `${AI_FILE_LABEL[a.file.kind]}, ${formatSize(a.size)}${a.file.truncated ? ', extrait partiel' : ''}` : a.progress >= 1 ? 'Lecture du fichier…' : `Envoi ${Math.round(a.progress * 100)} %`);
				return (
					<li key={a.key} className={`hub-file${a.error ? ' is-error' : ''}`}>
						{thumb ? (
							<img src={thumb} alt='' className='hub-file-thumb' />
						) : (
							<span className='hub-file-icon'>
								<Icon name='file' size={16} />
							</span>
						)}
						<span className='hub-file-text'>
							<span className='hub-file-name ellipsis' title={a.name}>
								{a.name}
							</span>
							<span className='hub-file-meta ellipsis'>{meta}</span>
						</span>
						<button type='button' className='icon-btn hub-file-remove' aria-label={`Retirer ${a.name}`} title='Retirer' onClick={() => onRemove(a.key)}>
							<Icon name='close' size={12} />
						</button>
						{!a.file && !a.error && <span className='hub-file-bar' style={{ width: `${Math.max(4, a.progress * 100)}%` }} />}
					</li>
				);
			})}
		</ul>
	);
}

type FileAction = { intent: AiIntent; label: string; icon: IconName };

export function FileActions({ count, canCards, busy, onPick }: { count: number; canCards: boolean; busy: boolean; onPick: (intent: AiIntent) => void }) {
	const actions: FileAction[] = [
		{ intent: 'layout', label: 'Mettre en page', icon: 'file' },
		{ intent: 'summarize', label: count > 1 ? 'Résumer ces fichiers' : 'Résumer ce fichier', icon: 'list' },
		...(count > 1 ? [{ intent: 'compare' as const, label: 'Comparer', icon: 'copy' as const }] : []),
		...(canCards ? [{ intent: 'cards' as const, label: 'Extraire les tâches', icon: 'check' as const }] : []),
	];
	return (
		<div className='hub-file-actions'>
			{actions.map((a) => (
				<button key={a.intent} type='button' disabled={busy} onClick={() => onPick(a.intent)}>
					<Icon name={a.icon} size={14} />
					{a.label}
				</button>
			))}
		</div>
	);
}

const ADJUST = ['Plus court', 'Plus formel', 'En tableau', 'Plus visuel'];

type Layout = Extract<AiAction, { kind: 'layout' }>;

export function LayoutCard({
	turn,
	action: initial,
	conversationId,
	busy: thinking,
	onDone,
	onAdjust,
}: {
	turn: AiTurn;
	action: Layout;
	conversationId: string;
	busy: boolean;
	onDone: (turnId: number, action: AiAction, done: AiDone) => void;
	onAdjust: (turnId: number, files: string[], hint: string) => void;
}) {
	const [action, setAction] = useState(initial);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [categories, setCategories] = useState<PageCategory[]>([]);
	const [here, setHere] = useState<CanvasMeta | null>(null);
	const [adjusting, setAdjusting] = useState(false);
	const [hint, setHint] = useState('');
	const [dismissed, setDismissed] = useState(false);
	const wid = action.workspaceId;
	const pageId = readContext(wid).ctx.pageId ?? null;

	useEffect(() => {
		void api<PageCategory[]>('GET', `/w/${wid}/page-categories`)
			.then((list) => setCategories(list.filter((c) => c.level === 'edit' || c.level === 'manage')))
			.catch(() => undefined);
		if (pageId) {
			void api<CanvasMeta>('GET', `/w/${wid}/canvases/${pageId}`)
				.then(setHere)
				.catch(() => undefined);
		}
	}, [wid, pageId]);

	if (dismissed) {
		return <p className='hub-empty'>Page abandonnée.</p>;
	}
	const draft = action.draft;
	const setDraft = (change: Partial<PageDraft>) => setAction({ ...action, draft: { ...draft, ...change } });
	const place = action.parentId ? `parent:${action.parentId}` : action.categoryId ? `cat:${action.categoryId}` : '';
	const setPlace = (value: string) => setAction({ ...action, parentId: value.startsWith('parent:') ? value.slice(7) : null, categoryId: value.startsWith('cat:') ? value.slice(4) : null });
	const adjust = (value: string) => {
		if (value.trim()) {
			onAdjust(turn.id, action.files, value.trim());
			setAdjusting(false);
			setHint('');
		}
	};
	const confirm = async () => {
		setBusy(true);
		setError('');
		try {
			onDone(turn.id, action, await api<AiDone>('POST', '/ai/hub/execute', { conversationId, turnId: turn.id, action }));
		} catch (e) {
			setError(aiErrorText(e));
		} finally {
			setBusy(false);
		}
	};
	const writable = here && (here.level === 'edit' || here.level === 'manage');
	return (
		<div className='hub-action hub-layout'>
			<PagePreview draft={draft} onTitle={(title) => setDraft({ title })} />
			<div className='hub-layout-opts'>
				<div className='hub-covers' role='radiogroup' aria-label='Couverture'>
					<span className='hub-covers-label'>Couverture</span>
					{[null, ...Array.from({ length: PAGE_GRADIENTS }, (_, i) => i)].map((n) => {
						const value = n === null ? null : `gradient:${n}`;
						return (
							<button
								key={n ?? 'none'}
								type='button'
								role='radio'
								aria-checked={draft.cover === value}
								aria-label={n === null ? 'Sans couverture' : `Dégradé ${n + 1}`}
								className={`hub-cover-swatch${n === null ? ' is-none' : ` ai-cover-g${n}`}`}
								onClick={() => setDraft({ cover: value })}
							/>
						);
					})}
				</div>
				<label className='hub-field'>
					<span>Emplacement</span>
					<select value={place} onChange={(e) => setPlace(e.target.value)}>
						<option value=''>Pages de l’espace</option>
						{categories.map((c) => (
							<option key={c.id} value={`cat:${c.id}`}>
								Catégorie « {c.name} »
							</option>
						))}
						{writable && <option value={`parent:${here.id}`}>Sous-page de « {here.title} »</option>}
					</select>
				</label>
				{adjusting && (
					<div className='hub-adjust'>
						<div className='hub-adjust-chips'>
							{ADJUST.map((s) => (
								<button key={s} type='button' disabled={thinking} onClick={() => adjust(s)}>
									{s}
								</button>
							))}
						</div>
						<input
							autoFocus
							value={hint}
							maxLength={300}
							placeholder='Ou décris le changement voulu'
							aria-label='Consigne d’ajustement'
							onChange={(e) => setHint(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									adjust(hint);
								} else if (e.key === 'Escape') {
									e.stopPropagation();
									setAdjusting(false);
								}
							}}
						/>
					</div>
				)}
			</div>
			{error && (
				<p className='notice notice-error' role='alert'>
					{error}
				</p>
			)}
			<div className='hub-action-foot'>
				<button type='button' className='btn' disabled={busy} onClick={() => setDismissed(true)}>
					Annuler
				</button>
				<button type='button' className='btn' disabled={busy || thinking || (adjusting && !hint.trim())} aria-expanded={adjusting} onClick={() => (adjusting ? adjust(hint) : setAdjusting(true))}>
					Ajuster
				</button>
				<button type='button' className='btn btn-primary' disabled={busy || thinking || !draft.title.trim()} onClick={() => void confirm()}>
					{busy ? 'Création…' : 'Créer la page'}
				</button>
			</div>
		</div>
	);
}

export function PagePreview({ draft, onTitle }: { draft: PageDraft; onTitle: (title: string) => void }) {
	const cover = /^gradient:(\d)$/.exec(draft.cover ?? '')?.[1];
	const headings = draft.blocks.flatMap((b) => (b.type === 'heading' ? [b] : []));
	return (
		<div className={`ai-page${cover !== undefined ? ' has-cover' : ''}`}>
			{cover !== undefined && <div className={`ai-page-cover ai-cover-g${cover}`} />}
			<div className='ai-page-sheet'>
				<span className='ai-page-icon' aria-hidden='true'>
					{draft.icon}
				</span>
				<input className='ai-page-title' value={draft.title} maxLength={120} aria-label='Titre de la page' onChange={(e) => onTitle(e.target.value)} />
				<Blocks blocks={draft.blocks} headings={headings} />
			</div>
		</div>
	);
}

type Heading = Extract<LayoutBlock, { type: 'heading' }>;

function Blocks({ blocks, headings }: { blocks: LayoutBlock[]; headings: Heading[] }) {
	return (
		<>
			{blocks.map((block, i) => (
				<Block key={i} block={block} headings={headings} />
			))}
		</>
	);
}

function Block({ block, headings }: { block: LayoutBlock; headings: Heading[] }) {
	switch (block.type) {
		case 'heading': {
			const Tag = block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4';
			return <Tag className={`ai-h${block.level}`}>{block.text}</Tag>;
		}
		case 'paragraph':
			return <p>{block.text}</p>;
		case 'quote':
			return <blockquote>{block.text}</blockquote>;
		case 'callout':
			return (
				<div className='ai-callout'>
					<span aria-hidden='true'>{block.emoji}</span>
					<p>{block.text}</p>
				</div>
			);
		case 'bullets':
		case 'numbered': {
			const List = block.type === 'bullets' ? 'ul' : 'ol';
			return (
				<List>
					{block.items.map((item, i) => (
						<li key={i}>{item}</li>
					))}
				</List>
			);
		}
		case 'todo':
			return (
				<ul className='ai-todo'>
					{block.items.map((item, i) => (
						<li key={i}>
							<span className='ai-box' aria-hidden='true' />
							{item}
						</li>
					))}
				</ul>
			);
		case 'table':
			return (
				<div className='ai-table'>
					<table>
						<tbody>
							{block.rows.map((row, r) => (
								<tr key={r}>{row.map((cell, c) => (r === 0 && block.rows.length > 1 ? <th key={c}>{cell}</th> : <td key={c}>{cell}</td>))}</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		case 'columns':
			return (
				<div className='ai-columns' style={{ '--cols': block.columns.length } as CSSProperties}>
					{block.columns.map((col, i) => (
						<div key={i}>
							<Blocks blocks={col} headings={headings} />
						</div>
					))}
				</div>
			);
		case 'toggle':
			return (
				<details className='ai-toggle' open>
					<summary>{block.text}</summary>
					<Blocks blocks={block.blocks} headings={headings} />
				</details>
			);
		case 'divider':
			return <hr />;
		case 'toc':
			return (
				<nav className='ai-toc' aria-label='Table des matières'>
					{headings.map((h, i) => (
						<span key={i} className={`ai-toc-l${h.level}`}>
							{h.text}
						</span>
					))}
				</nav>
			);
		case 'image':
			return (
				<figure className='ai-figure'>
					<img src={`/api/ai/hub/files/${block.file}`} alt={block.caption} />
					{block.caption && <figcaption>{block.caption}</figcaption>}
				</figure>
			);
	}
}
