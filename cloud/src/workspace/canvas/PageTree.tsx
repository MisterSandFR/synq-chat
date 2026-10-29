import { lazy, Suspense, useMemo, useState, type DragEvent, type MouseEvent } from 'react';

import { atLeast, type AccessKind, type PageCategory } from '../../../shared/access';
import { canvasPath, channelPageTitle, type CanvasMeta } from '../../../shared/canvas';
import type { ListSummary } from '../../../shared/lists';
import { api, errorText } from '../../api';
import { navigate } from '../../router';
import { Dialog, Icon, type IconName } from '../../ui';
import { EmojiPicker } from '../chat/EmojiPicker';
import { ShareDialog } from '../access/ShareDialog';
import { useContextMenu, type ContextMenuItem } from '../ContextMenu';
import { favoriteItem } from '../favorites/FavoritesSection';
import { endFavoriteDrag, startFavoriteDrag } from '../favorites/store';
import { VIEW_ICON } from '../lists/BasePage';
import { CreateList } from '../lists/ListsView';
import {
	createCategory,
	createPage,
	deleteCategory,
	duplicatePage,
	isInside,
	pageLabel,
	patchBase,
	patchCategory,
	patchPage,
	positionAt,
	refreshCategories,
	refreshPages,
	refreshTreeBases,
	usePageCategories,
	usePages,
	useTreeBases,
} from './pages';
import './pages.css';
import { confirmDialog } from '../../dialogs';

// L'éditeur reste hors du paquet de la colonne.
const TemplatePicker = lazy(() => import('./CanvasPage').then((m) => ({ default: m.TemplatePicker })));

const DRAG_TYPE = 'application/x-synq-page';
const CAT_DRAG = 'application/x-synq-page-category';

type Zone = 'before' | 'inside' | 'after';
type Place = { parentId?: string | null; categoryId?: string | null };

// Page ou suivi, rangés ensemble ; un suivi n'a jamais d'enfant.
type TreeNode = {
	kind: 'page' | 'base';
	id: string;
	parentId: string | null;
	categoryId: string | null;
	channelId: string | null;
	position: number;
	createdAt: number;
	title: string;
	icon: string | null;
	write: boolean;
	page?: CanvasMeta;
	base?: ListSummary;
};

const fromPage = (page: CanvasMeta): TreeNode => ({ ...page, kind: 'page', write: page.access === 'write', page });
const fromBase = (base: ListSummary): TreeNode => ({ ...base, kind: 'base', write: atLeast(base.level ?? 'view', 'edit'), base });
const byPosition = (a: TreeNode, b: TreeNode) => a.position - b.position || a.createdAt - b.createdAt;
const hrefOf = (workspaceId: string, node: TreeNode) => (node.kind === 'page' ? canvasPath(workspaceId, node.id) : `/w/${workspaceId}/listes/${node.id}`);

const go = (href: string) => (event: MouseEvent) => {
	if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
		event.preventDefault();
		navigate(href);
	}
};

export function PageIcon({ icon, size = 15, fallback = 'file' }: { icon: string | null; size?: number; fallback?: IconName }) {
	return icon ? (
		<span className='page-emoji' style={{ fontSize: size }} aria-hidden>
			{icon}
		</span>
	) : (
		<Icon name={fallback} size={size} />
	);
}

const nodeIcon = (node: TreeNode, size: number) => <PageIcon icon={node.icon} size={size} fallback={node.base?.viewKind ? VIEW_ICON[node.base.viewKind] : node.kind === 'base' ? 'list' : 'file'} />;

