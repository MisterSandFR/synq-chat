import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import { coverFill, defaultCardFace, dueState, fileCover, isoDay, type CardFace, type ListColumn, type ListDetail, type ListItem, type ListValue, type ViewConfig, type ViewFilter } from '../../../shared/lists';
import type { Member } from '../../../shared/types';
import { Avatar, Icon } from '../../ui';
import { optionsOf, Pill } from './cells';
import { between, MenuButton, type Patch } from './table';
import './cards.css';

export type Quick = { mine: boolean; overdue: boolean; label: string | null };

// Section du détail à ouvrir directement (raccourcis D, L, C).
export type CardFocus = 'dates' | 'labels' | 'checklist';

export type ViewProps = {
	workspaceId: string;
	list: ListDetail;
	items: ListItem[];
	members: Map<string, Member>;
	myId: string;
	face: CardFace;
	onPatch: (item: ListItem, patch: Patch) => void;
	onAdd: (values?: Record<string, ListValue>, title?: string, extra?: Patch) => Promise<ListItem | null>;
	onOpen: (id: string, focus?: CardFocus) => void;
	onFromTemplate: (template: ListItem, values: Record<string, ListValue>) => void;
};

const shortDay = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const monthName = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
export const dayLabel = (value: string) => shortDay.format(new Date(`${value}T12:00:00`));

export const addDays = (day: string, n: number) => {
	const date = new Date(`${day}T12:00:00`);
	date.setDate(date.getDate() + n);
	return isoDay(date);
};
const diffDays = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000);
export const todayIso = () => isoDay(new Date());

export const coverUrl = (workspaceId: string, listId: string, cover: string | null) => {
	const fid = fileCover(cover);
	return fid ? `/api/w/${workspaceId}/lists/${listId}/files/${fid}` : null;
};

export function dateOf(item: ListItem, field: string): string | null {
	if (field === 'start') {
		return item.startDate;
	}
	if (field === 'due') {
		return item.dueDate;
	}
	const value = item.values[field];
	return typeof value === 'string' ? value : null;
}

// Déplace la date choisie ; un début postérieur à l'échéance suit.
export function datePatch(item: ListItem, field: string, day: string): Patch {
	if (field === 'due') {
		return item.startDate && item.startDate > day ? { dueDate: day, startDate: day } : { dueDate: day };
	}
	if (field === 'start') {
		return item.dueDate && item.dueDate < day ? { startDate: day, dueDate: day } : { startDate: day };
	}
	return { values: { [field]: day } };
}

export const people = (list: ListDetail, item: ListItem) => [...new Set([...item.members, ...list.columns.filter((c) => c.type === 'person' && typeof item.values[c.id] === 'string').map((c) => item.values[c.id] as string)])];

function filterHit(item: ListItem, f: ViewFilter): boolean {
	if (f.field === 'labels') {
		return f.op === 'empty' ? item.labels.length === 0 : f.op === 'filled' ? item.labels.length > 0 : item.labels.includes(f.value ?? '') === (f.op === 'is');
	}
	if (f.field === 'done') {
		return item.done === (f.value === 'true');
	}
	const value = f.field === 'due' ? item.dueDate : item.values[f.field];
	if (f.op === 'empty' || f.op === 'filled') {
		return (value === undefined || value === null) === (f.op === 'empty');
	}
	return (String(value ?? '') === f.value) === (f.op === 'is');
}

function textOf(list: ListDetail, item: ListItem, members: Map<string, Member>) {
	return [
		item.title,
		...item.labels.map((id) => list.labels.find((l) => l.id === id)?.name ?? ''),
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
}

// Filtres « est » sur un même champ en OU, champs différents en ET.
export function visibleItems(list: ListDetail, config: ViewConfig, quick: Quick, query: string, members: Map<string, Member>, myId: string): ListItem[] {
	const today = todayIso();
	const byField = new Map<string, ViewFilter[]>();
	for (const f of config.filters) {
		byField.set(f.field, [...(byField.get(f.field) ?? []), f]);
	}
	const needle = query.trim().toLowerCase();
	let items = list.items.filter(
		(item) =>
			[...byField.values()].every((group) => (group.every((f) => f.op === 'is') ? group.some((f) => filterHit(item, f)) : group.every((f) => filterHit(item, f)))) &&
			(!quick.mine || people(list, item).includes(myId)) &&
			(!quick.overdue || dueState(item, today, addDays(today, 1)) === 'overdue') &&
			(!quick.label || item.labels.includes(quick.label)) &&
			(!needle || textOf(list, item, members).includes(needle)),
	);
	const sort = config.sort;
	if (sort) {
		const column = list.columns.find((c) => c.id === sort.id);
		const key = (item: ListItem): string | number | null => {
			if (sort.id === 'due') {
				return item.dueDate;
			}
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
			return ka === kb ? 0 : ka === null ? 1 : kb === null ? -1 : (ka < kb ? -1 : 1) * sort.dir;
		});
	}
	return items;
}

