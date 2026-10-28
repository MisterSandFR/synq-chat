import { useMemo, useState, type DragEvent, type MouseEvent } from 'react';

import { canvasPath, type CanvasMeta } from '../../../shared/canvas';
import { errorText } from '../../api';
import { navigate } from '../../router';
import { Dialog, Icon } from '../../ui';
import { EmojiPicker } from '../chat/EmojiPicker';
import { useContextMenu, type ContextMenuItem } from '../ContextMenu';
import { favoriteItem } from '../favorites/FavoritesSection';
import { endFavoriteDrag, startFavoriteDrag } from '../favorites/store';
import { childrenOf, createPage, duplicatePage, isInside, pageLabel, patchPage, positionAt, rootsOf, usePages } from './pages';
import './pages.css';

const DRAG_TYPE = 'application/x-synq-page';

type Zone = 'before' | 'inside' | 'after';

const go = (href: string) => (event: MouseEvent) => {
	if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
		event.preventDefault();
		navigate(href);
	}
};

export function PageIcon({ icon, size = 15 }: { icon: string | null; size?: number }) {
	return icon ? (
		<span className='page-emoji' style={{ fontSize: size }} aria-hidden>
			{icon}
		</span>
	) : (
		<Icon name='file' size={size} />
	);
}

type TreeProps = { workspaceId: string; activeId: string | null; onError?: (text: string) => void };

// Section « Pages » de la colonne : arbre complet, création à la racine.
export function PagesSection({ workspaceId, activeId, pagesActive }: { workspaceId: string; activeId: string | null; pagesActive: boolean }) {
	const [open, setOpen] = useState(true);
	return (
		<div className='page-section'>
			<div className='page-section-head'>
				<button type='button' className='page-section-toggle' aria-expanded={open} onClick={() => setOpen(!open)}>
					<span className={`page-caret${open ? ' page-caret-open' : ''}`}>
						<Icon name='chevron' size={12} />
					</span>
				</button>
				<a href={`/w/${workspaceId}/canevas`} className='page-section-title' aria-current={pagesActive ? 'page' : undefined} onClick={go(`/w/${workspaceId}/canevas`)}>
					Pages
				</a>
				<button type='button' className='icon-btn page-section-add' aria-label='Nouvelle page' title='Nouvelle page' onClick={() => void createPage(workspaceId).catch(() => undefined)}>
					<Icon name='plus' size={15} />
				</button>
			</div>
			{open && <PageTree workspaceId={workspaceId} activeId={activeId} compact />}
		</div>
	);
}

