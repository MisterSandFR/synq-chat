import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { ABSENCE_KINDS, absenceNow, covers, dayFromDate, holidaysBetween, kindInfo, partOn, shiftDay, weekdayOf, type Absence, type AbsenceListing, type AbsencePerson, type DayPart } from '../../shared/absences';
import type { Me, WorkspaceSummary } from '../../shared/types';
import { api, errorText } from '../api';
import { readPref, writePref } from '../router';
import { Avatar, Icon } from '../ui';
import { AbsenceDialog, kindStyle, WEEKDAY_LETTERS, type AbsenceDraft } from './AbsenceDialog';
import './team.css';

export type TeamSpan = 'week' | 'month';

type Props = { me: Me; workspaces: WorkspaceSummary[]; from: Date; days: number; span: TeamSpan; onSpan: (span: TeamSpan) => void; tick: number };

type Opened = { absence: Absence } | { draft: AbsenceDraft };

type Segment = { absence: Absence; part: DayPart; joinStart: boolean; joinEnd: boolean };

// Une case par jour : un bloc pour la journée ou deux demi-blocs.
function segmentsOn(list: Absence[], day: string): Segment[] {
	const find = (d: string, half: 'am' | 'pm') => list.find((a) => covers(partOn(a, d), half));
	const am = find(day, 'am');
	const pm = find(day, 'pm');
	const before = find(shiftDay(day, -1), 'pm');
	const after = find(shiftDay(day, 1), 'am');
	if (am && am === pm) {
		return [{ absence: am, part: 'day', joinStart: before === am, joinEnd: after === am }];
	}
	const out: Segment[] = [];
	if (am) {
		out.push({ absence: am, part: 'am', joinStart: before === am, joinEnd: false });
	}
	if (pm) {
		out.push({ absence: pm, part: 'pm', joinStart: false, joinEnd: after === pm });
	}
	return out;
}

function summaryText(away: number, remote: number): string {
	if (!away && !remote) {
		return 'Tout le monde est là aujourd’hui';
	}
	const parts = [away && `${away} absent${away > 1 ? 's' : ''}`, remote && `${remote} en télétravail`].filter(Boolean);
	return `Aujourd’hui : ${parts.join(', ')}`;
}