const DUE_TEXT = { done: 'Terminé', overdue: 'En retard', today: 'Aujourd’hui', soon: 'Demain', later: '' } as const;

export function DuePill({ item }: { item: ListItem }) {
	const today = todayIso();
	const state = dueState(item, today, addDays(today, 1));
	if (!state || !item.dueDate) {
		return null;
	}
	return (
		<span className={`bs-due is-${state}`} title={DUE_TEXT[state] || 'Échéance'}>
			<Icon name={state === 'done' ? 'check' : 'clock'} size={12} />
			{item.startDate && item.startDate !== item.dueDate ? `${dayLabel(item.startDate)} – ${dayLabel(item.dueDate)}` : dayLabel(item.dueDate)}
			{item.dueTime && ` ${item.dueTime.replace(':', ' h ')}`}
			{item.reminder && <Icon name='bell' size={11} />}
		</span>
	);
}

export function Cover({ workspaceId, item, tall }: { workspaceId: string; item: ListItem; tall?: boolean }) {
	const url = coverUrl(workspaceId, item.listId, item.cover);
	if (url) {
		return <img className={`bs-cover-img${tall ? ' is-tall' : ''}`} src={url} alt='' loading='lazy' style={{ objectPosition: `50% ${item.coverY}%` }} />;
	}
	const fill = coverFill(item.cover);
	return fill ? <span className={`bs-cover${tall ? ' is-tall' : ''}`} style={{ background: fill }} /> : null;
}

function PropChip({ column, value, members }: { column: ListColumn; value: ListValue | undefined; members: Map<string, Member> }) {
	if (value === undefined || value === '') {
		return null;
	}
	if (column.type === 'status' || column.type === 'priority') {
		const option = optionsOf(column).find((o) => o.id === value);
		return option ? <Pill option={option} /> : null;
	}
	const text = column.type === 'person' ? (members.get(value as string)?.name ?? '') : column.type === 'checkbox' ? (value ? 'Oui' : 'Non') : column.type === 'date' ? dayLabel(value as string) : String(value);
	return (
		<span className='k1-prop' title={column.name}>
			<span className='muted'>{column.name}</span> {text}
		</span>
	);
}

export function LabelChips({ list, item }: { list: ListDetail; item: ListItem }) {
	const labels = item.labels.map((id) => list.labels.find((l) => l.id === id)).filter((l) => l !== undefined);
	return labels.length ? (
		<span className='bs-labels'>
			{labels.map((l) => (
				<span key={l.id} className='bs-label' style={{ '--label': l.color } as CSSProperties} title={l.name}>
					{l.name}
				</span>
			))}
		</span>
	) : null;
}