export function PageTree({ workspaceId, activeId, compact, onError }: TreeProps & { compact?: boolean }) {
	const items = usePages(workspaceId);
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	const [renaming, setRenaming] = useState<string | null>(null);
	const [emojiFor, setEmojiFor] = useState<{ id: string; rect: DOMRect } | null>(null);
	const [moving, setMoving] = useState<CanvasMeta | null>(null);
	const [drag, setDrag] = useState<{ id: string; over: string | null; zone: Zone } | null>(null);
	const menu = useContextMenu();
	const report = (e: unknown) => onError?.(errorText(e));

	// Ancêtres de la page ouverte dépliés d'office.
	const openPath = useMemo(() => {
		const out = new Set<string>();
		const byId = new Map((items ?? []).map((p) => [p.id, p]));
		for (let p = activeId ? byId.get(activeId) : undefined, n = 0; p?.parentId && n < 64; p = byId.get(p.parentId), n++) {
			out.add(p.parentId);
		}
		return out;
	}, [items, activeId]);

	if (!items) {
		return compact ? null : <div className='spinner' aria-busy />;
	}
	const isOpen = (id: string) => !collapsed.has(id) && (expanded.has(id) || openPath.has(id));
	const toggle = (id: string) => {
		const open = isOpen(id);
		setCollapsed((prev) => {
			const next = new Set(prev);
			open ? next.add(id) : next.delete(id);
			return next;
		});
		setExpanded((prev) => {
			const next = new Set(prev);
			open ? next.delete(id) : next.add(id);
			return next;
		});
	};

	const addChild = async (page: CanvasMeta) => {
		setExpanded((prev) => new Set(prev).add(page.id));
		await createPage(workspaceId, { parentId: page.id }).catch(report);
	};

	const menuFor = (page: CanvasMeta, at: DOMRect): ContextMenuItem[] => {
		const write = page.access === 'write';
		return [
			...(write
				? [
						{ label: 'Renommer', icon: 'pencil' as const, onSelect: () => setRenaming(page.id) },
						{ label: 'Changer l’icône', icon: 'smile' as const, onSelect: () => setEmojiFor({ id: page.id, rect: at }) },
						{ label: 'Ajouter une sous-page', icon: 'plus' as const, onSelect: () => void addChild(page) },
						...(page.channelId ? [] : [{ label: 'Dupliquer', icon: 'copy' as const, onSelect: () => void duplicatePage(workspaceId, page.id).catch(report) }]),
						...(page.channelId ? [] : [{ label: 'Déplacer vers…', icon: 'forward' as const, onSelect: () => setMoving(page) }]),
					]
				: []),
			{ label: 'Copier le lien', icon: 'link', onSelect: () => void navigator.clipboard.writeText(`${location.origin}${canvasPath(workspaceId, page.id)}`) },
			favoriteItem({ kind: 'canvas', refId: page.id }, page.title),
			...(write && !page.channelId ? (['sep', { label: 'Archiver', icon: 'trash', danger: true, onSelect: () => void patchPage(workspaceId, page.id, { archived: true }).catch(report) }] as ContextMenuItem[]) : []),
		];
	};

	const dropOn = async (target: CanvasMeta, zone: Zone, dragged: string) => {
		const page = items.find((p) => p.id === dragged);
		if (!page || page.id === target.id || isInside(items, target.id, page.id)) {
			return;
		}
		if (zone === 'inside') {
			const kids = childrenOf(items, target.id).filter((p) => p.id !== page.id);
			setExpanded((prev) => new Set(prev).add(target.id));
			await patchPage(workspaceId, page.id, { parentId: target.id, position: positionAt(kids, kids.length) }).catch(report);
			return;
		}
		const parentId = target.parentId && items.some((p) => p.id === target.parentId) ? target.parentId : null;
		const siblings = (parentId ? childrenOf(items, parentId) : rootsOf(items)).filter((p) => p.id !== page.id);
		const index = siblings.findIndex((p) => p.id === target.id) + (zone === 'after' ? 1 : 0);
		await patchPage(workspaceId, page.id, { parentId, position: positionAt(siblings, index) }).catch(report);
	};

	const row = (page: CanvasMeta, depth: number) => {
		const kids = childrenOf(items, page.id);
		const opened = isOpen(page.id);
		const zone = drag?.over === page.id ? drag.zone : null;
		const href = canvasPath(workspaceId, page.id);
		const onDragOver = (e: DragEvent) => {
			if (!drag || drag.id === page.id) {
				return;
			}
			e.preventDefault();
			const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
			const y = (e.clientY - box.top) / box.height;
			const next: Zone = y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
			if (drag.over !== page.id || drag.zone !== next) {
				setDrag({ ...drag, over: page.id, zone: next });
			}
		};
		return (
			<li key={page.id} role='treeitem' aria-expanded={kids.length ? opened : undefined} aria-selected={page.id === activeId}>
				<div
					className={`page-row${page.id === activeId ? ' page-row-active' : ''}${zone ? ` page-drop-${zone}` : ''}`}
					style={{ paddingLeft: 4 + depth * 14 }}
					draggable={renaming !== page.id && !page.channelId}
					onDragStart={(e) => {
						e.dataTransfer.effectAllowed = 'move';
						e.dataTransfer.setData(DRAG_TYPE, page.id);
						e.dataTransfer.setData('text/plain', page.id);
						startFavoriteDrag({ kind: 'canvas', refId: page.id });
						setDrag({ id: page.id, over: null, zone: 'inside' });
					}}
					onDragEnd={() => {
						endFavoriteDrag();
						setDrag(null);
					}}
					onDragOver={onDragOver}
					onDragLeave={() => drag?.over === page.id && setDrag({ ...drag, over: null })}
					onDrop={(e) => {
						e.preventDefault();
						const id = e.dataTransfer.getData(DRAG_TYPE) || drag?.id;
						const where = drag?.zone ?? 'inside';
						setDrag(null);
						if (id) {
							void dropOn(page, where, id);
						}
					}}
					{...menu.bind(() => menuFor(page, new DOMRect(0, 0, 0, 0)))}
				>
					<button type='button' className='page-twisty' aria-label={opened ? 'Replier' : 'Déplier'} tabIndex={-1} onClick={() => toggle(page.id)}>
						{kids.length ? (
							<span className={`page-caret${opened ? ' page-caret-open' : ''}`}>
								<Icon name='chevron' size={12} />
							</span>
						) : (
							<PageIcon icon={page.icon} size={14} />
						)}
					</button>
					{kids.length > 0 && (
						<span className='page-row-icon'>
							<PageIcon icon={page.icon} size={14} />
						</span>
					)}
					{renaming === page.id ? (
						<input
							className='page-rename'
							autoFocus
							defaultValue={page.title}
							aria-label='Nouveau titre'
							maxLength={120}
							onBlur={(e) => {
								setRenaming(null);
								const title = e.target.value.trim();
								if (title && title !== page.title) {
									void patchPage(workspaceId, page.id, { title }).catch(report);
								}
							}}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									(e.target as HTMLInputElement).blur();
								} else if (e.key === 'Escape') {
									setRenaming(null);
								}
							}}
						/>
					) : (
						<a href={href} className='page-row-title ellipsis' aria-current={page.id === activeId ? 'page' : undefined} onClick={go(href)}>
							{pageLabel(page)}
						</a>
					)}
					<span className='page-row-actions'>
						<button
							type='button'
							className='page-row-btn'
							aria-label='Plus d’actions'
							title='Plus d’actions'
							onClick={(e) => {
								const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
								menu.open(r.left, r.bottom, menuFor(page, r));
							}}
						>
							<Icon name='more' size={14} />
						</button>
						{page.access === 'write' && (
							<button type='button' className='page-row-btn' aria-label='Ajouter une sous-page' title='Ajouter une sous-page' onClick={() => void addChild(page)}>
								<Icon name='plus' size={14} />
							</button>
						)}
					</span>
				</div>
				{opened && kids.length > 0 && (
					<ul role='group' className='page-tree-group'>
						{kids.map((kid) => row(kid, depth + 1))}
					</ul>
				)}
			</li>
		);
	};

	const roots = rootsOf(items);
	return (
		<>
			{roots.length === 0 ? (
				<p className='page-tree-empty'>{compact ? 'Aucune page' : 'Aucune page pour l’instant.'}</p>
			) : (
				<ul className={`page-tree${compact ? ' page-tree-compact' : ''}`} role='tree' aria-label='Arbre des pages'>
					{roots.map((page) => row(page, 0))}
				</ul>
			)}
			{menu.menu}
			{emojiFor && (
				<EmojiPicker
					anchor={emojiFor.rect.width ? emojiFor.rect : new DOMRect(innerWidth / 2 - 160, innerHeight / 3, 1, 1)}
					onPick={(icon) => {
						void patchPage(workspaceId, emojiFor.id, { icon }).catch(report);
						setEmojiFor(null);
					}}
					onClose={() => setEmojiFor(null)}
				/>
			)}
			{moving && <MoveDialog workspaceId={workspaceId} page={moving} items={items} onClose={() => setMoving(null)} onError={report} />}
		</>
	);
}

