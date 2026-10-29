import { useCallback, useEffect, useState } from 'react';

import { LIST_VIEW_KINDS, defaultCardFace, defaultViewConfig, type CardFace, type ListColumn, type ListDetail, type ListItem, type ListLabel, type ListSavedView, type ListValue, type ListViewKind, type ViewConfig, type ViewFilter } from '../../../shared/lists';
import type { Channel, Member } from '../../../shared/types';
import { api, ApiError } from '../../api';
import { navigate, useSearch } from '../../router';
import { Dialog, Icon, type IconName } from '../../ui';
import { ShareDialog } from '../access/ShareDialog';
import { HeaderMenu } from '../ChannelHeader';
import { useContextMenu, type ContextMenuItem } from '../ContextMenu';
import { FavoriteStar } from '../favorites/FavoritesSection';
import { Automations } from './Automations';
import { optionsOf } from './cells';
import { ArchiveDialog, ItemPanel } from './ItemPanel';
import { defaultOptions, MenuButton, newId, Table, type Patch } from './table';
import { Board, CalendarView, GalleryView, TimelineView, visibleItems, type CardFocus, type Quick } from './views';
import './bases.css';

export const VIEW_ICON: Record<ListViewKind, IconName> = { table: 'list', board: 'copy', calendar: 'calendar', gallery: 'image', timeline: 'clock' };

const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Action impossible pour le moment.');

type PageProps = {
	workspaceId: string;
	listId: string;
	members: Map<string, Member>;
	rooms: Channel[];
	version: number;
	myId: string;
	// Intégrée dans une page : pas d'en-tête ni de panneau, l'élément s'ouvre dans la base.
	compact?: boolean;
	viewId?: string | null;
};

const merged = (item: ListItem, patch: Patch): ListItem => {
	const values = { ...item.values };
	for (const [k, v] of Object.entries(patch.values ?? {})) {
		if (v === null) {
			delete values[k];
		} else {
			values[k] = v;
		}
	}
	const { values: _ignored, ...rest } = patch;
	return { ...item, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)), values };
};

