import { useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import { LIST_COLUMN_TYPES, STATUS_COLORS, type ListColumn, type ListColumnType, type ListDetail, type ListItem, type ListValue } from '../../../shared/lists';
import type { Member } from '../../../shared/types';
import { Floating } from '../../floating';
import { Avatar, Icon, useDismiss, type IconName } from '../../ui';
import { Cell, optionsOf, Pill, TYPE_ICON } from './cells';

export type Patch = {
	title?: string;
	description?: string;
	values?: Record<string, ListValue | null>;
	position?: number;
	labels?: string[];
	cover?: string | null;
	startDate?: string | null;
	dueDate?: string | null;
	done?: boolean;
};

export const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export type Sort = { id: string; dir: 1 | -1 } | null;

export function MenuButton({ label, icon, className = 'btn', children }: { label: ReactNode; icon?: IconName; className?: string; children: (close: () => void) => ReactNode }) {
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

export const defaultOptions = () => ['À faire', 'En cours', 'Terminé'].map((label, i) => ({ id: newId() + i, label, color: STATUS_COLORS[[0, 1, 4][i]!]! }));

// Position entre deux voisins ; ordre conservé sans renuméroter.
export const between = (before: ListItem | undefined, after: ListItem | undefined) =>
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
	onAdd: (values?: Record<string, ListValue>, title?: string) => Promise<ListItem | null>;
	onOpen: (id: string) => void;
};

export function Table({ list, items, members, sort, groupBy, onSort, onColumns, onPatch, onAdd, onOpen }: TableProps) {
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
