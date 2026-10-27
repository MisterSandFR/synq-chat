import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { CalendarListing } from '../../shared/calendar';
import type { Me, WorkspaceSummary } from '../../shared/types';
import { api, errorText } from '../api';
import { readPref, writePref } from '../router';
import { Icon } from '../ui';
import { addDays, dayKey, fmtDay, fmtMonth, fmtShort, fmtTime, groupByDay, HOUR, sameDay, startOfDay, startOfWeek, WEEKDAYS, type Placed } from './dates';
import { EventDialog } from './EventDialog';
import { SyncDialog } from './SyncDialog';
import './calendar.css';

type View = 'month' | 'week' | 'agenda';

const VIEWS: Array<{ id: View; label: string }> = [
	{ id: 'month', label: 'Mois' },
	{ id: 'week', label: 'Semaine' },
	{ id: 'agenda', label: 'Agenda' },
];
const AGENDA_DAYS = 60;
const PERSONAL = 'personnel';
// Hauteur d'une heure dans la vue semaine, en pixels.
const SLOT = 48;

function readHidden(): Set<string> {
	try {
		return new Set(JSON.parse(readPref('calendar_hidden') ?? '[]') as string[]);
	} catch {
		return new Set();
	}
}

function rangeOf(view: View, cursor: Date): [Date, Date] {
	if (view === 'month') {
		const first = startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
		return [first, addDays(first, 42)];
	}
	if (view === 'week') {
		const first = startOfWeek(cursor);
		return [first, addDays(first, 7)];
	}
	const first = startOfDay(cursor);
	return [first, addDays(first, AGENDA_DAYS)];
}

type Opened = { eventId: string; startsAt: number } | { draft: number };

export function CalendarView({ me, workspaces }: { me: Me; workspaces: WorkspaceSummary[] }) {
	const [view, setView] = useState<View>(() => VIEWS.find((v) => v.id === readPref('calendar_view'))?.id ?? 'month');
	const [cursor, setCursor] = useState(() => startOfDay(new Date()));
	const [hidden, setHidden] = useState(readHidden);
	const [listing, setListing] = useState<CalendarListing | null>(null);
	const [error, setError] = useState('');
	const [opened, setOpened] = useState<Opened | null>(null);
	const [sync, setSync] = useState(false);
	const [from, to] = useMemo(() => rangeOf(view, cursor), [view, cursor]);
	const request = useRef(0);

	const load = useCallback(async () => {
		const id = ++request.current;
		try {
			const next = await api<CalendarListing>('GET', `/calendar/events?from=${from.getTime()}&to=${to.getTime()}`);
			// Navigation rapide : seule la dernière réponse compte.
			if (id === request.current) {
				setListing(next);
				setError('');
			}
		} catch (e) {
			if (id === request.current) {
				setError(errorText(e));
			}
		}
	}, [from, to]);

	useEffect(() => {
		void load();
	}, [load]);

	const accents = useMemo(() => new Map(workspaces.map((w) => [w.id, w])), [workspaces]);

	const placed = useMemo<Placed[]>(() => {
		if (!listing) {
			return [];
		}
		const byId = new Map(listing.events.map((e) => [e.id, e]));
		return listing.occurrences.flatMap((o) => {
			const event = byId.get(o.eventId);
			if (!event || hidden.has(event.workspaceId ?? PERSONAL)) {
				return [];
			}
			return [{ ...o, event, color: event.color || (event.workspaceId ? accents.get(event.workspaceId)?.accent : '') || 'var(--muted)' }];
		});
	}, [listing, hidden, accents]);

	const switchView = (next: View) => {
		setView(next);
		writePref('calendar_view', next);
	};

	const toggle = (id: string) => {
		const next = new Set(hidden);
		if (!next.delete(id)) {
			next.add(id);
		}
		setHidden(next);
		writePref('calendar_hidden', JSON.stringify([...next]));
	};

	const shift = (dir: number) =>
		setCursor((c) => (view === 'month' ? new Date(c.getFullYear(), c.getMonth() + dir, 1) : addDays(c, dir * (view === 'week' ? 7 : AGENDA_DAYS))));

	const create = (day: Date, hour = 9) => setOpened({ draft: new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour).getTime() });
	const open = (item: Placed) => setOpened({ eventId: item.eventId, startsAt: item.startsAt });

	const current = opened && 'eventId' in opened ? placed.find((p) => p.eventId === opened.eventId && p.startsAt === opened.startsAt) : undefined;
	const title = view === 'month' ? fmtMonth(cursor) : view === 'week' ? `Semaine du ${fmtShort(from)}` : `À partir du ${fmtShort(from)}`;

	return (
		<div className='cal'>
			<aside className='cal-side'>
				<button type='button' className='btn btn-primary btn-block' onClick={() => create(new Date(), new Date().getHours() + 1)}>
					<Icon name='plus' size={16} />
					Nouvel événement
				</button>
				<h2 className='cal-label'>Calendriers</h2>
				<ul className='cal-filters'>
					{[{ id: PERSONAL, name: 'Personnel', accent: 'var(--muted)' }, ...workspaces].map((w) => (
						<li key={w.id}>
							<label className='check cal-filter'>
								<input type='checkbox' checked={!hidden.has(w.id)} onChange={() => toggle(w.id)} />
								<span className='cal-dot' style={{ background: w.accent }} />
								<span className='cal-filter-name'>{w.name}</span>
							</label>
						</li>
					))}
				</ul>
				<button type='button' className='btn btn-ghost btn-block cal-sync-btn' onClick={() => setSync(true)}>
					<Icon name='link' size={16} />
					Abonnement et import
				</button>
			</aside>
			<section className='cal-main'>
				<header className='cal-bar'>
					<button type='button' className='btn' onClick={() => setCursor(startOfDay(new Date()))}>
						Aujourd’hui
					</button>
					<div className='cal-nav'>
						<button type='button' className='icon-btn' aria-label='Période précédente' onClick={() => shift(-1)}>
							<Icon name='chevron-left' />
						</button>
						<button type='button' className='icon-btn' aria-label='Période suivante' onClick={() => shift(1)}>
							<Icon name='chevron-right' />
						</button>
					</div>
					<h1 className='cal-title'>{title}</h1>
					<div className='segmented' role='tablist' aria-label='Affichage'>
						{VIEWS.map((v) => (
							<button key={v.id} type='button' role='tab' aria-selected={view === v.id} onClick={() => switchView(v.id)}>
								{v.label}
							</button>
						))}
					</div>
				</header>
				{error && <p className='notice notice-error cal-error'>{error}</p>}
				<div className='cal-body'>
					{!listing ? (
						<div className='spinner' aria-busy />
					) : view === 'month' ? (
						<MonthGrid from={from} month={cursor.getMonth()} items={placed} onOpen={open} onCreate={create} onMore={(day) => (setCursor(day), switchView('week'))} />
					) : view === 'week' ? (
						<WeekGrid from={from} items={placed} onOpen={open} onCreate={create} />
					) : (
						<Agenda from={from} items={placed} onOpen={open} workspaces={accents} />
					)}
				</div>
			</section>
			{opened && ('draft' in opened || current) && (
				<EventDialog me={me} workspaces={workspaces} placed={current} draft={'draft' in opened ? opened.draft : undefined} onClose={() => setOpened(null)} onChanged={load} />
			)}
			<SyncDialog open={sync} onClose={() => setSync(false)} workspaces={workspaces} onImported={load} />
		</div>
	);
}