export function ListPage({ workspaceId, listId, members, rooms, version, myId, compact = false, viewId: fixedView = null }: PageProps) {
	const base = `/w/${workspaceId}/lists/${listId}`;
	const page = `/w/${workspaceId}/listes/${listId}`;
	const search = useSearch();
	const params = new URLSearchParams(search);
	const [list, setList] = useState<ListDetail | null>(null);
	const [missing, setMissing] = useState(false);
	const [error, setError] = useState('');
	const [localView, setLocalView] = useState<string | null>(fixedView);
	const [query, setQuery] = useState('');
	const [quick, setQuick] = useState<Quick>({ mine: false, overdue: false, label: null });
	const [drafts, setDrafts] = useState<Record<string, ViewConfig>>({});
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [rulesOpen, setRulesOpen] = useState(false);
	const [sharing, setSharing] = useState(false);
	const [focus, setFocus] = useState<CardFocus | null>(null);
	const [archiveOpen, setArchiveOpen] = useState(false);
	const selected = compact ? null : params.get('element');
	const full = params.get('plein') === '1';
	const viewId = compact ? localView : (params.get('vue') ?? localView);

	const load = useCallback(() => {
		api<ListDetail>('GET', base)
			.then(setList)
			.catch((e) => (e instanceof ApiError && e.status === 404 ? setMissing(true) : setError(message(e))));
	}, [base]);
	useEffect(load, [load, version]);

	const go = (next: { vue?: string | null; element?: string | null; plein?: boolean }) => {
		if (compact) {
			if (next.element) {
				navigate(`${page}?element=${next.element}`);
			} else if (next.vue !== undefined) {
				setLocalView(next.vue);
			}
			return;
		}
		const q = new URLSearchParams();
		const vue = next.vue !== undefined ? next.vue : viewId;
		const element = next.element !== undefined ? next.element : selected;
		if (vue) {
			q.set('vue', vue);
		}
		if (element) {
			q.set('element', element);
			if (next.plein ?? (next.element === undefined && full)) {
				q.set('plein', '1');
			}
		}
		setLocalView(vue);
		navigate(`${page}${q.toString() ? `?${q}` : ''}`);
	};

	const patchList = async (body: { title?: string; columns?: ListColumn[]; labels?: ListLabel[] }) => {
		setList((l) => (l ? { ...l, ...(body.columns && { columns: body.columns }), ...(body.labels && { labels: body.labels }) } : l));
		try {
			setList(await api<ListDetail>('PATCH', base, body));
		} catch (e) {
			setError(message(e));
			load();
		}
	};

	const patchItem = async (item: ListItem, patch: Patch) => {
		setList((l) => (l ? { ...l, items: l.items.map((i) => (i.id === item.id ? merged(i, patch) : i)).sort((a, b) => a.position - b.position) } : l));
		try {
			const saved = await api<ListItem>('PATCH', `${base}/items/${item.id}`, patch);
			setList((l) => (l ? { ...l, items: l.items.map((i) => (i.id === saved.id ? saved : i)).sort((a, b) => a.position - b.position) } : l));
		} catch (e) {
			setError(message(e));
			load();
		}
	};

	const addItem = async (values: Record<string, ListValue> = {}, title = '', extra: Patch = {}) => {
		try {
			const created = await api<ListItem>('POST', `${base}/items`, { ...extra, title, values });
			setList((l) => (l ? { ...l, items: [...l.items, created] } : l));
			return created;
		} catch (e) {
			setError(message(e));
			return null;
		}
	};

	const fromTemplate = async (template: ListItem, values: Record<string, ListValue>) => {
		try {
			const created = await api<ListItem>('POST', `${base}/items/${template.id}/duplicate`, { values });
			setList((l) => (l ? { ...l, items: [...l.items, created].sort((a, b) => a.position - b.position) } : l));
			go({ element: created.id });
		} catch (e) {
			setError(message(e));
		}
	};

	const deleteItem = async (item: ListItem) => {
		setList((l) => (l ? { ...l, items: l.items.filter((i) => i.id !== item.id) } : l));
		go({ element: null });
		await api('DELETE', `${base}/items/${item.id}`).catch((e) => setError(message(e)));
	};

	const tabMenu = useContextMenu();
	const [renaming, setRenaming] = useState<ListSavedView | null>(null);

	if (missing) {
		return (
			<div className='lst-blank'>
				<Icon name='list' size={28} />
				<p>Ce suivi n’existe pas ou n’est pas visible pour toi.</p>
				{!compact && (
					<button type='button' className='btn' onClick={() => navigate(`/w/${workspaceId}/listes`)}>
						Voir les bases
					</button>
				)}
			</div>
		);
	}
	if (!list) {
		return <div className='spinner' aria-busy />;
	}

	const view = list.views.find((v) => v.id === viewId) ?? list.views[0];
	const config = view ? (drafts[view.id] ?? view.config) : defaultViewConfig();
	const setConfig = (patch: Partial<ViewConfig>) => {
		if (!view) {
			return;
		}
		setDrafts((d) => ({ ...d, [view.id]: { ...config, ...patch } }));
		if (list.canEdit) {
			void api<ListSavedView>('PATCH', `${base}/views/${view.id}`, { config: patch })
				.then((saved) => setList((l) => (l ? { ...l, views: l.views.map((v) => (v.id === saved.id ? saved : v)) } : l)))
				.catch((e) => setError(message(e)));
		}
	};
	const addView = async (kind: ListViewKind) => {
		try {
			const created = await api<ListSavedView>('POST', `${base}/views`, { kind });
			setList((l) => (l ? { ...l, views: [...l.views, created] } : l));
			go({ vue: created.id });
		} catch (e) {
			setError(message(e));
		}
	};
	const renameView = async (target: ListSavedView, name: string) => {
		try {
			const saved = await api<ListSavedView>('PATCH', `${base}/views/${target.id}`, { name });
			setList((l) => (l ? { ...l, views: l.views.map((v) => (v.id === saved.id ? saved : v)) } : l));
		} catch (e) {
			setError(message(e));
		}
	};
	// Renommer et supprimer au clic droit ou au « ⋯ » de l'onglet : le menu de réglages les cachait.
	const viewItems = (v: ListSavedView): ContextMenuItem[] => [
		{ label: 'Renommer la vue', icon: 'pencil', onSelect: () => setRenaming(v) },
		...(list && list.views.length > 1 ? (['sep', { label: 'Supprimer la vue', icon: 'trash', danger: true, onSelect: () => void removeView(v) }] as ContextMenuItem[]) : []),
	];
	const removeView = async (target: ListSavedView) => {
		try {
			await api('DELETE', `${base}/views/${target.id}`);
			setList((l) => (l ? { ...l, views: l.views.filter((v) => v.id !== target.id) } : l));
			go({ vue: null });
		} catch (e) {
			setError(message(e));
		}
	};
	const toggleFilter = (filter: ViewFilter) => {
		const has = config.filters.some((f) => f.field === filter.field && f.op === filter.op && f.value === filter.value);
		setConfig({ filters: has ? config.filters.filter((f) => !(f.field === filter.field && f.op === filter.op && f.value === filter.value)) : [...config.filters, filter] });
	};

	const items = visibleItems(list, config, quick, query, members, myId);
	const shown = list.columns.filter((c) => !config.hidden.includes(c.id));
	const statusColumns = list.columns.filter((c) => c.type === 'status');
	const board = statusColumns.find((c) => c.id === config.boardBy) ?? statusColumns[0];
	const groupable = list.columns.filter((c) => c.type === 'status' || c.type === 'person' || c.type === 'priority');
	const filterable = list.columns.filter((c) => c.type === 'status' || c.type === 'priority');
	const dateFields = [{ id: 'due', name: 'Échéance' }, { id: 'start', name: 'Début' }, ...list.columns.filter((c) => c.type === 'date')];
	const room = rooms.find((r) => r.id === list.channelId);
	const current = list.items.find((i) => i.id === selected);
	const face: CardFace = { ...defaultCardFace(), ...config.card };
	const setFace = (patch: Partial<CardFace>) => setConfig({ card: { ...face, ...patch } });
	const open = (id: string, target?: CardFocus) => {
		setFocus(target ?? null);
		go({ element: id });
	};
	const viewProps = { workspaceId, list, items, members, myId, face, onPatch: patchItem, onAdd: addItem, onOpen: open, onFromTemplate: (t: ListItem, values: Record<string, ListValue>) => void fromTemplate(t, values) };
	const kind = view?.kind ?? 'table';
	const quickLabel = list.labels.find((l) => l.id === quick.label);

	return (
		<div className={`lst-page${compact ? ' bs-compact' : ''}`}>
			<div className='lst-main'>
				{!compact && (
					<header className='lst-head'>
						<button type='button' className='icon-btn' aria-label='Tous les suivis' title='Tous les suivis' onClick={() => navigate(`/w/${workspaceId}/listes${list.channelId ? `?salon=${list.channelId}` : ''}`)}>
							<Icon name='chevron-left' />
						</button>
						<input
							key={list.title}
							className='lst-title'
							defaultValue={list.title}
							aria-label='Nom du suivi'
							disabled={!list.canEdit}
							maxLength={120}
							onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== list.title && void patchList({ title: e.target.value })}
							onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
						/>
						{room && <span className='tag hide-mobile'># {room.name}</span>}
						<FavoriteStar kind='list' refId={list.id} title={list.title} />
						<span className='grow' />
						<button type='button' className='btn btn-ghost' onClick={() => setSharing(true)}>
							<Icon name='users' size={16} /> <span className='hide-mobile'>Partager</span>
						</button>
						{sharing && <ShareDialog workspaceId={workspaceId} kind='base' id={list.id} title={list.title || 'Sans titre'} onClose={() => setSharing(false)} />}
						<button type='button' className='btn btn-ghost' onClick={() => setRulesOpen(true)}>
							<Icon name='repeat' size={16} /> <span className='hide-mobile'>Automatisations</span>
						</button>
						<HeaderMenu
							actions={[
								{ key: 'archives', label: 'Archives', icon: 'folder', onSelect: () => setArchiveOpen(true) },
								{ key: 'export', label: 'Exporter en CSV', icon: 'download', onSelect: () => window.open(`/api${base}/export`, '_blank') },
								...(list.canDelete ? ['separator' as const, { key: 'delete', label: 'Supprimer le suivi', icon: 'trash' as const, onSelect: () => setConfirmDelete(true) }] : []),
							]}
						/>
					</header>
				)}
				<nav className='bs-tabs' aria-label='Vues'>
					<div role='tablist' className='bs-tablist'>
						{list.views.map((v) => (
							<span key={v.id} className='bs-tab-wrap'>
								<button type='button' role='tab' aria-selected={v.id === view?.id} className='bs-tab' onClick={() => go({ vue: v.id })} {...(list.canEdit ? tabMenu.bind(() => viewItems(v)) : {})}>
									<Icon name={VIEW_ICON[v.kind]} size={15} />
									<span className='ellipsis'>{v.name}</span>
								</button>
								{list.canEdit && v.id === view?.id && (
									<button
										type='button'
										className='icon-btn icon-btn-sm bs-tab-more'
										aria-label={`Options de la vue ${v.name}`}
										title='Options de la vue'
										onClick={(e) => {
											const r = e.currentTarget.getBoundingClientRect();
											tabMenu.open(r.left, r.bottom + 4, viewItems(v));
										}}
									>
										<Icon name='more' size={14} />
									</button>
								)}
							</span>
						))}
					</div>
					{list.canEdit && (
						<MenuButton label='Vue' icon='plus' className='btn btn-ghost bs-add-view'>
							{(close) => (
								<>
									<p className='lst-menu-title'>Ajouter une vue</p>
									{LIST_VIEW_KINDS.map((k) => (
										<button
											key={k.id}
											type='button'
											role='menuitem'
											className='menu-item'
											onClick={() => {
												close();
												void addView(k.id);
											}}
										>
											<Icon name={VIEW_ICON[k.id]} size={14} /> {k.label}
										</button>
									))}
								</>
							)}
						</MenuButton>
					)}
				</nav>
				<div className='lst-toolbar bs-toolbar'>
					<label className='lst-search'>
						<Icon name='search' size={15} />
						<input value={query} placeholder='Filtrer' aria-label='Filtrer les éléments' onChange={(e) => setQuery(e.target.value)} />
					</label>
					<button type='button' className='bs-chip' aria-pressed={quick.mine} onClick={() => setQuick({ ...quick, mine: !quick.mine })}>
						<Icon name='user' size={14} /> Mes cartes
					</button>
					<button type='button' className='bs-chip' aria-pressed={quick.overdue} onClick={() => setQuick({ ...quick, overdue: !quick.overdue })}>
						<Icon name='clock' size={14} /> En retard
					</button>
					{list.labels.length > 0 && (
						<MenuButton className={`bs-chip${quickLabel ? ' is-on' : ''}`} label={quickLabel ? quickLabel.name : 'Étiquette'}>
							{(close) => (
								<>
									{[{ id: null as string | null, name: 'Toutes', color: 'transparent' }, ...list.labels].map((l) => (
										<button
											key={l.id ?? 'all'}
											type='button'
											role='menuitem'
											className='menu-item'
											onClick={() => {
												setQuick({ ...quick, label: l.id });
												close();
											}}
										>
											<span className='bs-swatch' style={{ background: l.color }} />
											<span className='grow'>{l.name}</span>
											{quick.label === l.id && <Icon name='check' size={14} />}
										</button>
									))}
								</>
							)}
						</MenuButton>
					)}
					<span className='grow' />
					{config.sort && (
						<button type='button' className='btn btn-ghost' onClick={() => setConfig({ sort: null })}>
							<Icon name='close' size={14} /> Tri : {list.columns.find((c) => c.id === config.sort?.id)?.name ?? 'Titre'}
						</button>
					)}
					{view && (
						<MenuButton icon='settings' label={<span className='hide-mobile'>{config.filters.length ? `Vue · ${config.filters.length} filtre${config.filters.length > 1 ? 's' : ''}` : 'Vue'}</span>} className='btn btn-ghost'>
							{(close) => (
								<div className='bs-view-menu'>
									{list.canEdit && (
										<form
											className='lst-menu-form'
											onSubmit={(e) => {
												e.preventDefault();
												const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
												if (name && name !== view.name) {
													void renameView(view, name);
												}
												close();
											}}
										>
											<input name='name' defaultValue={view.name} maxLength={40} aria-label='Nom de la vue' />
											<button type='submit' className='btn'>
												Renommer
											</button>
										</form>
									)}
									{kind === 'table' && (
										<>
											<p className='lst-menu-title'>Regrouper par</p>
											{[{ id: null as string | null, name: 'Sans regroupement' }, ...groupable].map((c) => (
												<button key={c.id ?? 'none'} type='button' role='menuitem' className='menu-item' onClick={() => setConfig({ groupBy: c.id })}>
													<span className='grow'>{c.name}</span>
													{config.groupBy === c.id && <Icon name='check' size={14} />}
												</button>
											))}
											<p className='lst-menu-title'>Colonnes affichées</p>
											{list.columns.map((c) => (
												<label key={c.id} className='menu-item bs-check-row'>
													<input type='checkbox' checked={!config.hidden.includes(c.id)} onChange={() => setConfig({ hidden: config.hidden.includes(c.id) ? config.hidden.filter((h) => h !== c.id) : [...config.hidden, c.id] })} />
													<span className='grow'>{c.name}</span>
												</label>
											))}
										</>
									)}
									{kind === 'board' && statusColumns.length > 1 && (
										<>
											<p className='lst-menu-title'>Colonnes du kanban</p>
											{statusColumns.map((c) => (
												<button key={c.id} type='button' role='menuitem' className='menu-item' onClick={() => setConfig({ boardBy: c.id })}>
													<span className='grow'>{c.name}</span>
													{board?.id === c.id && <Icon name='check' size={14} />}
												</button>
											))}
										</>
									)}
									{kind === 'calendar' && (
										<>
											<p className='lst-menu-title'>Date affichée</p>
											{dateFields.map((f) => (
												<button key={f.id} type='button' role='menuitem' className='menu-item' onClick={() => setConfig({ dateField: f.id })}>
													<span className='grow'>{f.name}</span>
													{config.dateField === f.id && <Icon name='check' size={14} />}
												</button>
											))}
										</>
									)}
									{(kind === 'board' || kind === 'gallery') && (
										<>
											<p className='lst-menu-title'>Face des cartes</p>
											{(
												[
													['cover', 'Bannière'],
													['labels', 'Étiquettes'],
													['members', 'Membres'],
													['dates', 'Dates'],
													['checklist', 'Checklist'],
													['counts', 'Compteurs et estimation'],
												] as const
											).map(([key, label]) => (
												<label key={key} className='menu-item bs-check-row'>
													<input type='checkbox' checked={face[key]} onChange={() => setFace({ [key]: !face[key] })} />
													<span className='grow'>{label}</span>
												</label>
											))}
											{list.columns.length > 0 && <span className='muted k1-face-hint'>Propriétés affichées</span>}
											{list.columns.map((c) => (
												<label key={c.id} className='menu-item bs-check-row'>
													<input type='checkbox' checked={face.props.includes(c.id)} onChange={() => setFace({ props: face.props.includes(c.id) ? face.props.filter((p) => p !== c.id) : [...face.props, c.id].slice(0, 10) })} />
													<span className='grow'>{c.name}</span>
												</label>
											))}
										</>
									)}
									<p className='lst-menu-title'>Filtres enregistrés</p>
									<label className='menu-item bs-check-row'>
										<input type='checkbox' checked={config.filters.some((f) => f.field === 'done')} onChange={() => toggleFilter({ field: 'done', op: 'is', value: 'false' })} />
										<span className='grow'>Masquer les éléments terminés</span>
									</label>
									{filterable.map((c) => (
										<div key={c.id} className='bs-filter-group'>
											<span className='muted'>{c.name}</span>
											{optionsOf(c).map((o) => (
												<label key={o.id} className='menu-item bs-check-row'>
													<input type='checkbox' checked={config.filters.some((f) => f.field === c.id && f.value === o.id)} onChange={() => toggleFilter({ field: c.id, op: 'is', value: o.id })} />
													<span className='bs-swatch' style={{ background: o.color }} />
													<span className='grow'>{o.label}</span>
												</label>
											))}
										</div>
									))}
									{list.labels.length > 0 && (
										<div className='bs-filter-group'>
											<span className='muted'>Étiquettes</span>
											{list.labels.map((l) => (
												<label key={l.id} className='menu-item bs-check-row'>
													<input type='checkbox' checked={config.filters.some((f) => f.field === 'labels' && f.value === l.id)} onChange={() => toggleFilter({ field: 'labels', op: 'is', value: l.id })} />
													<span className='bs-swatch' style={{ background: l.color }} />
													<span className='grow'>{l.name}</span>
												</label>
											))}
										</div>
									)}
									{list.canEdit && list.views.length > 1 && (
										<>
											<div className='menu-sep' />
											<button
												type='button'
												role='menuitem'
												className='menu-item menu-item-danger'
												onClick={() => {
													close();
													void removeView(view);
												}}
											>
												<Icon name='trash' size={14} /> Supprimer la vue
											</button>
										</>
									)}
								</div>
							)}
						</MenuButton>
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
				{kind === 'table' ? (
					<Table
						list={{ ...list, columns: shown }}
						items={items}
						members={members}
						sort={config.sort}
						groupBy={config.groupBy}
						onSort={(sort) => setConfig({ sort })}
						onColumns={(columns) => void patchList({ columns: [...columns, ...list.columns.filter((c) => config.hidden.includes(c.id) && !columns.some((x) => x.id === c.id))] })}
						onPatch={patchItem}
						onAdd={addItem}
						onOpen={(id) => go({ element: id })}
					/>
				) : kind === 'board' ? (
					board ? (
						<Board {...viewProps} column={board} />
					) : (
						<div className='lst-blank'>
							<p>Le kanban range les cartes par statut.</p>
							{list.canEdit && (
								<button type='button' className='btn' onClick={() => void patchList({ columns: [...list.columns, { id: newId(), name: 'Statut', type: 'status', options: defaultOptions() }] })}>
									Ajouter une colonne Statut
								</button>
							)}
						</div>
					)
				) : kind === 'calendar' ? (
					<CalendarView {...viewProps} field={config.dateField} />
				) : kind === 'gallery' ? (
					<GalleryView {...viewProps} />
				) : (
					<TimelineView {...viewProps} />
				)}
			</div>
			{current && (
				<ItemPanel
					base={base}
					workspaceId={workspaceId}
					list={list}
					item={current}
					members={members}
					myId={myId}
					version={version}
					full={full}
					onPatch={patchItem}
					onLabels={(labels) => patchList({ labels })}
					onDelete={deleteItem}
					onFull={() => go({ element: current.id, plein: !full })}
					onClose={() => go({ element: null })}
					focus={focus}
					onColumns={(columns) => patchList({ columns })}
					onFocused={() => setFocus(null)}
					onReload={load}
					onOpen={(id) => go({ element: id })}
				/>
			)}
			{archiveOpen && <ArchiveDialog base={base} list={list} onClose={() => setArchiveOpen(false)} onRestored={load} />}
			{rulesOpen && <Automations base={base} list={list} members={members} onClose={() => setRulesOpen(false)} />}
			<Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title='Supprimer le suivi'>
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
			{tabMenu.menu}
			{renaming && (
				<Dialog open onClose={() => setRenaming(null)} title='Renommer la vue'>
					<form
						className='stack'
						onSubmit={(e) => {
							e.preventDefault();
							const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
							if (name && name !== renaming.name) {
								void renameView(renaming, name);
							}
							setRenaming(null);
						}}
					>
						<input name='name' defaultValue={renaming.name} maxLength={40} aria-label='Nom de la vue' autoFocus />
						<div className='row' style={{ justifyContent: 'flex-end', gap: 8 }}>
							<button type='button' className='btn' onClick={() => setRenaming(null)}>
								Annuler
							</button>
							<button type='submit' className='btn btn-primary'>
								Renommer
							</button>
						</div>
					</form>
				</Dialog>
			)}
		</div>
	);
}