export function TeamView({ me, workspaces, from, days, span, onSpan, tick }: Props) {
	const [workspaceId, setWorkspaceId] = useState(() => {
		const saved = readPref('team_workspace');
		return saved !== null && (saved === '' || workspaces.some((w) => w.id === saved)) ? saved : (workspaces[0]?.id ?? '');
	});
	const [gradeId, setGradeId] = useState('');
	const [listing, setListing] = useState<AbsenceListing | null>(null);
	const [error, setError] = useState('');
	const [opened, setOpened] = useState<Opened | null>(null);
	const first = dayFromDate(from);
	const last = shiftDay(first, days - 1);
	const today = dayFromDate(new Date());
	const request = useRef(0);

	const load = useCallback(async () => {
		const id = ++request.current;
		try {
			const next = await api<AbsenceListing>('GET', `/absences?from=${first}&to=${last}${workspaceId ? `&workspace=${workspaceId}` : ''}`);
			if (id === request.current) {
				setListing(next);
				setError('');
			}
		} catch (e) {
			if (id === request.current) {
				setError(errorText(e));
			}
		}
	}, [first, last, workspaceId]);

	useEffect(() => {
		void load();
	}, [load, tick]);

	// Mois plus large que l'écran : aujourd'hui ramené dans la vue.
	const scroller = useRef<HTMLDivElement>(null);
	const loaded = listing !== null;
	useEffect(() => {
		scroller.current?.querySelector('.team-day[data-today]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
	}, [loaded, first, span]);

	const pickWorkspace = (id: string) => {
		setWorkspaceId(id);
		setGradeId('');
		writePref('team_workspace', id);
	};

	const dayList = useMemo(() => Array.from({ length: days }, (_, i) => shiftDay(first, i)), [first, days]);
	const holidays = useMemo(() => holidaysBetween(first, last), [first, last]);
	const people = useMemo(() => {
		const list = (listing?.people ?? []).filter((p) => !gradeId || p.gradeIds.includes(gradeId));
		return list.sort((a, b) => Number(b.id === me.user.id) - Number(a.id === me.user.id));
	}, [listing, gradeId, me.user.id]);
	const byUser = useMemo(() => {
		const out = new Map<string, Absence[]>();
		for (const a of listing?.absences ?? []) {
			out.set(a.userId, [...(out.get(a.userId) ?? []), a]);
		}
		return out;
	}, [listing]);
	const summary = useMemo(() => {
		if (today < first || today > last) {
			return '';
		}
		let away = 0;
		let remote = 0;
		for (const p of people) {
			const now = absenceNow(byUser.get(p.id) ?? [], p.id, today);
			if (now) {
				if (now.kind === 'remote') {
					remote++;
				} else {
					away++;
				}
			}
		}
		return summaryText(away, remote);
	}, [people, byUser, today, first, last]);

	const pose = (person: AbsencePerson, day: string) => person.canManage && setOpened({ draft: { userId: person.id, day } });

	return (
		<div className='team'>
			<div className='team-bar'>
				<label className='sr-only' htmlFor='team-workspace'>
					Espace
				</label>
				<select id='team-workspace' className='team-select' value={workspaceId} onChange={(e) => pickWorkspace(e.target.value)}>
					<option value=''>Tous les espaces</option>
					{workspaces.map((w) => (
						<option key={w.id} value={w.id}>
							{w.name}
						</option>
					))}
				</select>
				{Boolean(listing?.grades.length) && (
					<>
						<label className='sr-only' htmlFor='team-grade'>
							Grade
						</label>
						<select id='team-grade' className='team-select' value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
							<option value=''>Tous les grades</option>
							{listing!.grades.map((g) => (
								<option key={g.id} value={g.id}>
									{g.name}
								</option>
							))}
						</select>
					</>
				)}
				<div className='segmented' role='tablist' aria-label='Période'>
					{(['week', 'month'] as const).map((s) => (
						<button key={s} type='button' role='tab' aria-selected={span === s} onClick={() => onSpan(s)}>
							{s === 'week' ? 'Semaine' : 'Mois'}
						</button>
					))}
				</div>
				{summary && <p className='team-summary'>{summary}</p>}
				<button type='button' className='btn btn-primary team-pose' onClick={() => setOpened({ draft: { userId: me.user.id, day: today >= first && today <= last ? today : first } })}>
					<Icon name='plus' size={16} />
					Poser une absence
				</button>
			</div>
			{error && <p className='notice notice-error cal-error'>{error}</p>}
			{!listing ? (
				<div className='spinner' aria-busy />
			) : (
				<div className='team-scroll' ref={scroller}>
					<div className='team-grid' data-span={span} style={{ '--team-days': days } as CSSProperties}>
						<div className='team-corner'>{people.length} personne{people.length > 1 ? 's' : ''}</div>
						{dayList.map((day) => {
							const holiday = holidays.get(day);
							return (
								<div key={day} className='team-day' data-off={weekdayOf(day) > 4 || Boolean(holiday) || undefined} data-today={day === today || undefined} title={holiday}>
									<span>{WEEKDAY_LETTERS[weekdayOf(day)]}</span>
									<strong>{Number(day.slice(8))}</strong>
									{holiday && <span className='team-holiday'>{span === 'week' ? holiday : ''}</span>}
								</div>
							);
						})}
						{people.map((person) => {
							const list = byUser.get(person.id) ?? [];
							return (
								<div key={person.id} className='team-row' role='row'>
									<button type='button' className='team-person' disabled={!person.canManage} onClick={() => pose(person, today >= first && today <= last ? today : first)} title={person.canManage ? 'Poser une absence' : undefined}>
										<Avatar name={person.name} url={person.avatarUrl} size={24} />
										<span className='ellipsis'>
											{person.name}
											{person.id === me.user.id && <span className='muted'> (toi)</span>}
										</span>
									</button>
									{dayList.map((day) => (
										<div
											key={day}
											className='team-cell'
											data-off={weekdayOf(day) > 4 || holidays.has(day) || undefined}
											data-today={day === today || undefined}
											data-pose={person.canManage || undefined}
											onClick={() => pose(person, day)}
										>
											{segmentsOn(list, day).map((seg) => {
												const info = kindInfo(seg.absence.kind);
												const label = `${person.name} : ${info.label}${seg.absence.note ? `, ${seg.absence.note}` : ''}`;
												return (
													<button
														key={`${seg.absence.id}:${seg.part}`}
														type='button'
														className='team-block'
														data-part={seg.part}
														data-kind={seg.absence.kind ?? 'private'}
														data-join-start={seg.joinStart || undefined}
														data-join-end={seg.joinEnd || undefined}
														style={kindStyle(seg.absence.kind)}
														title={label}
														aria-label={label}
														onClick={(e) => {
															e.stopPropagation();
															setOpened({ absence: seg.absence });
														}}
													>
														{span === 'week' && !seg.joinStart && <span className='team-block-label'>{info.label}</span>}
													</button>
												);
											})}
										</div>
									))}
								</div>
							);
						})}
					</div>
					{!people.length && <p className='cal-empty'>Personne dans ce filtre.</p>}
				</div>
			)}
			<ul className='team-legend' aria-label='Légende'>
				{ABSENCE_KINDS.map((k) => (
					<li key={k.value} style={kindStyle(k.value)} data-kind={k.value}>
						<span className='team-swatch' />
						{k.label}
					</li>
				))}
				<li style={kindStyle(null)}>
					<span className='team-swatch' />
					Absent (privée)
				</li>
				<li>
					<span className='team-swatch team-swatch-off' />
					Week-end et férié
				</li>
			</ul>
			{opened && listing && (
				<AbsenceDialog
					me={me}
					people={listing.people}
					absence={'absence' in opened ? opened.absence : undefined}
					draft={'draft' in opened ? opened.draft : undefined}
					onClose={() => setOpened(null)}
					onChanged={() => void load()}
				/>
			)}
		</div>
	);
}
