import { useEffect, useState, type FormEvent } from 'react';

import type { AiParsedEvent } from '../../../shared/ai-chat';
import type { CalendarEvent, CalendarListing } from '../../../shared/calendar';
import type { Channel } from '../../../shared/types';
import { api, errorText } from '../../api';
import { EventDescribe } from '../../ai/EventDescribe';
import { DAY, fromDateInput, fromLocalInput, HOUR, toDateInput, toLocalInput, userTimeZone, whenText } from '../../calendar/dates';
import { Dialog, Icon } from '../../ui';
import type { Lookup } from '../richText';
import './events.css';

const DURATIONS: Array<[string, string]> = [
	['15', '15 min'],
	['30', '30 min'],
	['45', '45 min'],
	['60', '1 h'],
	['90', '1 h 30'],
	['120', '2 h'],
	['180', '3 h'],
	['240', '4 h'],
	['day', 'Journée entière'],
];

type Upcoming = { event: CalendarEvent; startsAt: number; endsAt: number };

type Props = { workspaceId: string; channel: Channel; lookup: Lookup; initialTitle: string; onClose: () => void };

export function EventCardDialog({ workspaceId, channel, lookup, initialTitle, onClose }: Props) {
	const [tab, setTab] = useState<'new' | 'existing'>('new');
	const [title, setTitle] = useState(initialTitle);
	const [start, setStart] = useState(() => toLocalInput(Math.ceil(Date.now() / HOUR) * HOUR));
	const [duration, setDuration] = useState('60');
	const [location, setLocation] = useState('');
	const [channelId, setChannelId] = useState('');
	const [description, setDescription] = useState('');
	const [upcoming, setUpcoming] = useState<Upcoming[] | null>(null);
	const [picked, setPicked] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const voiceChannels = lookup.channels.filter((c) => c.kind === 'voice');
	const allDay = duration === 'day';

	useEffect(() => {
		if (tab !== 'existing' || upcoming) {
			return;
		}
		const now = Date.now();
		api<CalendarListing>('GET', `/calendar/events?from=${now}&to=${now + 180 * DAY}`)
			.then((listing) => {
				const events = new Map(listing.events.filter((e) => e.workspaceId === workspaceId).map((e) => [e.id, e]));
				const seen = new Set<string>();
				setUpcoming(
					listing.occurrences.flatMap((o) => {
						const event = events.get(o.eventId);
						if (!event || seen.has(o.eventId)) {
							return [];
						}
						seen.add(o.eventId);
						return [{ event, startsAt: o.startsAt, endsAt: o.endsAt }];
					}),
				);
			})
			.catch((e) => {
				setError(errorText(e));
				setUpcoming([]);
			});
	}, [tab, upcoming, workspaceId]);

	const applyParsed = (p: AiParsedEvent) => {
		if (p.title) setTitle(p.title);
		if (p.description) setDescription(p.description);
		if (p.location) setLocation(p.location);
		if (p.channelId && voiceChannels.some((c) => c.id === p.channelId)) setChannelId(p.channelId);
		if (typeof p.startsAt !== 'number') {
			return;
		}
		if (p.allDay) {
			setStart(`${toDateInput(p.startsAt)}T09:00`);
			setDuration('day');
			return;
		}
		setStart(toLocalInput(p.startsAt));
		if (typeof p.endsAt === 'number' && p.endsAt > p.startsAt) {
			const minutes = (p.endsAt - p.startsAt) / 60_000;
			const nearest = DURATIONS.filter(([v]) => v !== 'day').reduce((best, [v]) => (Math.abs(Number(v) - minutes) < Math.abs(Number(best) - minutes) ? v : best), '60');
			setDuration(nearest);
		}
	};

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		let body: unknown;
		if (tab === 'existing') {
			if (!picked) {
				setError('Choisis un événement');
				return;
			}
			body = { eventId: picked };
		} else {
			const startsAt = allDay ? fromDateInput(start.slice(0, 10)) : fromLocalInput(start);
			if (!Number.isFinite(startsAt)) {
				setError('Date invalide');
				return;
			}
			body = {
				event: {
					title,
					description,
					startsAt,
					endsAt: allDay ? startsAt + DAY : startsAt + Number(duration) * 60_000,
					allDay,
					timezone: userTimeZone(),
					location,
					channelId: channelId || null,
					recurrence: null,
					reminderMinutes: null,
					attendees: [],
				},
			};
		}
		setBusy(true);
		setError('');
		try {
			await api('POST', `/w/${workspaceId}/channels/${channel.id}/event-cards`, body);
			onClose();
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open onClose={onClose} title='Ajouter un événement'>
			<form className='evd-form' onSubmit={submit}>
				<div className='tabs' role='tablist'>
					<button type='button' role='tab' className='tab' aria-selected={tab === 'new'} onClick={() => (setTab('new'), setError(''))}>
						Nouvel événement
					</button>
					<button type='button' role='tab' className='tab' aria-selected={tab === 'existing'} onClick={() => (setTab('existing'), setError(''))}>
						Événement existant
					</button>
				</div>
				{tab === 'new' ? (
					<>
						<EventDescribe workspaceId={workspaceId} onParsed={applyParsed} />
						<label className='field'>
							Titre
							<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus placeholder='Point d’équipe' />
						</label>
						<div className='evd-row'>
							<label className='field'>
								{allDay ? 'Date' : 'Début'}
								{allDay ? (
									<input type='date' value={start.slice(0, 10)} onChange={(e) => setStart(`${e.target.value}${start.slice(10)}`)} required />
								) : (
									<input type='datetime-local' value={start} onChange={(e) => setStart(e.target.value)} required />
								)}
							</label>
							<label className='field'>
								Durée
								<select value={duration} onChange={(e) => setDuration(e.target.value)}>
									{DURATIONS.map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</label>
						</div>
						<div className='evd-row'>
							<label className='field'>
								Lieu
								<input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder='Adresse ou lien' />
							</label>
							<label className='field'>
								Salon vocal
								<select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
									<option value=''>Aucun</option>
									{voiceChannels.map((c) => (
										<option key={c.id} value={c.id}>
											{c.name}
										</option>
									))}
								</select>
							</label>
						</div>
						<label className='field'>
							Description (facultatif)
							<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} />
						</label>
					</>
				) : upcoming === null ? (
					<p className='evd-empty'>Chargement des événements…</p>
				) : upcoming.length === 0 ? (
					<p className='evd-empty'>Aucun événement à venir dans cet espace.</p>
				) : (
					<ul className='evd-list' role='listbox' aria-label='Événements à venir'>
						{upcoming.map(({ event, startsAt, endsAt }) => (
							<li key={event.id}>
								<button type='button' role='option' aria-selected={picked === event.id} className='evd-item' onClick={() => setPicked(event.id)}>
									<Icon name={picked === event.id ? 'check' : 'calendar'} size={16} />
									<span className='evd-item-text'>
										<strong className='ellipsis'>{event.title}</strong>
										<span className='ellipsis'>{whenText(startsAt, endsAt, event.allDay)}</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
				{error && (
					<p className='notice' role='alert'>
						{error}
					</p>
				)}
				<div className='evd-actions'>
					<button type='button' className='btn' onClick={onClose}>
						Annuler
					</button>
					<button className='btn btn-primary' disabled={busy || (tab === 'existing' && !picked)}>
						{tab === 'new' ? 'Créer et partager' : 'Partager'}
					</button>
				</div>
			</form>
		</Dialog>
	);
}
