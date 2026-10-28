import { useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { PRIORITIES, type ListColumn, type ListColumnType, type ListItem, type ListOption, type ListValue } from '../../../shared/lists';
import type { Member } from '../../../shared/types';
import { Floating } from '../../floating';
import { Avatar, Icon, useDismiss, type IconName } from '../../ui';

export const TYPE_ICON: Record<ListColumnType, IconName> = {
	text: 'quote',
	status: 'list',
	person: 'user',
	date: 'calendar',
	checkbox: 'check',
	number: 'list-ordered',
	link: 'link',
	priority: 'up',
};

export const optionsOf = (column: ListColumn): readonly ListOption[] => (column.type === 'priority' ? PRIORITIES : (column.options ?? []));

const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
export const formatDate = (value: string) => day.format(new Date(`${value}T12:00:00`));

export function Pill({ option }: { option: ListOption }) {
	return (
		<span className='lst-pill' style={{ '--pill': option.color } as CSSProperties}>
			{option.label}
		</span>
	);
}

// Cellule à menu : statut, priorité, personne.
function PopCell({ editable, label, display, menu }: { editable: boolean; label: string; display: ReactNode; menu: (close: () => void) => ReactNode }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	return (
		<div ref={ref} className='lst-pop'>
			<button type='button' className='lst-cell-btn' disabled={!editable} aria-label={label} aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				{display}
			</button>
			{open && (
				<Floating anchor={ref} placement='bottom-start' className='popover lst-menu' role='menu'>
					{menu(() => setOpen(false))}
				</Floating>
			)}
		</div>
	);
}

function PersonMenu({ members, value, onPick }: { members: Member[]; value: string | null; onPick: (id: string | null) => void }) {
	const [query, setQuery] = useState('');
	const hits = members.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()));
	return (
		<>
			<input className='lst-menu-search' autoFocus placeholder='Rechercher une personne' value={query} onChange={(e) => setQuery(e.target.value)} />
			<div className='lst-menu-scroll'>
				{hits.map((m) => (
					<button key={m.id} type='button' role='menuitem' className='menu-item' onClick={() => onPick(m.id)}>
						<Avatar name={m.name} url={m.avatarUrl} size={22} />
						<span className='grow ellipsis'>{m.name}</span>
						{m.id === value && <Icon name='check' size={14} />}
					</button>
				))}
				{hits.length === 0 && <p className='lst-menu-empty'>Personne ne correspond.</p>}
			</div>
			{value && (
				<>
					<div className='menu-sep' />
					<button type='button' role='menuitem' className='menu-item' onClick={() => onPick(null)}>
						<Icon name='close' size={14} /> Retirer
					</button>
				</>
			)}
		</>
	);
}

function TextCell({ column, value, editable, onChange }: { column: ListColumn; value: ListValue | undefined; editable: boolean; onChange: (value: ListValue | null) => void }) {
	const [draft, setDraft] = useState<string | null>(null);
	const shown = value === undefined ? '' : String(value);
	const commit = () => {
		if (draft === null) {
			return;
		}
		const text = draft.trim();
		setDraft(null);
		if (text === shown) {
			return;
		}
		if (column.type === 'number') {
			const n = Number(text.replace(',', '.'));
			if (text && !Number.isFinite(n)) {
				return;
			}
			onChange(text ? n : null);
		} else {
			onChange(text || null);
		}
	};
	if (draft !== null) {
		return (
			<input
				className='lst-input'
				autoFocus
				inputMode={column.type === 'number' ? 'decimal' : undefined}
				type={column.type === 'link' ? 'url' : 'text'}
				value={draft}
				aria-label={column.name}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						commit();
					} else if (e.key === 'Escape') {
						setDraft(null);
					}
				}}
			/>
		);
	}
	return (
		<button type='button' className={`lst-cell-btn${column.type === 'number' ? ' lst-num' : ''}`} disabled={!editable} aria-label={`${column.name} : ${shown || 'vide'}`} onClick={() => setDraft(shown)}>
			{column.type === 'link' && shown ? (
				<a href={shown} target='_blank' rel='noreferrer noopener' className='lst-link ellipsis' onClick={(e) => e.stopPropagation()}>
					{shown.replace(/^https?:\/\//, '')}
				</a>
			) : (
				<span className='ellipsis'>{shown}</span>
			)}
		</button>
	);
}

export function Cell({ column, item, members, editable, onChange }: { column: ListColumn; item: ListItem; members: Map<string, Member>; editable: boolean; onChange: (value: ListValue | null) => void }) {
	const value = item.values[column.id];
	switch (column.type) {
		case 'checkbox':
			return <input type='checkbox' className='lst-check' checked={value === true} disabled={!editable} aria-label={column.name} onChange={(e) => onChange(e.target.checked || null)} />;
		case 'date':
			return <input type='date' className='lst-input lst-date' value={typeof value === 'string' ? value : ''} disabled={!editable} aria-label={column.name} onChange={(e) => onChange(e.target.value || null)} />;
		case 'status':
		case 'priority': {
			const options = optionsOf(column);
			const current = options.find((o) => o.id === value);
			return (
				<PopCell
					editable={editable}
					label={`${column.name} : ${current?.label ?? 'vide'}`}
					display={current ? <Pill option={current} /> : <span className='lst-empty' />}
					menu={(close) => (
						<>
							{options.map((o) => (
								<button
									key={o.id}
									type='button'
									role='menuitem'
									className='menu-item'
									onClick={() => {
										close();
										onChange(o.id);
									}}
								>
									<Pill option={o} />
									<span className='grow' />
									{o.id === value && <Icon name='check' size={14} />}
								</button>
							))}
							{options.length === 0 && <p className='lst-menu-empty'>Aucune option. Ajoute-en depuis l’en-tête de colonne.</p>}
							{current && (
								<>
									<div className='menu-sep' />
									<button
										type='button'
										role='menuitem'
										className='menu-item'
										onClick={() => {
											close();
											onChange(null);
										}}
									>
										<Icon name='close' size={14} /> Effacer
									</button>
								</>
							)}
						</>
					)}
				/>
			);
		}
		case 'person': {
			const person = typeof value === 'string' ? members.get(value) : undefined;
			return (
				<PopCell
					editable={editable}
					label={`${column.name} : ${person?.name ?? 'personne'}`}
					display={
						person ? (
							<span className='lst-person'>
								<Avatar name={person.name} url={person.avatarUrl} size={20} />
								<span className='ellipsis'>{person.name}</span>
							</span>
						) : (
							<span className='lst-empty' />
						)
					}
					menu={(close) => (
						<PersonMenu
							members={[...members.values()].filter((m) => !m.guest)}
							value={person?.id ?? null}
							onPick={(id) => {
								close();
								onChange(id);
							}}
						/>
					)}
				/>
			);
		}
		default:
			return <TextCell key={String(value ?? '')} column={column} value={value} editable={editable} onChange={onChange} />;
	}
}