function MoveDialog({ workspaceId, page, items, onClose, onError }: { workspaceId: string; page: CanvasMeta; items: CanvasMeta[]; onClose: () => void; onError: (e: unknown) => void }) {
	const [query, setQuery] = useState('');
	const q = query.trim().toLowerCase();
	const targets = items.filter((p) => p.access === 'write' && p.id !== page.id && !isInside(items, p.id, page.id) && (!q || p.title.toLowerCase().includes(q))).slice(0, 50);
	const move = async (parentId: string | null) => {
		const siblings = parentId ? childrenOf(items, parentId) : rootsOf(items);
		onClose();
		await patchPage(workspaceId, page.id, { parentId, position: positionAt(siblings, siblings.length) }).catch(onError);
	};
	return (
		<Dialog open onClose={onClose} title={`Déplacer « ${pageLabel(page)} »`}>
			<div className='page-move'>
				<input className='field' autoFocus placeholder='Chercher une page' value={query} aria-label='Chercher une page' onChange={(e) => setQuery(e.target.value)} />
				<ul className='page-move-list'>
					{!q && page.parentId && (
						<li>
							<button type='button' className='menu-item' onClick={() => void move(null)}>
								<Icon name='home' size={15} /> Racine des pages
							</button>
						</li>
					)}
					{targets.map((p) => (
						<li key={p.id}>
							<button type='button' className='menu-item' disabled={p.id === page.parentId} onClick={() => void move(p.id)}>
								<PageIcon icon={p.icon} /> <span className='grow ellipsis'>{pageLabel(p)}</span>
							</button>
						</li>
					))}
					{targets.length === 0 && <li className='muted page-move-empty'>Aucune page ne correspond</li>}
				</ul>
			</div>
		</Dialog>
	);
}