function EventChip({ item, onOpen }: { item: Placed; onOpen: (item: Placed) => void }) {
	return (
		<button
			type='button'
			className='cal-ev'
			style={{ '--ev': item.color } as CSSProperties}
			title={item.event.title}
			onClick={(e) => {
				e.stopPropagation();
				onOpen(item);
			}}
		>
			{!item.event.allDay && <span className='cal-ev-time'>{fmtTime(item.startsAt)}</span>}
			<span className='cal-ev-title'>{item.event.title}</span>
		</button>
	);
}

type GridProps = { from: Date; items: Placed[]; onOpen: (item: Placed) => void; onCreate: (day: Date, hour?: number) => void };

function MonthGrid({ from, month, items, onOpen, onCreate, onMore }: GridProps & { month: number; onMore: (day: Date) => void }) {
	const byDay = useMemo(() => groupByDay(items, from, 42), [items, from]);
	const today = new Date();
	return (
		<div className='cal-month'>
			{WEEKDAYS.map((d) => (
				<div key={d} className='cal-month-head'>
					{d}
				</div>
			))}
			{Array.from({ length: 42 }, (_, i) => addDays(from, i)).map((day) => {
				const list = byDay.get(dayKey(day)) ?? [];
				return (
					<div key={dayKey(day)} className='cal-cell' data-out={day.getMonth() !== month || undefined} onClick={(e) => e.target === e.currentTarget && onCreate(day)}>
						<span className='cal-cell-day' data-today={sameDay(day, today) || undefined}>
							{day.getDate()}
						</span>
						{list.slice(0, 3).map((item) => (
							<EventChip key={`${item.eventId}:${item.startsAt}`} item={item} onOpen={onOpen} />
						))}
						{list.length > 3 && (
							<button type='button' className='cal-more' onClick={() => onMore(day)}>
								{list.length - 3} de plus
							</button>
						)}
					</div>
				);
			})}
		</div>
	);
}

