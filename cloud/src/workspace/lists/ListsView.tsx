import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import { LIST_COLUMN_TYPES, LIST_TEMPLATES, STATUS_COLORS, type ListColumn, type ListColumnType, type ListDetail, type ListItem, type ListSummary, type ListTemplate, type ListValue } from '../../../shared/lists';
import type { Channel, Member } from '../../../shared/types';
import { api, ApiError } from '../../api';
import { Floating } from '../../floating';
import { navigate, usePath } from '../../router';
import { Avatar, Dialog, Icon, useDismiss, type IconName } from '../../ui';
import { FavoriteStar } from '../favorites/FavoritesSection';
import { Cell, optionsOf, Pill, TYPE_ICON } from './cells';
import { ItemPanel } from './ItemPanel';
import './lists.css';

type Props = { workspaceId: string; members: Map<string, Member>; channels: Channel[]; version: number };

type Patch = { title?: string; description?: string; values?: Record<string, ListValue | null>; position?: number };

const updated = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Action impossible pour le moment.');
const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function readView(id: string): 'table' | 'board' {
	try {
		return localStorage.getItem(`synq:list-view:${id}`) === 'board' ? 'board' : 'table';
	} catch {
		return 'table';
	}
}

function MenuButton({ label, icon, className = 'btn', children }: { label: ReactNode; icon?: IconName; className?: string; children: (close: () => void) => ReactNode }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	return (
		<div ref={ref} className='lst-pop'>
			<button type='button' className={className} aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				{icon && <Icon name={icon} size={16} />}
				{label}
			</button>
			{open && (
				<Floating anchor={ref} placement='bottom-start' className='popover lst-menu' role='menu'>
					{children(() => setOpen(false))}
				</Floating>
			)}
		</div>
	);
}

export function ListsView({ workspaceId, members, channels, version }: Props) {
	const path = usePath();
	const segment = path.split('/')[4] ?? null;
	const salon = new URLSearchParams(location.search).get('salon');
	const rooms = useMemo(() => channels.filter((c) => c.kind === 'text'), [channels]);
	if (segment && segment !== 'nouvelle') {
		return <ListPage key={segment} workspaceId={workspaceId} listId={segment} members={members} rooms={rooms} version={version} />;
	}
	return <ListIndex workspaceId={workspaceId} rooms={rooms} salon={salon} creating={segment === 'nouvelle'} version={version} members={members} />;
}