export function Card({ workspaceId, list, item, members, tall, face = defaultCardFace() }: { workspaceId: string; list: ListDetail; item: ListItem; members: Map<string, Member>; tall?: boolean; face?: CardFace }) {
	const priority = list.columns.find((c) => c.type === 'priority');
	const prio = priority && !face.props.includes(priority.id) ? optionsOf(priority).find((o) => o.id === item.values[priority.id]) : undefined;
	const who = face.members ? people(list, item) : [];
	const complete = item.checks.total > 0 && item.checks.done === item.checks.total;
	const title = (
		<span className={`bs-card-title${item.done ? ' is-done' : ''}`}>
			{item.icon && <span className='k1-card-icon'>{item.icon}</span>}
			{item.title || <span className='muted'>Sans titre</span>}
		</span>
	);
	// Bannière pleine carte façon Trello : le titre se pose sur l'image.
	if (face.cover && item.cover && item.coverMode === 'full') {
		const url = coverUrl(workspaceId, item.listId, item.cover);
		return (
			<span className={`k1-full${url ? ' has-image' : ''}${tall ? ' is-tall' : ''}`} style={{ background: url ? undefined : (coverFill(item.cover) ?? undefined) }}>
				{url && <img src={url} alt='' loading='lazy' style={{ objectPosition: `50% ${item.coverY}%` }} />}
				<span className='k1-full-body'>
					{face.labels && <LabelChips list={list} item={item} />}
					{title}
					{item.template && <span className='k1-template-tag'>Modèle</span>}
				</span>
			</span>
		);
	}
	return (
		<>
			{face.cover && <Cover workspaceId={workspaceId} item={item} tall={tall} />}
			<span className='bs-card-body'>
				{face.labels && <LabelChips list={list} item={item} />}
				{title}
				{face.props.length > 0 && (
					<span className='k1-props'>
						{face.props.map((id) => {
							const column = list.columns.find((c) => c.id === id);
							return column ? <PropChip key={id} column={column} value={item.values[id]} members={members} /> : null;
						})}
					</span>
				)}
				<span className='bs-badges'>
					{item.template && <span className='k1-template-tag'>Modèle</span>}
					{face.dates && <DuePill item={item} />}
					{prio && <Pill option={prio} />}
					{face.counts && item.estimate !== null && (
						<span className='bs-badge' title='Estimation'>
							{item.estimate} {item.estimateUnit === 'h' ? 'h' : 'pts'}
						</span>
					)}
					{face.checklist && item.checks.total > 0 && (
						<span className={`bs-badge${complete ? ' is-complete' : ''}`} title='Checklist'>
							<Icon name='check' size={12} /> {item.checks.done}/{item.checks.total}
						</span>
					)}
					{face.counts && item.comments > 0 && (
						<span className='bs-badge' title='Commentaires'>
							<Icon name='chat' size={12} /> {item.comments}
						</span>
					)}
					{face.counts && item.attachments > 0 && (
						<span className='bs-badge' title='Pièces jointes'>
							<Icon name='paperclip' size={12} /> {item.attachments}
						</span>
					)}
					{face.counts && item.pageId && (
						<span className='bs-badge' title='Document'>
							<Icon name='file' size={12} />
						</span>
					)}
					<span className='grow' />
					<span className='bs-avatars'>
						{who.slice(0, 3).map((id) => (
							<Avatar key={id} name={members.get(id)?.name ?? '?'} url={members.get(id)?.avatarUrl} size={22} />
						))}
					</span>
				</span>
			</span>
		</>
	);
}

function QuickAdd({ label, onAdd }: { label: string; onAdd: (title: string) => void }) {
	const [open, setOpen] = useState(false);
	const [title, setTitle] = useState('');
	if (!open) {
		return (
			<button type='button' className='lst-add' onClick={() => setOpen(true)}>
				<Icon name='plus' size={14} /> {label}
			</button>
		);
	}
	const submit = () => {
		if (title.trim()) {
			onAdd(title.trim());
			setTitle('');
		}
	};
	return (
		<div className='bs-quick-add'>
			<textarea
				autoFocus
				rows={2}
				value={title}
				placeholder='Titre de la carte'
				aria-label='Titre de la carte'
				onChange={(e) => setTitle(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault();
						submit();
					} else if (e.key === 'Escape') {
						setOpen(false);
					}
				}}
			/>
			<span className='bs-quick-actions'>
				<button type='button' className='btn btn-primary' onClick={submit}>
					Ajouter la carte
				</button>
				<button type='button' className='icon-btn icon-btn-sm' aria-label='Annuler' onClick={() => setOpen(false)}>
					<Icon name='close' size={14} />
				</button>
			</span>
		</div>
	);
}

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