// Menu « + » : page vide, page depuis un modèle ou suivi, à l'endroit choisi.
function useCreateMenu(workspaceId: string, onError: (e: unknown) => void) {
	const menu = useContextMenu();
	const [picking, setPicking] = useState<{ kind: 'template' | 'tracker'; place: Place } | null>(null);
	const open = (place: Place, at: DOMRect) =>
		menu.open(at.left, at.bottom, [
			{ label: 'Page', icon: 'file', onSelect: () => void createPage(workspaceId, place).catch(onError) },
			{ label: 'Page depuis un modèle', icon: 'copy', onSelect: () => setPicking({ kind: 'template', place }) },
			{ label: 'Suivi', icon: 'list', onSelect: () => setPicking({ kind: 'tracker', place }) },
		]);
	const ui = (
		<>
			{menu.menu}
			{picking?.kind === 'template' && (
				<Suspense fallback={null}>
					<TemplatePicker workspaceId={workspaceId} open onClose={() => setPicking(null)} parentId={picking.place.parentId ?? null} categoryId={picking.place.categoryId ?? null} />
				</Suspense>
			)}
			{picking?.kind === 'tracker' && <CreateList workspaceId={workspaceId} rooms={[]} initialChannel={null} place={picking.place} onClose={() => setPicking(null)} />}
		</>
	);
	return { open, ui };
}

type TreeProps = { workspaceId: string; activeId: string | null; channelNames?: Map<string, string>; onError?: (text: string) => void };

// Section « Pages » de la colonne : documents et suivis dans un seul arbre.
export function PagesSection({ workspaceId, activeId, pagesActive, channelNames }: { workspaceId: string; activeId: string | null; pagesActive: boolean; channelNames?: Map<string, string> }) {
	const [open, setOpen] = useState(true);
	const create = useCreateMenu(workspaceId, () => undefined);
	return (
		<div className='page-section'>
			<div className='page-section-head'>
				<button type='button' className='page-section-toggle' aria-expanded={open} aria-label={open ? 'Replier les pages' : 'Déplier les pages'} onClick={() => setOpen(!open)}>
					<span className={`page-caret${open ? ' page-caret-open' : ''}`}>
						<Icon name='chevron' size={12} />
					</span>
				</button>
				<a href={`/w/${workspaceId}/canevas`} className='page-section-title' aria-current={pagesActive ? 'page' : undefined} onClick={go(`/w/${workspaceId}/canevas`)}>
					Pages
				</a>
				<button
					type='button'
					className='icon-btn page-section-add'
					aria-label='Créer une page ou un suivi'
					title='Créer une page ou un suivi'
					onClick={(e) => create.open({}, (e.currentTarget as HTMLElement).getBoundingClientRect())}
				>
					<Icon name='plus' size={15} />
				</button>
			</div>
			{open && <PageTree workspaceId={workspaceId} activeId={activeId} channelNames={channelNames} compact />}
			{create.ui}
		</div>
	);
}