function ListIndex({ workspaceId, rooms, salon, creating, version, members }: { workspaceId: string; rooms: Channel[]; salon: string | null; creating: boolean; version: number; members: Map<string, Member> }) {
	const [lists, setLists] = useState<ListSummary[] | null>(null);
	const [open, setOpen] = useState(creating);
	const room = rooms.find((r) => r.id === salon);

	useEffect(() => setOpen(creating), [creating]);
	useEffect(() => {
		void api<ListSummary[]>('GET', `/w/${workspaceId}/lists${salon ? `?channel=${salon}` : ''}`)
			.then(setLists)
			.catch(() => setLists([]));
	}, [workspaceId, salon, version]);

	return (
		<section className='lst-index'>
			<header className='lst-index-head'>
				<div>
					<h2>{room ? `Listes de #${room.name}` : 'Listes'}</h2>
					<p className='muted'>Suivre des tâches, des demandes ou des candidats avec toute l’équipe.</p>
				</div>
				<span className='grow' />
				{room && (
					<button type='button' className='btn btn-ghost' onClick={() => navigate(`/w/${workspaceId}/listes`)}>
						Toutes les listes
					</button>
				)}
				<button type='button' className='btn btn-primary' onClick={() => setOpen(true)}>
					<Icon name='plus' size={16} /> Nouvelle liste
				</button>
			</header>
			{lists === null ? (
				<div className='spinner' aria-busy />
			) : lists.length === 0 ? (
				<div className='lst-blank'>
					<Icon name='list' size={28} />
					<p>Aucune liste pour l’instant.</p>
					<button type='button' className='btn' onClick={() => setOpen(true)}>
						Créer une liste
					</button>
				</div>
			) : (
				<ul className='lst-cards'>
					{lists.map((l) => {
						const channel = rooms.find((r) => r.id === l.channelId);
						const author = members.get(l.createdBy);
						return (
							<li key={l.id}>
								<a
									className='lst-card'
									href={`/w/${workspaceId}/listes/${l.id}`}
									onClick={(e) => {
										e.preventDefault();
										navigate(`/w/${workspaceId}/listes/${l.id}`);
									}}
								>
									<span className='lst-card-icon'>
										<Icon name='list' />
									</span>
									<span className='lst-card-text'>
										<strong className='ellipsis'>{l.title}</strong>
										<span className='muted'>
											{l.itemCount} élément{l.itemCount > 1 ? 's' : ''} · modifiée le {updated.format(l.updatedAt)}
										</span>
									</span>
									{channel && <span className='tag'># {channel.name}</span>}
									{author && <Avatar name={author.name} url={author.avatarUrl} size={22} />}
								</a>
							</li>
						);
					})}
				</ul>
			)}
			{open && <CreateList workspaceId={workspaceId} rooms={rooms} initialChannel={salon} onClose={() => (creating ? navigate(`/w/${workspaceId}/listes`) : setOpen(false))} />}
		</section>
	);
}

function CreateList({ workspaceId, rooms, initialChannel, onClose }: { workspaceId: string; rooms: Channel[]; initialChannel: string | null; onClose: () => void }) {
	const [template, setTemplate] = useState<ListTemplate>('project');
	const [title, setTitle] = useState('');
	const [channelId, setChannelId] = useState<string | null>(initialChannel);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const channel = rooms.find((r) => r.id === channelId);
	const submit = async () => {
		setBusy(true);
		try {
			const created = await api<ListDetail>('POST', `/w/${workspaceId}/lists`, { template, title, channelId });
			navigate(`/w/${workspaceId}/listes/${created.id}`);
		} catch (e) {
			setError(message(e));
			setBusy(false);
		}
	};
	return (
		<Dialog open onClose={onClose} title='Nouvelle liste' wide>
			<div className='lst-create'>
				<div className='lst-templates' role='radiogroup' aria-label='Modèle'>
					{(Object.keys(LIST_TEMPLATES) as ListTemplate[]).map((key) => (
						<button key={key} type='button' role='radio' aria-checked={template === key} className='lst-template' onClick={() => setTemplate(key)}>
							<strong>{LIST_TEMPLATES[key].label}</strong>
							<span className='muted'>{LIST_TEMPLATES[key].hint}</span>
							<span className='lst-template-cols'>
								{LIST_TEMPLATES[key].columns.slice(0, 4).map((c) => (
									<span key={c.id}>
										<Icon name={TYPE_ICON[c.type]} size={12} /> {c.name}
									</span>
								))}
							</span>
						</button>
					))}
				</div>
				<label className='field'>
					Nom
					<input className='input' value={title} placeholder={LIST_TEMPLATES[template].title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
				</label>
				<div className='field'>
					Salon rattaché
					<MenuButton label={<span className='grow ellipsis'>{channel ? `# ${channel.name}` : 'Aucun, visible par tout l’espace'}</span>} className='btn lst-wide-btn'>
						{(close) => (
							<div className='lst-menu-scroll'>
								<button
									type='button'
									role='menuitem'
									className='menu-item'
									onClick={() => {
										setChannelId(null);
										close();
									}}
								>
									Aucun, visible par tout l’espace
								</button>
								{rooms.map((r) => (
									<button
										key={r.id}
										type='button'
										role='menuitem'
										className='menu-item'
										onClick={() => {
											setChannelId(r.id);
											close();
										}}
									>
										<Icon name='hash' size={14} /> {r.name}
									</button>
								))}
							</div>
						)}
					</MenuButton>
					<span className='field-hint'>Une liste rattachée suit la visibilité du salon.</span>
				</div>
				{error && <p className='notice notice-error'>{error}</p>}
				<div className='lst-actions'>
					<button type='button' className='btn btn-ghost' onClick={onClose}>
						Annuler
					</button>
					<button type='button' className='btn btn-primary' disabled={busy} onClick={() => void submit()}>
						Créer la liste
					</button>
				</div>
			</div>
		</Dialog>
	);
}

type Sort = { id: string; dir: 1 | -1 } | null;

function ListPage({ workspaceId, listId, members, rooms, version }: { workspaceId: string; listId: string; members: Map<string, Member>; rooms: Channel[]; version: number }) {
	const base = `/w/${workspaceId}/lists/${listId}`;
	const [list, setList] = useState<ListDetail | null>(null);
	const [missing, setMissing] = useState(false);
	const [error, setError] = useState('');
	const [view, setViewState] = useState<'table' | 'board'>(() => readView(listId));
	const [query, setQuery] = useState('');
	const [sort, setSort] = useState<Sort>(null);
	const [groupBy, setGroupBy] = useState<string | null>(null);
	const [boardBy, setBoardBy] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const selected = new URLSearchParams(location.search).get('element');

	const load = useCallback(() => {
		api<ListDetail>('GET', base)
			.then(setList)
			.catch((e) => (e instanceof ApiError && e.status === 404 ? setMissing(true) : setError(message(e))));
	}, [base]);
	useEffect(load, [load, version]);

	const setView = (next: 'table' | 'board') => {
		setViewState(next);
		try {
			localStorage.setItem(`synq:list-view:${listId}`, next);
		} catch {
			// Stockage indisponible : vue non mémorisée.
		}
	};
	const select = (id: string | null) => navigate(`/w/${workspaceId}/listes/${listId}${id ? `?element=${id}` : ''}`);

	const patchList = async (body: { title?: string; columns?: ListColumn[] }) => {
		if (body.columns) {
			setList((l) => (l ? { ...l, columns: body.columns! } : l));
		}
		try {
			setList(await api<ListDetail>('PATCH', base, body));
		} catch (e) {
			setError(message(e));
			load();
		}
	};

	const patchItem = async (item: ListItem, patch: Patch) => {
		setList((l) => {
			if (!l) {
				return l;
			}
			const values = { ...item.values };
			for (const [k, v] of Object.entries(patch.values ?? {})) {
				if (v === null) {
					delete values[k];
				} else {
					values[k] = v;
				}
			}
			const next = { ...item, ...(patch.title !== undefined && { title: patch.title }), ...(patch.position !== undefined && { position: patch.position }), values };
			return { ...l, items: l.items.map((i) => (i.id === item.id ? next : i)).sort((a, b) => a.position - b.position) };
		});
		try {
			const saved = await api<ListItem>('PATCH', `${base}/items/${item.id}`, patch);
			setList((l) => (l ? { ...l, items: l.items.map((i) => (i.id === saved.id ? saved : i)).sort((a, b) => a.position - b.position) } : l));
		} catch (e) {
			setError(message(e));
			load();
		}
	};

	const addItem = async (values: Record<string, ListValue> = {}) => {
		try {
			const created = await api<ListItem>('POST', `${base}/items`, { title: '', values });
			setList((l) => (l ? { ...l, items: [...l.items, created] } : l));
			return created;
		} catch (e) {
			setError(message(e));
			return null;
		}
	};

	const deleteItem = async (item: ListItem) => {
		setList((l) => (l ? { ...l, items: l.items.filter((i) => i.id !== item.id) } : l));
		select(null);
		await api('DELETE', `${base}/items/${item.id}`).catch((e) => setError(message(e)));
	};

	if (missing) {
		return (
			<div className='lst-blank'>
				<Icon name='list' size={28} />
				<p>Cette liste n’existe pas ou n’est pas visible pour toi.</p>
				<button type='button' className='btn' onClick={() => navigate(`/w/${workspaceId}/listes`)}>
					Voir les listes
				</button>
			</div>
		);
	}
	if (!list) {
		return <div className='spinner' aria-busy />;
	}

	const needle = query.trim().toLowerCase();
	const textOf = (item: ListItem) =>
		[
			item.title,
			...list.columns.map((c) => {
				const v = item.values[c.id];
				if (v === undefined) {
					return '';
				}
				if (c.type === 'person') {
					return members.get(v as string)?.name ?? '';
				}
				if (c.type === 'status' || c.type === 'priority') {
					return optionsOf(c).find((o) => o.id === v)?.label ?? '';
				}
				return String(v);
			}),
		]
			.join(' ')
			.toLowerCase();
	let items = needle ? list.items.filter((i) => textOf(i).includes(needle)) : list.items;
	if (sort) {
		const column = list.columns.find((c) => c.id === sort.id);
		const key = (item: ListItem): string | number | null => {
			if (!column) {
				return item.title.toLowerCase() || null;
			}
			const v = item.values[column.id];
			if (v === undefined) {
				return null;
			}
			if (column.type === 'status' || column.type === 'priority') {
				return optionsOf(column).findIndex((o) => o.id === v);
			}
			if (column.type === 'person') {
				return members.get(v as string)?.name.toLowerCase() ?? null;
			}
			return typeof v === 'boolean' ? Number(v) : typeof v === 'string' ? v.toLowerCase() : v;
		};
		items = [...items].sort((a, b) => {
			const ka = key(a);
			const kb = key(b);
			if (ka === kb) {
				return 0;
			}
			if (ka === null) {
				return 1;
			}
			if (kb === null) {
				return -1;
			}
			return (ka < kb ? -1 : 1) * sort.dir;
		});
	}
	const groupable = list.columns.filter((c) => c.type === 'status' || c.type === 'person' || c.type === 'priority');
	const statusColumns = list.columns.filter((c) => c.type === 'status');
	const board = statusColumns.find((c) => c.id === boardBy) ?? statusColumns[0];
	const room = rooms.find((r) => r.id === list.channelId);
	const current = list.items.find((i) => i.id === selected);

	return (
		<div className='lst-page'>
			<div className='lst-main'>
				<header className='lst-head'>
					<button type='button' className='icon-btn' aria-label='Toutes les listes' title='Toutes les listes' onClick={() => navigate(`/w/${workspaceId}/listes${list.channelId ? `?salon=${list.channelId}` : ''}`)}>
						<Icon name='chevron-left' />
					</button>
					<input
						key={list.title}
						className='lst-title'
						defaultValue={list.title}
						aria-label='Nom de la liste'
						disabled={!list.canEdit}
						maxLength={120}
						onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== list.title && void patchList({ title: e.target.value })}
						onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
					/>
					{room && <span className='tag hide-mobile'># {room.name}</span>}
					<FavoriteStar kind='list' refId={list.id} title={list.title} />
					<span className='grow' />
					<a className='btn btn-ghost hide-mobile' href={`/api${base}/export`} download>
						<Icon name='download' size={16} /> Exporter en CSV
					</a>
					{list.canDelete && (
						<button type='button' className='icon-btn' aria-label='Supprimer la liste' title='Supprimer la liste' onClick={() => setConfirmDelete(true)}>
							<Icon name='trash' />
						</button>
					)}
				</header>
				<div className='lst-toolbar'>
					<div className='segmented' role='tablist' aria-label='Vue'>
						<button type='button' role='tab' aria-selected={view === 'table'} onClick={() => setView('table')}>
							Tableau
						</button>
						<button type='button' role='tab' aria-selected={view === 'board'} onClick={() => setView('board')}>
							Kanban
						</button>
					</div>
					<label className='lst-search'>
						<Icon name='search' size={15} />
						<input value={query} placeholder='Filtrer' aria-label='Filtrer les éléments' onChange={(e) => setQuery(e.target.value)} />
					</label>
					{view === 'table' ? (
						<MenuButton icon='list' label={groupBy ? `Groupé par ${list.columns.find((c) => c.id === groupBy)?.name ?? ''}` : 'Regrouper'} className='btn btn-ghost'>
							{(close) => (
								<>
									{[{ id: null as string | null, name: 'Sans regroupement' }, ...groupable].map((c) => (
										<button
											key={c.id ?? 'none'}
											type='button'
											role='menuitem'
											className='menu-item'
											onClick={() => {
												setGroupBy(c.id);
												close();
											}}
										>
											<span className='grow'>{c.name}</span>
											{groupBy === c.id && <Icon name='check' size={14} />}
										</button>
									))}
								</>
							)}
						</MenuButton>
					) : (
						statusColumns.length > 1 && (
							<MenuButton icon='list' label={`Colonnes : ${board?.name ?? ''}`} className='btn btn-ghost'>
								{(close) =>
									statusColumns.map((c) => (
										<button
											key={c.id}
											type='button'
											role='menuitem'
											className='menu-item'
											onClick={() => {
												setBoardBy(c.id);
												close();
											}}
										>
											{c.name}
										</button>
									))
								}
							</MenuButton>
						)
					)}
					{sort && (
						<button type='button' className='btn btn-ghost' onClick={() => setSort(null)}>
							<Icon name='close' size={14} /> Tri : {list.columns.find((c) => c.id === sort.id)?.name ?? 'Titre'}
						</button>
					)}
				</div>
				{error && (
					<p className='notice notice-error lst-error' role='alert'>
						{error}
						<button type='button' className='icon-btn icon-btn-sm' aria-label='Fermer' onClick={() => setError('')}>
							<Icon name='close' size={14} />
						</button>
					</p>
				)}
				{view === 'table' ? (
					<Table list={list} items={items} members={members} sort={sort} groupBy={groupBy} onSort={setSort} onColumns={(columns) => void patchList({ columns })} onPatch={patchItem} onAdd={addItem} onOpen={select} />
				) : board ? (
					<Board list={list} column={board} items={items} members={members} onPatch={patchItem} onAdd={addItem} onOpen={select} />
				) : (
					<div className='lst-blank'>
						<p>Le kanban range les éléments par statut.</p>
						{list.canEdit && (
							<button
								type='button'
								className='btn'
								onClick={() => void patchList({ columns: [...list.columns, { id: newId(), name: 'Statut', type: 'status', options: defaultOptions() }] })}
							>
								Ajouter une colonne Statut
							</button>
						)}
					</div>
				)}
			</div>
			{current && <ItemPanel base={base} item={current} columns={list.columns} members={members} editable={list.canEdit} version={version} onPatch={patchItem} onDelete={deleteItem} onClose={() => select(null)} />}
			<Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title='Supprimer la liste'>
				<p>
					« {list.title} » et ses {list.items.length} élément{list.items.length > 1 ? 's' : ''} seront supprimés pour tout le monde.
				</p>
				<div className='lst-actions'>
					<button type='button' className='btn btn-ghost' onClick={() => setConfirmDelete(false)}>
						Annuler
					</button>
					<button
						type='button'
						className='btn btn-danger'
						onClick={async () => {
							await api('DELETE', base).catch((e) => setError(message(e)));
							navigate(`/w/${workspaceId}/listes`);
						}}
					>
						Supprimer
					</button>
				</div>
			</Dialog>
		</div>
	);
}

const defaultOptions = () => ['À faire', 'En cours', 'Terminé'].map((label, i) => ({ id: newId() + i, label, color: STATUS_COLORS[[0, 1, 4][i]!]! }));

// Position entre deux voisins ; ordre conservé sans renuméroter.
const between = (before: ListItem | undefined, after: ListItem | undefined) =>
	before && after ? (before.position + after.position) / 2 : after ? after.position - 1 : before ? before.position + 1 : 1;

type TableProps = {
	list: ListDetail;
	items: ListItem[];
	members: Map<string, Member>;
	sort: Sort;
	groupBy: string | null;
	onSort: (sort: Sort) => void;
	onColumns: (columns: ListColumn[]) => void;
	onPatch: (item: ListItem, patch: Patch) => void;
	onAdd: (values?: Record<string, ListValue>) => Promise<ListItem | null>;
	onOpen: (id: string) => void;
};

function Table({ list, items, members, sort, groupBy, onSort, onColumns, onPatch, onAdd, onOpen }: TableProps) {
	const [widths, setWidths] = useState<Record<string, number>>({});
	const [dragCol, setDragCol] = useState<string | null>(null);
	const [dragRow, setDragRow] = useState<string | null>(null);
	const editable = list.canEdit;
	const widthOf = (c: ListColumn) => widths[c.id] ?? c.width ?? (c.type === 'checkbox' ? 110 : c.type === 'text' || c.type === 'link' ? 220 : 170);

	const resize = (column: ListColumn) => (event: ReactPointerEvent) => {
		event.preventDefault();
		event.stopPropagation();
		const start = event.clientX;
		const initial = widthOf(column);
		let last = initial;
		const move = (e: PointerEvent) => {
			last = Math.max(80, Math.min(600, initial + e.clientX - start));
			setWidths((w) => ({ ...w, [column.id]: last }));
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			if (last !== initial) {
				onColumns(list.columns.map((c) => (c.id === column.id ? { ...c, width: last } : c)));
			}
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	};

	const dropColumn = (target: string) => {
		if (!dragCol || dragCol === target) {
			return;
		}
		const moved = list.columns.find((c) => c.id === dragCol)!;
		const rest = list.columns.filter((c) => c.id !== dragCol);
		rest.splice(
			rest.findIndex((c) => c.id === target),
			0,
			moved,
		);
		setDragCol(null);
		onColumns(rest);
	};

	const dropRow = (target: ListItem) => {
		const moved = list.items.find((i) => i.id === dragRow);
		setDragRow(null);
		if (!moved || moved.id === target.id) {
			return;
		}
		const index = list.items.findIndex((i) => i.id === target.id);
		onPatch(moved, { position: between(list.items[index - 1]?.id === moved.id ? list.items[index - 2] : list.items[index - 1], target) });
	};

	const groupColumn = list.columns.find((c) => c.id === groupBy);
	const groups: Array<{ key: string; label: ReactNode; items: ListItem[]; values: Record<string, ListValue> }> = [];
	if (groupColumn) {
		const keys =
			groupColumn.type === 'person'
				? [...new Set(items.map((i) => i.values[groupColumn.id]).filter((v): v is string => typeof v === 'string'))].map((id) => ({
						key: id,
						label: (
							<span className='lst-person'>
								<Avatar name={members.get(id)?.name ?? '?'} url={members.get(id)?.avatarUrl} size={20} />
								{members.get(id)?.name ?? 'Ancien membre'}
							</span>
						),
					}))
				: optionsOf(groupColumn).map((o) => ({ key: o.id, label: <Pill option={o} /> }));
		for (const { key, label } of keys) {
			groups.push({ key, label, items: items.filter((i) => i.values[groupColumn.id] === key), values: { [groupColumn.id]: key } });
		}
		groups.push({ key: '', label: <span className='muted'>Sans valeur</span>, items: items.filter((i) => !keys.some((k) => k.key === i.values[groupColumn.id])), values: {} });
	} else {
		groups.push({ key: '', label: null, items, values: {} });
	}
	const reorderable = editable && !sort && !groupColumn;

	const row = (item: ListItem) => (
		<tr
			key={item.id}
			className={dragRow === item.id ? 'is-dragging' : undefined}
			onDragOver={(e) => dragRow && e.preventDefault()}
			onDrop={(e) => {
				e.preventDefault();
				dropRow(item);
			}}
		>
			<td className='lst-grip-cell'>
				{reorderable && (
					<span
						className='lst-grip'
						draggable
						aria-label='Déplacer'
						onDragStart={(e: DragEvent) => {
							e.dataTransfer.effectAllowed = 'move';
							e.dataTransfer.setData('text/plain', item.id);
							setDragRow(item.id);
						}}
						onDragEnd={() => setDragRow(null)}
					>
						<Icon name='more' size={14} />
					</span>
				)}
			</td>
			<td className='lst-title-cell'>
				<input
					key={item.title}
					className='lst-input'
					defaultValue={item.title}
					placeholder='Sans titre'
					aria-label='Titre'
					disabled={!editable}
					onBlur={(e) => e.target.value.trim() !== item.title && onPatch(item, { title: e.target.value })}
					onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
				/>
				<button type='button' className='lst-open' aria-label='Ouvrir le détail' title='Ouvrir le détail' onClick={() => onOpen(item.id)}>
					{item.comments > 0 && <span className='lst-count'>{item.comments}</span>}
					<Icon name='expand' size={14} />
				</button>
			</td>
			{list.columns.map((c) => (
				<td key={c.id}>
					<Cell column={c} item={item} members={members} editable={editable} onChange={(value) => onPatch(item, { values: { [c.id]: value } })} />
				</td>
			))}
			<td />
		</tr>
	);

	return (
		<div className='lst-scroll'>
			<table className='lst-table' style={{ width: 28 + 280 + list.columns.reduce((sum, c) => sum + widthOf(c), 0) + 48 }}>
				<colgroup>
					<col style={{ width: 28 }} />
					<col style={{ width: 280 }} />
					{list.columns.map((c) => (
						<col key={c.id} style={{ width: widthOf(c) }} />
					))}
					<col style={{ width: 48 }} />
				</colgroup>
				<thead>
					<tr>
						<th />
						<th>
							<button type='button' className='lst-th' onClick={() => onSort(sort?.id === 'title' ? (sort.dir === 1 ? { id: 'title', dir: -1 } : null) : { id: 'title', dir: 1 })}>
								<span className='ellipsis'>Titre</span>
								{sort?.id === 'title' && <Icon name={sort.dir === 1 ? 'up' : 'down'} size={13} />}
							</button>
						</th>
						{list.columns.map((c) => (
							<th
								key={c.id}
								draggable={editable}
								className={dragCol === c.id ? 'is-dragging' : undefined}
								onDragStart={(e) => {
									e.dataTransfer.effectAllowed = 'move';
									e.dataTransfer.setData('text/plain', c.id);
									setDragCol(c.id);
								}}
								onDragEnd={() => setDragCol(null)}
								onDragOver={(e) => dragCol && e.preventDefault()}
								onDrop={(e) => {
									e.preventDefault();
									dropColumn(c.id);
								}}
							>
								<ColumnHeader column={c} sort={sort} editable={editable} onSort={onSort} onChange={(next) => onColumns(next ? list.columns.map((x) => (x.id === c.id ? next : x)) : list.columns.filter((x) => x.id !== c.id))} />
								{editable && <span className='lst-resize' role='separator' aria-label={`Largeur de ${c.name}`} onPointerDown={resize(c)} />}
							</th>
						))}
						<th>
							{editable && (
								<MenuButton label={<Icon name='plus' size={16} />} className='icon-btn icon-btn-sm'>
									{(close) => (
										<>
											<p className='lst-menu-title'>Ajouter une colonne</p>
											{LIST_COLUMN_TYPES.map((t) => (
												<button
													key={t.id}
													type='button'
													role='menuitem'
													className='menu-item'
													onClick={() => {
														close();
														onColumns([...list.columns, { id: newId(), name: t.label, type: t.id as ListColumnType, ...(t.id === 'status' && { options: defaultOptions() }) }]);
													}}
												>
													<Icon name={TYPE_ICON[t.id]} size={14} /> {t.label}
												</button>
											))}
										</>
									)}
								</MenuButton>
							)}
						</th>
					</tr>
				</thead>
				{groups.map((g) => (
					<tbody key={g.key || 'none'}>
						{g.label && (
							<tr className='lst-group'>
								<td colSpan={list.columns.length + 3}>
									{g.label} <span className='muted'>{g.items.length}</span>
								</td>
							</tr>
						)}
						{g.items.map(row)}
						{editable && (
							<tr className='lst-add-row'>
								<td />
								<td colSpan={list.columns.length + 2}>
									<button type='button' className='lst-add' onClick={() => void onAdd(g.values).then((created) => created && onOpen(created.id))}>
										<Icon name='plus' size={14} /> Nouvel élément
									</button>
								</td>
							</tr>
						)}
					</tbody>
				))}
			</table>
			{items.length === 0 && list.items.length > 0 && <p className='lst-none muted'>Aucun élément ne correspond au filtre.</p>}
		</div>
	);
}

function ColumnHeader({ column, sort, editable, onSort, onChange }: { column: ListColumn; sort: Sort; editable: boolean; onSort: (sort: Sort) => void; onChange: (next: ListColumn | null) => void }) {
	const [name, setName] = useState(column.name);
	const [option, setOption] = useState('');
	return (
		<MenuButton
			className='lst-th'
			label={
				<>
					<Icon name={TYPE_ICON[column.type]} size={13} />
					<span className='ellipsis'>{column.name}</span>
					{sort?.id === column.id && <Icon name={sort.dir === 1 ? 'up' : 'down'} size={13} />}
				</>
			}
		>
			{(close) => (
				<>
					<button
						type='button'
						role='menuitem'
						className='menu-item'
						onClick={() => {
							onSort({ id: column.id, dir: 1 });
							close();
						}}
					>
						<Icon name='up' size={14} /> Trier par ordre croissant
					</button>
					<button
						type='button'
						role='menuitem'
						className='menu-item'
						onClick={() => {
							onSort({ id: column.id, dir: -1 });
							close();
						}}
					>
						<Icon name='down' size={14} /> Trier par ordre décroissant
					</button>
					{editable && (
						<>
							<div className='menu-sep' />
							<form
								className='lst-menu-form'
								onSubmit={(e) => {
									e.preventDefault();
									if (name.trim() && name.trim() !== column.name) {
										onChange({ ...column, name: name.trim() });
									}
									close();
								}}
							>
								<input value={name} maxLength={40} aria-label='Nom de la colonne' onChange={(e) => setName(e.target.value)} />
								<button type='submit' className='btn'>
									Renommer
								</button>
							</form>
							{column.type === 'status' && (
								<>
									<div className='lst-menu-options'>
										{(column.options ?? []).map((o) => (
											<span key={o.id} className='lst-option-row'>
												<Pill option={o} />
												<button type='button' className='icon-btn icon-btn-sm' aria-label={`Retirer ${o.label}`} onClick={() => onChange({ ...column, options: (column.options ?? []).filter((x) => x.id !== o.id) })}>
													<Icon name='close' size={12} />
												</button>
											</span>
										))}
									</div>
									<form
										className='lst-menu-form'
										onSubmit={(e) => {
											e.preventDefault();
											const options = column.options ?? [];
											if (option.trim()) {
												onChange({ ...column, options: [...options, { id: newId(), label: option.trim(), color: STATUS_COLORS[options.length % STATUS_COLORS.length]! }] });
												setOption('');
											}
										}}
									>
										<input value={option} maxLength={40} placeholder='Nouvelle option' aria-label='Nouvelle option' onChange={(e) => setOption(e.target.value)} />
										<button type='submit' className='btn'>
											Ajouter
										</button>
									</form>
								</>
							)}
							<div className='menu-sep' />
							<button
								type='button'
								role='menuitem'
								className='menu-item menu-item-danger'
								onClick={() => {
									close();
									onChange(null);
								}}
							>
								<Icon name='trash' size={14} /> Supprimer la colonne
							</button>
						</>
					)}
				</>
			)}
		</MenuButton>
	);
}

function Board({ list, column, items, members, onPatch, onAdd, onOpen }: { list: ListDetail; column: ListColumn; items: ListItem[]; members: Map<string, Member>; onPatch: (item: ListItem, patch: Patch) => void; onAdd: (values?: Record<string, ListValue>) => Promise<ListItem | null>; onOpen: (id: string) => void }) {
	const [drag, setDrag] = useState<string | null>(null);
	const [over, setOver] = useState<string | null>(null);
	const editable = list.canEdit;
	const options = optionsOf(column);
	const lanes = [...options.map((o) => ({ key: o.id, option: o })), { key: '', option: null }];
	const person = list.columns.find((c) => c.type === 'person');
	const date = list.columns.find((c) => c.type === 'date');
	const priority = list.columns.find((c) => c.type === 'priority');

	const drop = (lane: string, before: ListItem | null) => {
		const moved = list.items.find((i) => i.id === drag);
		setDrag(null);
		setOver(null);
		if (!moved) {
			return;
		}
		const laneItems = items.filter((i) => (i.values[column.id] ?? '') === lane && i.id !== moved.id);
		const index = before ? laneItems.findIndex((i) => i.id === before.id) : laneItems.length;
		onPatch(moved, { values: { [column.id]: lane || null }, position: between(laneItems[index - 1], laneItems[index]) });
	};

	return (
		<div className='lst-board'>
			{lanes.map(({ key, option }) => {
				const laneItems = items.filter((i) => (option ? i.values[column.id] === key : !options.some((o) => o.id === i.values[column.id])));
				return (
					<section
						key={key || 'none'}
						className={`lst-lane${over === key ? ' is-over' : ''}`}
						aria-label={option?.label ?? 'Sans statut'}
						onDragOver={(e) => {
							if (drag) {
								e.preventDefault();
								setOver(key);
							}
						}}
						onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
						onDrop={(e) => {
							e.preventDefault();
							drop(key, null);
						}}
					>
						<header className='lst-lane-head'>
							{option ? <Pill option={option} /> : <span className='muted'>Sans statut</span>}
							<span className='muted'>{laneItems.length}</span>
						</header>
						<div className='lst-lane-body'>
							{laneItems.map((item) => {
								const who = person && typeof item.values[person.id] === 'string' ? members.get(item.values[person.id] as string) : undefined;
								const due = date ? item.values[date.id] : undefined;
								const prio = priority ? optionsOf(priority).find((o) => o.id === item.values[priority.id]) : undefined;
								return (
									<article
										key={item.id}
										className={`lst-kcard${drag === item.id ? ' is-dragging' : ''}`}
										draggable={editable}
										tabIndex={0}
										onDragStart={(e) => {
											e.dataTransfer.effectAllowed = 'move';
											e.dataTransfer.setData('text/plain', item.id);
											setDrag(item.id);
										}}
										onDragEnd={() => {
											setDrag(null);
											setOver(null);
										}}
										onDrop={(e) => {
											e.preventDefault();
											e.stopPropagation();
											drop(key, item);
										}}
										onClick={() => onOpen(item.id)}
										onKeyDown={(e) => e.key === 'Enter' && onOpen(item.id)}
									>
										<p className='lst-kcard-title'>{item.title || <span className='muted'>Sans titre</span>}</p>
										<div className='lst-kcard-meta'>
											{prio && <Pill option={prio} />}
											{typeof due === 'string' && (
												<span className='lst-kcard-date'>
													<Icon name='calendar' size={12} /> {updated.format(new Date(`${due}T12:00:00`))}
												</span>
											)}
											{item.comments > 0 && (
												<span className='lst-kcard-date'>
													<Icon name='chat' size={12} /> {item.comments}
												</span>
											)}
											<span className='grow' />
											{who && <Avatar name={who.name} url={who.avatarUrl} size={22} />}
										</div>
									</article>
								);
							})}
						</div>
						{editable && (
							<button type='button' className='lst-add' onClick={() => void onAdd(key ? { [column.id]: key } : {}).then((created) => created && onOpen(created.id))}>
								<Icon name='plus' size={14} /> Ajouter
							</button>
						)}
					</section>
				);
			})}
		</div>
	);
}