// Raccourcis Trello sur la carte survolée ou ciblée : Entrée, Espace, D, L, C.
function useCardKeys(list: ListDetail, myId: string, onPatch: ViewProps['onPatch'], onOpen: ViewProps['onOpen']) {
	const hovered = useRef<string | null>(null);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('.k1-panel, .popover, dialog[open]')) {
				return;
			}
			const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>('[data-card]')?.dataset.card : undefined;
			const item = list.items.find((i) => i.id === (focused ?? hovered.current));
			if (!item) {
				return;
			}
			const key = e.key.toLowerCase();
			if (key === 'enter') {
				onOpen(item.id);
			} else if (key === ' ' && list.canEdit) {
				onPatch(item, { members: item.members.includes(myId) ? item.members.filter((m) => m !== myId) : [...item.members, myId] });
			} else if (key === 'd' || key === 'l' || key === 'c') {
				onOpen(item.id, key === 'd' ? 'dates' : key === 'l' ? 'labels' : 'checklist');
			} else {
				return;
			}
			e.preventDefault();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [list, myId]);
	return { onMouseEnter: (id: string) => (hovered.current = id), onMouseLeave: () => (hovered.current = null) };
}

export function Board({ workspaceId, list, column, items, members, myId, face, onPatch, onAdd, onOpen, onFromTemplate }: ViewProps & { column: ListColumn }) {
	const [drag, setDrag] = useState<string | null>(null);
	const [over, setOver] = useState<string | null>(null);
	const editable = list.canEdit;
	const keys = useCardKeys(list, myId, onPatch, onOpen);
	const templates = list.items.filter((i) => i.template);
	const options = optionsOf(column);
	const lanes = [...options.map((o) => ({ key: o.id, option: o })), { key: '', option: null }];

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
		<div className='lst-board bs-board'>
			{lanes.map(({ key, option }) => {
				const laneItems = items.filter((i) => (option ? i.values[column.id] === key : !options.some((o) => o.id === i.values[column.id])));
				if (!option && laneItems.length === 0 && !drag) {
					return null;
				}
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
							{laneItems.map((item) => (
								<article
									key={item.id}
									className={`bs-card${drag === item.id ? ' is-dragging' : ''}${face.cover && item.cover && item.coverMode === 'full' ? ' is-full' : ''}`}
									draggable={editable}
									tabIndex={0}
									data-card={item.id}
									onMouseEnter={() => keys.onMouseEnter(item.id)}
									onMouseLeave={keys.onMouseLeave}
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
								>
									<Card workspaceId={workspaceId} list={list} item={item} members={members} face={face} />
								</article>
							))}
						</div>
						{editable && (
							<div className='k1-lane-foot'>
								<QuickAdd label='Ajouter une carte' onAdd={(title) => void onAdd(key ? { [column.id]: key } : {}, title)} />
								{templates.length > 0 && (
									<MenuButton label={<Icon name='copy' size={14} />} className='icon-btn icon-btn-sm k1-from-template'>
										{(close) => (
											<>
												<p className='lst-menu-title'>Créer depuis un modèle</p>
												{templates.map((t) => (
													<button
														key={t.id}
														type='button'
														role='menuitem'
														className='menu-item'
														onClick={() => {
															close();
															onFromTemplate(t, key ? { [column.id]: key } : {});
														}}
													>
														{t.icon && <span>{t.icon}</span>}
														<span className='ellipsis'>{t.title || 'Sans titre'}</span>
													</button>
												))}
											</>
										)}
									</MenuButton>
								)}
							</div>
						)}
					</section>
				);
			})}
		</div>
	);
}

const WEEKDAYS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