export function PageTree({ workspaceId, activeId, compact, channelNames, onError }: TreeProps & { compact?: boolean }) {
	const items = usePages(workspaceId);
	const bases = useTreeBases(workspaceId);
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	const [renaming, setRenaming] = useState<string | null>(null);
	const [emojiFor, setEmojiFor] = useState<{ id: string; rect: DOMRect } | null>(null);
	const [moving, setMoving] = useState<TreeNode | null>(null);
	const [drag, setDrag] = useState<{ id: string; over: string | null; zone: Zone } | null>(null);
	const menu = useContextMenu();
	const report = (e: unknown) => onError?.(errorText(e));
	const create = useCreateMenu(workspaceId, report);
	const categories = usePageCategories(workspaceId);
	const [folded, setFolded] = useState<Set<string>>(() => new Set());
	const [sharing, setSharing] = useState<{ kind: AccessKind; id: string; title: string } | null>(null);
	const [renamingCat, setRenamingCat] = useState<string | null>(null);
	const [addingCat, setAddingCat] = useState(false);
	const [catOver, setCatOver] = useState<string | null>(null);

	const nodes = useMemo(() => [...(items ?? []).map(fromPage), ...(bases ?? []).map(fromBase)], [items, bases]);
	const pageIds = useMemo(() => new Set((items ?? []).map((p) => p.id)), [items]);

	// Ancêtres de l'élément ouvert dépliés d'office.
	const openPath = useMemo(() => {
		const out = new Set<string>();
		const byId = new Map(nodes.map((n) => [n.id, n]));
		for (let n = activeId ? byId.get(activeId) : undefined, i = 0; n?.parentId && i < 64; n = byId.get(n.parentId), i++) {
			out.add(n.parentId);
		}
		return out;
	}, [nodes, activeId]);

	if (!items) {
		return compact ? null : <div className='spinner' aria-busy />;
	}
	const kidsOf = (id: string) => nodes.filter((n) => n.parentId === id).sort(byPosition);
	// Parente absente de la liste (archivée ou invisible) : l'élément s'affiche à la racine.
	const roots = nodes.filter((n) => !n.parentId || !pageIds.has(n.parentId)).sort(byPosition);
	const labelOf = (node: TreeNode) => (node.page ? channelPageTitle(node.page, node.channelId ? channelNames?.get(node.channelId) : undefined) : node.title || 'Sans titre');
	const patchNode = (node: TreeNode, patch: { title?: string; icon?: string | null; parentId?: string | null; categoryId?: string | null; position?: number }) =>
		node.kind === 'page' ? patchPage(workspaceId, node.id, patch) : patchBase(workspaceId, node.id, patch);

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

	const addUnder = (node: TreeNode, at: DOMRect) => {
		setExpanded((prev) => new Set(prev).add(node.id));
		create.open({ parentId: node.id }, at);
	};

	const removeBase = async (node: TreeNode) => {
		if (!(await confirmDialog({ title: `Supprimer le suivi « ${labelOf(node)} » ?`, message: 'Tous ses éléments seront supprimés.', confirmLabel: 'Supprimer', danger: true }))) {
			return;
		}
		await api('DELETE', `/w/${workspaceId}/lists/${node.id}`);
		await refreshTreeBases(workspaceId);
	};

	const menuFor = (node: TreeNode, at: DOMRect): ContextMenuItem[] => {
		const page = node.page;
		return [
			...(node.write
				? [
						{ label: 'Renommer', icon: 'pencil' as const, onSelect: () => setRenaming(node.id) },
						{ label: 'Changer l’icône', icon: 'smile' as const, onSelect: () => setEmojiFor({ id: node.id, rect: at }) },
						...(page ? [{ label: 'Ajouter dedans…', icon: 'plus' as const, onSelect: () => addUnder(node, at.width ? at : new DOMRect(innerWidth / 2 - 100, innerHeight / 3, 1, 1)) }] : []),
						...(page && !node.channelId ? [{ label: 'Dupliquer', icon: 'copy' as const, onSelect: () => void duplicatePage(workspaceId, node.id).catch(report) }] : []),
						...(node.channelId ? [] : [{ label: 'Déplacer vers…', icon: 'forward' as const, onSelect: () => setMoving(node) }]),
					]
				: []),
			{ label: 'Partager…', icon: 'share', onSelect: () => setSharing({ kind: page ? 'page' : 'base', id: node.id, title: labelOf(node) }) },
			{ label: 'Copier le lien', icon: 'link', onSelect: () => void navigator.clipboard.writeText(`${location.origin}${hrefOf(workspaceId, node)}`) },
			favoriteItem({ kind: page ? 'canvas' : 'list', refId: node.id }, node.title),
			...(page && node.write && !node.channelId
				? (['sep', { label: 'Archiver', icon: 'trash', danger: true, onSelect: () => void patchPage(workspaceId, node.id, { archived: true }).catch(report) }] as ContextMenuItem[])
				: []),
			...(!page && node.base?.level === 'manage' ? (['sep', { label: 'Supprimer le suivi', icon: 'trash', danger: true, onSelect: () => void removeBase(node).catch(report) }] as ContextMenuItem[]) : []),
		];
	};

	const dropOn = async (target: TreeNode, zone: Zone, dragged: string) => {
		const node = nodes.find((n) => n.id === dragged);
		if (!node || node.id === target.id || node.channelId || (node.kind === 'page' && isInside(nodes, target.id, node.id))) {
			return;
		}
		if (zone === 'inside') {
			if (target.kind !== 'page') {
				return;
			}
			const kids = kidsOf(target.id).filter((n) => n.id !== node.id);
			setExpanded((prev) => new Set(prev).add(target.id));
			await patchNode(node, { parentId: target.id, position: positionAt(kids, kids.length), ...(node.kind === 'base' ? { categoryId: null } : {}) }).catch(report);
			return;
		}
		const parentId = target.parentId && pageIds.has(target.parentId) ? target.parentId : null;
		if (!parentId && target.channelId) {
			return;
		}
		const categoryId = parentId ? (node.categoryId ?? null) : (target.categoryId ?? null);
		const siblings = (parentId ? kidsOf(parentId) : roots.filter((n) => !n.channelId && (n.categoryId ?? null) === categoryId)).filter((n) => n.id !== node.id);
		const index = siblings.findIndex((n) => n.id === target.id) + (zone === 'after' ? 1 : 0);
		const moved = node.kind === 'base' ? { categoryId: parentId ? null : categoryId } : categoryId !== (node.categoryId ?? null) ? { categoryId } : {};
		await patchNode(node, { parentId, position: positionAt(siblings, index), ...moved }).catch(report);
	};

	const row = (node: TreeNode, depth: number) => {
		const kids = node.kind === 'page' ? kidsOf(node.id) : [];
		const opened = isOpen(node.id);
		const zone = drag?.over === node.id ? drag.zone : null;
		const href = hrefOf(workspaceId, node);
		const onDragOver = (e: DragEvent) => {
			if (!drag || drag.id === node.id) {
				return;
			}
			e.preventDefault();
			const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
			const y = (e.clientY - box.top) / box.height;
			const next: Zone = node.kind === 'base' ? (y < 0.5 ? 'before' : 'after') : y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside';
			if (drag.over !== node.id || drag.zone !== next) {
				setDrag({ ...drag, over: node.id, zone: next });
			}
		};
		return (
			<li key={node.id} role='treeitem' aria-expanded={kids.length ? opened : undefined} aria-selected={node.id === activeId}>
				<div
					className={`page-row${node.kind === 'base' ? ' page-row-base' : ''}${node.id === activeId ? ' page-row-active' : ''}${zone ? ` page-drop-${zone}` : ''}`}
					style={{ paddingLeft: 4 + depth * 14 }}
					draggable={renaming !== node.id && !node.channelId}
					onDragStart={(e) => {
						e.dataTransfer.effectAllowed = 'move';
						e.dataTransfer.setData(DRAG_TYPE, node.id);
						e.dataTransfer.setData('text/plain', node.id);
						startFavoriteDrag({ kind: node.kind === 'page' ? 'canvas' : 'list', refId: node.id });
						setDrag({ id: node.id, over: null, zone: 'inside' });
					}}
					onDragEnd={() => {
						endFavoriteDrag();
						setDrag(null);
					}}
					onDragOver={onDragOver}
					onDragLeave={() => drag?.over === node.id && setDrag({ ...drag, over: null })}
					onDrop={(e) => {
						e.preventDefault();
						const id = e.dataTransfer.getData(DRAG_TYPE) || drag?.id;
						const where = drag?.zone ?? 'inside';
						setDrag(null);
						if (id) {
							void dropOn(node, where, id);
						}
					}}
					{...menu.bind(() => menuFor(node, new DOMRect(0, 0, 0, 0)))}
				>
					<button type='button' className='page-twisty' aria-label={opened ? 'Replier' : 'Déplier'} tabIndex={-1} onClick={() => toggle(node.id)}>
						{kids.length ? (
							<span className={`page-caret${opened ? ' page-caret-open' : ''}`}>
								<Icon name='chevron' size={12} />
							</span>
						) : (
							nodeIcon(node, 14)
						)}
					</button>
					{kids.length > 0 && <span className='page-row-icon'>{nodeIcon(node, 14)}</span>}
					{renaming === node.id ? (
						<input
							className='page-rename'
							autoFocus
							defaultValue={node.title}
							aria-label='Nouveau titre'
							maxLength={120}
							onBlur={(e) => {
								setRenaming(null);
								const title = e.target.value.trim();
								if (title && title !== node.title) {
									void patchNode(node, { title }).catch(report);
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
						<a href={href} className='page-row-title ellipsis' aria-current={node.id === activeId ? 'page' : undefined} onClick={go(href)}>
							{labelOf(node)}
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
								menu.open(r.left, r.bottom, menuFor(node, r));
							}}
						>
							<Icon name='more' size={14} />
						</button>
						{node.kind === 'page' && node.write && (
							<button type='button' className='page-row-btn' aria-label='Ajouter dedans' title='Ajouter une page ou un suivi dedans' onClick={(e) => addUnder(node, (e.currentTarget as HTMLElement).getBoundingClientRect())}>
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

	const known = new Set(categories.map((c) => c.id));
	const loose = roots.filter((n) => !n.channelId && (!n.categoryId || !known.has(n.categoryId)));
	const salons = roots.filter((n) => n.channelId).sort((a, b) => labelOf(a).localeCompare(labelOf(b), 'fr'));

	const catMenu = (cat: PageCategory): ContextMenuItem[] => [
		...(cat.level === 'manage'
			? [
					{ label: 'Renommer', icon: 'pencil' as const, onSelect: () => setRenamingCat(cat.id) },
					{ label: 'Changer l’icône', icon: 'smile' as const, onSelect: () => setEmojiFor({ id: `cat:${cat.id}`, rect: new DOMRect(0, 0, 0, 0) }) },
				]
			: []),
		...(atLeast(cat.level, 'edit')
			? [
					{ label: 'Nouvelle page ici', icon: 'file' as const, onSelect: () => void createPage(workspaceId, { categoryId: cat.id }).catch(report) },
					{ label: 'Nouveau suivi ici', icon: 'list' as const, onSelect: () => create.open({ categoryId: cat.id }, new DOMRect(innerWidth / 2 - 100, innerHeight / 3, 1, 1)) },
				]
			: []),
		{ label: cat.level === 'manage' ? 'Partager…' : 'Voir le partage', icon: 'share', onSelect: () => setSharing({ kind: 'page_category', id: cat.id, title: cat.name }) },
		...(cat.level === 'manage'
			? ([
					'sep',
					{
						label: 'Supprimer la catégorie',
						icon: 'trash',
						danger: true,
						onSelect: () =>
							void confirmDialog({ title: `Supprimer la catégorie « ${cat.name} » ?`, message: 'Ses pages et suivis restent, sans catégorie.', confirmLabel: 'Supprimer', danger: true }).then(
								(ok) => ok && void deleteCategory(workspaceId, cat.id).catch(report),
							),
					},
				] as ContextMenuItem[])
			: []),
	];

	// Un élément glissé sur l'en-tête y entre ; une catégorie glissée prend sa place.
	const dropOnCategory = (cat: PageCategory, e: DragEvent) => {
		e.preventDefault();
		setCatOver(null);
		const draggedCat = e.dataTransfer.getData(CAT_DRAG);
		if (draggedCat) {
			const others = categories.filter((c) => c.id !== draggedCat);
			const index = others.findIndex((c) => c.id === cat.id);
			const before = others[index - 1]?.position ?? cat.position - 1;
			void patchCategory(workspaceId, draggedCat, { position: (before + cat.position) / 2 }).catch(report);
			return;
		}
		const id = e.dataTransfer.getData(DRAG_TYPE) || drag?.id;
		const node = nodes.find((n) => n.id === id);
		setDrag(null);
		if (node && !node.channelId && atLeast(cat.level, 'edit')) {
			const kids = roots.filter((n) => n.categoryId === cat.id && n.id !== node.id);
			setFolded((prev) => {
				const next = new Set(prev);
				next.delete(cat.id);
				return next;
			});
			void patchNode(node, { parentId: null, categoryId: cat.id, position: positionAt(kids, kids.length) }).catch(report);
		}
	};

	const foldToggle = (id: string, open: boolean) =>
		setFolded((prev) => {
			const next = new Set(prev);
			open ? next.add(id) : next.delete(id);
			return next;
		});

	const categoryRow = (cat: PageCategory) => {
		const open = !folded.has(cat.id);
		const inside = roots.filter((n) => !n.channelId && n.categoryId === cat.id);
		return (
			<li key={cat.id} role='treeitem' aria-expanded={open} className='page-cat'>
				<div
					className={`page-cat-head${catOver === cat.id ? ' page-cat-over' : ''}`}
					draggable={cat.level === 'manage' && renamingCat !== cat.id}
					onDragStart={(e) => {
						e.dataTransfer.effectAllowed = 'move';
						e.dataTransfer.setData(CAT_DRAG, cat.id);
					}}
					onDragOver={(e) => {
						e.preventDefault();
						catOver !== cat.id && setCatOver(cat.id);
					}}
					onDragLeave={() => catOver === cat.id && setCatOver(null)}
					onDrop={(e) => dropOnCategory(cat, e)}
					{...menu.bind(() => catMenu(cat))}
				>
					<button type='button' className='page-cat-toggle' aria-label={open ? 'Replier la catégorie' : 'Déplier la catégorie'} onClick={() => foldToggle(cat.id, open)}>
						<span className={`page-caret${open ? ' page-caret-open' : ''}`}>
							<Icon name='chevron' size={12} />
						</span>
						{cat.icon && <span className='page-cat-icon'>{cat.icon}</span>}
						{renamingCat !== cat.id && <span className='page-cat-name ellipsis'>{cat.name}</span>}
					</button>
					{renamingCat === cat.id && (
						<input
							className='page-rename'
							autoFocus
							defaultValue={cat.name}
							aria-label='Nouveau nom'
							maxLength={80}
							onBlur={(e) => {
								setRenamingCat(null);
								const name = e.target.value.trim();
								if (name && name !== cat.name) {
									void patchCategory(workspaceId, cat.id, { name }).catch(report);
								}
							}}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									(e.target as HTMLInputElement).blur();
								} else if (e.key === 'Escape') {
									setRenamingCat(null);
								}
							}}
						/>
					)}
					{cat.restricted && (
						<span className='page-cat-lock' title='Accès restreint'>
							<Icon name='shield' size={12} />
						</span>
					)}
					<span className='page-row-actions'>
						<button
							type='button'
							className='page-row-btn'
							aria-label='Actions de la catégorie'
							title='Actions de la catégorie'
							onClick={(e) => {
								const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
								menu.open(r.left, r.bottom, catMenu(cat));
							}}
						>
							<Icon name='more' size={14} />
						</button>
						{atLeast(cat.level, 'edit') && (
							<button
								type='button'
								className='page-row-btn'
								aria-label='Créer dans la catégorie'
								title='Nouvelle page ou suivi ici'
								onClick={(e) => create.open({ categoryId: cat.id }, (e.currentTarget as HTMLElement).getBoundingClientRect())}
							>
								<Icon name='plus' size={14} />
							</button>
						)}
					</span>
				</div>
				{open && (inside.length ? <ul role='group' className='page-tree-group'>{inside.map((n) => row(n, 0))}</ul> : <p className='page-cat-empty'>Glisse une page ou un suivi ici</p>)}
			</li>
		);
	};

	// Pages et suivis rattachés aux salons, à part des pages d'espace.
	const salonsRow = () => {
		const open = !folded.has('salons');
		return (
			<li key='salons' role='treeitem' aria-expanded={open} className='page-cat page-salons'>
				<div className='page-cat-head'>
					<button type='button' className='page-cat-toggle' aria-label={open ? 'Replier les salons' : 'Déplier les salons'} onClick={() => foldToggle('salons', open)}>
						<span className={`page-caret${open ? ' page-caret-open' : ''}`}>
							<Icon name='chevron' size={12} />
						</span>
						<span className='page-cat-name ellipsis'>Salons</span>
					</button>
				</div>
				{open && (
					<ul role='group' className='page-tree-group'>
						{salons.map((n) => row(n, 0))}
					</ul>
				)}
			</li>
		);
	};

	return (
		<>
			{roots.length === 0 && categories.length === 0 ? (
				<p className='page-tree-empty'>{compact ? 'Aucune page' : 'Aucune page pour l’instant.'}</p>
			) : (
				<ul className={`page-tree${compact ? ' page-tree-compact' : ''}`} role='tree' aria-label='Arbre des pages'>
					{loose.map((n) => row(n, 0))}
					{categories.map(categoryRow)}
					{salons.length > 0 && salonsRow()}
				</ul>
			)}
			{addingCat ? (
				<input
					className='page-rename page-cat-input'
					autoFocus
					placeholder='Nom de la catégorie'
					aria-label='Nom de la catégorie'
					maxLength={80}
					onBlur={(e) => {
						setAddingCat(false);
						const name = e.target.value.trim();
						if (name) {
							void createCategory(workspaceId, name).catch(report);
						}
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							(e.target as HTMLInputElement).blur();
						} else if (e.key === 'Escape') {
							setAddingCat(false);
						}
					}}
				/>
			) : (
				<button type='button' className='page-cat-new' onClick={() => setAddingCat(true)}>
					<Icon name='plus' size={12} /> Nouvelle catégorie
				</button>
			)}
			{sharing && (
				<ShareDialog
					workspaceId={workspaceId}
					kind={sharing.kind}
					id={sharing.id}
					title={sharing.title}
					onClose={() => setSharing(null)}
					onChanged={() => void Promise.all([refreshPages(workspaceId), refreshCategories(workspaceId), refreshTreeBases(workspaceId)]).catch(() => undefined)}
				/>
			)}
			{menu.menu}
			{create.ui}
			{emojiFor && (
				<EmojiPicker
					anchor={emojiFor.rect.width ? emojiFor.rect : new DOMRect(innerWidth / 2 - 160, innerHeight / 3, 1, 1)}
					onPick={(icon) => {
						const cat = emojiFor.id.startsWith('cat:') ? emojiFor.id.slice(4) : null;
						const node = nodes.find((n) => n.id === emojiFor.id);
						void (cat ? patchCategory(workspaceId, cat, { icon }) : node ? patchNode(node, { icon }) : Promise.resolve()).catch(report);
						setEmojiFor(null);
					}}
					onClose={() => setEmojiFor(null)}
				/>
			)}
			{moving && <MoveDialog node={moving} label={labelOf(moving)} nodes={nodes} onMove={(patch) => patchNode(moving, patch)} onClose={() => setMoving(null)} onError={report} />}
		</>
	);
}

function MoveDialog({
	node,
	label,
	nodes,
	onMove,
	onClose,
	onError,
}: {
	node: TreeNode;
	label: string;
	nodes: TreeNode[];
	onMove: (patch: { parentId: string | null; categoryId?: string | null; position: number }) => Promise<unknown>;
	onClose: () => void;
	onError: (e: unknown) => void;
}) {
	const [query, setQuery] = useState('');
	const q = query.trim().toLowerCase();
	const targets = nodes.filter((p) => p.kind === 'page' && p.write && p.id !== node.id && !isInside(nodes, p.id, node.id) && (!q || p.title.toLowerCase().includes(q))).slice(0, 50);
	const move = async (parentId: string | null) => {
		const siblings = nodes.filter((n) => n.parentId === parentId && n.id !== node.id);
		onClose();
		await onMove({ parentId, position: positionAt(siblings, siblings.length), ...(node.kind === 'base' && !parentId ? { categoryId: null } : {}) }).catch(onError);
	};
	return (
		<Dialog open onClose={onClose} title={`Déplacer « ${label} »`}>
			<div className='page-move'>
				<input className='field' autoFocus placeholder='Chercher une page' value={query} aria-label='Chercher une page' onChange={(e) => setQuery(e.target.value)} />
				<ul className='page-move-list'>
					{!q && node.parentId && (
						<li>
							<button type='button' className='menu-item' onClick={() => void move(null)}>
								<Icon name='home' size={15} /> Racine des pages
							</button>
						</li>
					)}
					{targets.map((p) => (
						<li key={p.id}>
							<button type='button' className='menu-item' disabled={p.id === node.parentId} onClick={() => void move(p.id)}>
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