// Colonnes parallèles pour les événements qui se chevauchent dans la journée.
function layoutDay(items: Placed[], day: Date) {
	const start = day.getTime();
	const end = addDays(day, 1).getTime();
	const pieces = items
		.filter((p) => p.startsAt < end && Math.max(p.endsAt, p.startsAt + 1) > start)
		.map((p) => ({ item: p, from: Math.max(p.startsAt, start), to: Math.min(Math.max(p.endsAt, p.startsAt + HOUR / 4), end) }))
		.sort((a, b) => a.from - b.from || b.to - a.to);
	const lanes: number[] = [];
	const placedPieces = pieces.map((piece) => {
		let lane = lanes.findIndex((laneEnd) => laneEnd <= piece.from);
		if (lane < 0) {
			lane = lanes.length;
		}
		lanes[lane] = piece.to;
		return { ...piece, lane };
	});
	return placedPieces.map((p) => ({ ...p, lanes: Math.max(1, lanes.length), top: ((p.from - start) / HOUR) * SLOT, height: Math.max(((p.to - p.from) / HOUR) * SLOT, 20) }));
}

function WeekGrid({ from, items, onOpen, onCreate }: GridProps) {
	const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
	const scroller = useRef<HTMLDivElement>(null);
	const allDay = useMemo(
		() =>
			groupByDay(
				items.filter((p) => p.event.allDay),
				from,
				7,
			),
		[items, from],
	);
	const timed = items.filter((p) => !p.event.allDay);
	const now = new Date();
	useEffect(() => {
		scroller.current?.scrollTo({ top: SLOT * 8 });
	}, []);
	return (
		<div className='cal-week'>
			<div className='cal-week-row cal-week-head'>
				<div className='cal-gutter' />
				{days.map((day, i) => (
					<div key={dayKey(day)} className='cal-week-day' data-today={sameDay(day, now) || undefined}>
						<span>{WEEKDAYS[i]}</span>
						<strong>{day.getDate()}</strong>
					</div>
				))}
			</div>
			<div className='cal-week-row cal-week-allday'>
				<div className='cal-gutter cal-gutter-label'>Journée</div>
				{days.map((day) => (
					<div key={dayKey(day)} className='cal-allday-cell'>
						{(allDay.get(dayKey(day)) ?? []).map((item) => (
							<EventChip key={`${item.eventId}:${item.startsAt}`} item={item} onOpen={onOpen} />
						))}
					</div>
				))}
			</div>
			<div className='cal-week-scroll' ref={scroller}>
				<div className='cal-week-row cal-week-grid' style={{ height: SLOT * 24 }}>
					<div className='cal-gutter'>
						{Array.from({ length: 23 }, (_, h) => (
							<span key={h} className='cal-hour' style={{ top: (h + 1) * SLOT }}>
								{String(h + 1).padStart(2, '0')}:00
							</span>
						))}
					</div>
					{days.map((day) => (
						<div
							key={dayKey(day)}
							className='cal-week-col'
							onClick={(e) => e.target === e.currentTarget && onCreate(day, Math.min(23, Math.floor(e.nativeEvent.offsetY / SLOT)))}
						>
							{layoutDay(timed, day).map((block) => (
								<button
									key={`${block.item.eventId}:${block.item.startsAt}`}
									type='button'
									className='cal-ev cal-ev-block'
									style={{ '--ev': block.item.color, top: block.top, height: block.height, left: `${(block.lane / block.lanes) * 100}%`, width: `${100 / block.lanes}%` } as CSSProperties}
									onClick={() => onOpen(block.item)}
								>
									<span className='cal-ev-title'>{block.item.event.title}</span>
									<span className='cal-ev-time'>
										{fmtTime(block.item.startsAt)} – {fmtTime(block.item.endsAt)}
									</span>
								</button>
							))}
							{sameDay(day, now) && <div className='cal-now' style={{ top: ((now.getTime() - day.getTime()) / HOUR) * SLOT }} />}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function Agenda({ from, items, onOpen, workspaces }: Omit<GridProps, 'onCreate'> & { workspaces: Map<string, WorkspaceSummary> }) {
	const byDay = useMemo(() => groupByDay(items, from, AGENDA_DAYS), [items, from]);
	const days = Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(from, i)).filter((day) => byDay.has(dayKey(day)));
	if (!days.length) {
		return <p className='cal-empty'>Aucun événement sur les {AGENDA_DAYS} prochains jours.</p>;
	}
	return (
		<ol className='cal-agenda'>
			{days.map((day) => (
				<li key={dayKey(day)}>
					<h3 className='cal-agenda-day'>{fmtDay(day)}</h3>
					<ul className='list'>
						{(byDay.get(dayKey(day)) ?? []).map((item) => (
							<li key={`${item.eventId}:${item.startsAt}`}>
								<button type='button' className='list-row cal-agenda-row' onClick={() => onOpen(item)}>
									<span className='cal-dot' style={{ background: item.color }} />
									<span className='cal-agenda-time'>{item.event.allDay ? 'Journée' : `${fmtTime(item.startsAt)} – ${fmtTime(item.endsAt)}`}</span>
									<span className='cal-agenda-title'>{item.event.title}</span>
									<span className='cal-agenda-meta'>
										{(item.event.workspaceId && workspaces.get(item.event.workspaceId)?.name) || 'Personnel'}
										{item.event.location ? ` · ${item.event.location}` : ''}
									</span>
								</button>
							</li>
						))}
					</ul>
				</li>
			))}
		</ol>
	);
}