export function CalendarView({ list, items, field, onPatch, onAdd, onOpen }: ViewProps & { field: string }) {
	const [month, setMonth] = useState(() => todayIso().slice(0, 7));
	const [drag, setDrag] = useState<string | null>(null);
	const [over, setOver] = useState<string | null>(null);
	const first = `${month}-01`;
	const offset = (new Date(`${first}T12:00:00`).getDay() + 6) % 7;
	const start = addDays(first, -offset);
	const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
	const today = todayIso();
	const undated = items.filter((i) => !dateOf(i, field)).length;
	const shift = (n: number) => {
		const date = new Date(`${first}T12:00:00`);
		date.setMonth(date.getMonth() + n);
		setMonth(isoDay(date).slice(0, 7));
	};
	return (
		<div className='bs-cal'>
			<div className='bs-cal-head'>
				<button type='button' className='icon-btn' aria-label='Mois précédent' onClick={() => shift(-1)}>
					<Icon name='chevron-left' />
				</button>
				<strong className='bs-cal-month'>{monthName.format(new Date(`${first}T12:00:00`))}</strong>
				<button type='button' className='icon-btn' aria-label='Mois suivant' onClick={() => shift(1)}>
					<Icon name='chevron-right' />
				</button>
				<button type='button' className='btn btn-ghost' onClick={() => setMonth(today.slice(0, 7))}>
					Aujourd’hui
				</button>
				<span className='grow' />
				{undated > 0 && (
					<span className='muted'>
						{undated} élément{undated > 1 ? 's' : ''} sans date
					</span>
				)}
			</div>
			<div className='bs-cal-grid' role='grid'>
				{WEEKDAYS.map((d) => (
					<span key={d} className='bs-cal-wd' role='columnheader'>
						{d}
					</span>
				))}
				{days.map((day) => {
					const dayItems = items.filter((i) => dateOf(i, field) === day);
					return (
						<div
							key={day}
							role='gridcell'
							className={`bs-cal-day${day.slice(0, 7) !== month ? ' is-out' : ''}${day === today ? ' is-today' : ''}${over === day ? ' is-over' : ''}`}
							onDragOver={(e) => {
								if (drag) {
									e.preventDefault();
									setOver(day);
								}
							}}
							onDrop={(e) => {
								e.preventDefault();
								const moved = list.items.find((i) => i.id === drag);
								setDrag(null);
								setOver(null);
								if (moved && dateOf(moved, field) !== day) {
									onPatch(moved, datePatch(moved, field, day));
								}
							}}
						>
							<span className='bs-cal-num'>
								{Number(day.slice(8))}
								{list.canEdit && (
									<button type='button' className='bs-cal-add' aria-label={`Ajouter le ${dayLabel(day)}`} onClick={() => void onAdd({}, '', datePatch({ startDate: null, dueDate: null } as ListItem, field, day)).then((c) => c && onOpen(c.id))}>
										<Icon name='plus' size={12} />
									</button>
								)}
							</span>
							{dayItems.map((item) => (
								<button
									key={item.id}
									type='button'
									draggable={list.canEdit}
									className={`bs-cal-item${item.done ? ' is-done' : ''}`}
									style={{ '--label': list.labels.find((l) => l.id === item.labels[0])?.color ?? 'var(--accent)' } as CSSProperties}
									onDragStart={(e) => {
										e.dataTransfer.effectAllowed = 'move';
										e.dataTransfer.setData('text/plain', item.id);
										setDrag(item.id);
									}}
									onDragEnd={() => setDrag(null)}
									onClick={() => onOpen(item.id)}
								>
									{item.done && <Icon name='check' size={11} />}
									<span className='ellipsis'>{item.title || 'Sans titre'}</span>
								</button>
							))}
						</div>
					);
				})}
			</div>
		</div>
	);
}

export function GalleryView({ workspaceId, list, items, members, myId, face, onPatch, onAdd, onOpen }: ViewProps) {
	const keys = useCardKeys(list, myId, onPatch, onOpen);
	return (
		<div className='bs-gallery'>
			{items.map((item) => (
				<button
					key={item.id}
					type='button'
					className={`bs-card bs-gallery-card${face.cover && item.cover && item.coverMode === 'full' ? ' is-full' : ''}`}
					data-card={item.id}
					onMouseEnter={() => keys.onMouseEnter(item.id)}
					onMouseLeave={keys.onMouseLeave}
					onClick={() => onOpen(item.id)}
				>
					<Card workspaceId={workspaceId} list={list} item={item} members={members} face={face} tall />
				</button>
			))}
			{list.canEdit && (
				<button type='button' className='bs-gallery-new' onClick={() => void onAdd({}, '').then((c) => c && onOpen(c.id))}>
					<Icon name='plus' size={16} /> Nouvel élément
				</button>
			)}
		</div>
	);
}

const DAY_W = 34;

export function TimelineView({ list, items, onPatch, onOpen }: ViewProps) {
	const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'end'; dx: number } | null>(null);
	const today = todayIso();
	const dated = items.filter((i) => i.startDate || i.dueDate);
	const undated = items.filter((i) => !i.startDate && !i.dueDate);
	const starts = dated.map((i) => (i.startDate ?? i.dueDate)!);
	const ends = dated.map((i) => (i.dueDate ?? i.startDate)!);
	const from = addDays([today, ...starts].sort()[0]!, -3);
	const to = addDays([addDays(today, 28), ...ends].sort().at(-1)!, 7);
	const days = Array.from({ length: diffDays(from, to) + 1 }, (_, i) => addDays(from, i));

	const begin = (item: ListItem, mode: 'move' | 'end') => (event: ReactPointerEvent) => {
		if (!list.canEdit) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const x0 = event.clientX;
		let dx = 0;
		const move = (e: PointerEvent) => {
			dx = Math.round((e.clientX - x0) / DAY_W);
			setDrag({ id: item.id, mode, dx });
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			setDrag(null);
			const s = item.startDate ?? item.dueDate!;
			const e = item.dueDate ?? item.startDate!;
			if (dx === 0) {
				onOpen(item.id);
			} else if (mode === 'move') {
				onPatch(item, { startDate: addDays(s, dx), dueDate: addDays(e, dx) });
			} else {
				const end = addDays(e, dx);
				onPatch(item, end < s ? { startDate: end, dueDate: end } : { startDate: s, dueDate: end });
			}
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	};

	return (
		<div className='bs-tl'>
			<div className='bs-tl-scroll'>
				<div className='bs-tl-inner' style={{ width: 220 + days.length * DAY_W }}>
					<div className='bs-tl-row bs-tl-head'>
						<span className='bs-tl-name' />
						{days.map((d) => (
							<span key={d} className={`bs-tl-day${d === today ? ' is-today' : ''}${[0, 6].includes(new Date(`${d}T12:00:00`).getDay()) ? ' is-weekend' : ''}`} style={{ width: DAY_W }}>
								{d.endsWith('-01') || d === from ? <em>{shortDay.format(new Date(`${d}T12:00:00`)).split(' ')[1]}</em> : null}
								{Number(d.slice(8))}
							</span>
						))}
					</div>
					{dated.map((item) => {
						const s = item.startDate ?? item.dueDate!;
						const e = item.dueDate ?? item.startDate!;
						const live = drag?.id === item.id ? drag : null;
						const left = (diffDays(from, s) + (live?.mode === 'move' ? live.dx : 0)) * DAY_W;
						const width = Math.max(1, diffDays(s, e) + 1 + (live?.mode === 'end' ? live.dx : 0)) * DAY_W;
						const color = list.labels.find((l) => l.id === item.labels[0])?.color ?? 'var(--accent)';
						return (
							<div key={item.id} className='bs-tl-row'>
								<button type='button' className='bs-tl-name ellipsis' onClick={() => onOpen(item.id)}>
									{item.title || 'Sans titre'}
								</button>
								<div className='bs-tl-track' style={{ width: days.length * DAY_W, '--today': `${diffDays(from, today) * DAY_W}px` } as CSSProperties}>
									<span className={`bs-tl-bar${item.done ? ' is-done' : ''}${live ? ' is-dragging' : ''}`} style={{ left, width, '--label': color } as CSSProperties} onPointerDown={begin(item, 'move')} title={`${dayLabel(s)} – ${dayLabel(e)}`}>
										<span className='ellipsis'>{item.title || 'Sans titre'}</span>
										{list.canEdit && <span className='bs-tl-grip' aria-label='Changer l’échéance' onPointerDown={begin(item, 'end')} />}
									</span>
								</div>
							</div>
						);
					})}
				</div>
			</div>
			{undated.length > 0 && (
				<div className='bs-tl-undated'>
					<p className='muted'>Sans dates</p>
					{undated.map((item) => (
						<span key={item.id} className='bs-tl-chip'>
							<button type='button' className='bs-link' onClick={() => onOpen(item.id)}>
								{item.title || 'Sans titre'}
							</button>
							{list.canEdit && (
								<button type='button' className='btn btn-ghost' onClick={() => onPatch(item, { startDate: today, dueDate: addDays(today, 2) })}>
									Planifier
								</button>
							)}
						</span>
					))}
				</div>
			)}
		</div>
	);
}
