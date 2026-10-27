import { useState } from 'react';

import { DAY, occurrences, type Attendee, type CalendarEvent, type RsvpResponse } from '../../../shared/calendar';
import { api, errorText } from '../../api';
import { localDay, recurrenceText, userTimeZone, whenText } from '../../calendar/dates';
import { navigate } from '../../router';
import { Avatar, Icon } from '../../ui';
import type { Lookup } from '../richText';
import { useEventCard } from './store';
import './events.css';

type Answer = Exclude<RsvpResponse, 'pending'>;

const CHOICES: Array<[Answer, string]> = [
	['yes', 'Ajouter à mon calendrier'],
	['maybe', 'Peut-être'],
	['no', 'Non'],
];
const RANK: Record<RsvpResponse, number> = { yes: 0, maybe: 1, pending: 2, no: 3 };
const AVATARS = 5;

const monthFormat = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const zoneFormat = new Intl.DateTimeFormat('fr-FR', { timeZoneName: 'short' });

export function durationText(ms: number, allDay: boolean): string {
	if (allDay) {
		const days = Math.max(1, Math.round(ms / DAY));
		return days > 1 ? `${days} jours` : '1 jour';
	}
	const minutes = Math.round(ms / 60_000);
	if (minutes < 60) {
		return `${minutes} min`;
	}
	const rest = minutes % 60;
	return rest ? `${Math.floor(minutes / 60)} h ${String(rest).padStart(2, '0')}` : `${minutes / 60} h`;
}

// Série : prochaine occurrence, sinon le début d'origine.
const nextStart = (event: CalendarEvent) => (event.recurrence ? (occurrences(event, Date.now(), Date.now() + 400 * DAY, 1)[0] ?? event.startsAt) : event.startsAt);

const zoneName = (ms: number) => zoneFormat.formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? userTimeZone();

type Props = { workspaceId: string; eventId: string; lookup: Lookup };

export function EventCard({ workspaceId, eventId, lookup }: Props) {
	const { entry, reload } = useEventCard(workspaceId, eventId);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	if (!entry || (!entry.card && !entry.error)) {
		return (
			<div className='evc evc-muted' aria-busy='true'>
				<Icon name='calendar' size={18} />
				<span>Chargement de l’événement…</span>
			</div>
		);
	}
	if (!entry.card || entry.card.status === 'cancelled') {
		return (
			<div className='evc evc-muted'>
				<Icon name='calendar' size={18} />
				<div className='evc-note'>
					<strong>{entry.card ? 'Événement annulé' : 'Événement indisponible'}</strong>
					<span>{entry.card ? 'Il a été supprimé du calendrier.' : entry.error}</span>
				</div>
			</div>
		);
	}

	const { event } = entry.card;
	const start = nextStart(event);
	const length = event.endsAt - event.startsAt;
	const day = localDay(start, event.allDay);
	const mine = event.myResponse;
	const count = (response: RsvpResponse) => event.attendees.filter((a) => a.response === response).length;
	const going = event.attendees.filter((a) => a.response !== 'no').sort((a, b) => RANK[a.response] - RANK[b.response]);
	const organizer: Pick<Attendee, 'name' | 'avatarUrl'> = lookup.members.get(event.createdBy) ??
		event.attendees.find((a) => a.id === event.createdBy) ?? { name: 'Ancien membre', avatarUrl: null };
	const voice = event.channelId ? lookup.channels.find((c) => c.id === event.channelId && c.kind === 'voice') : undefined;

	const answer = async (response: Answer) => {
		if (busy || mine === response) {
			return;
		}
		setBusy(true);
		setError('');
		try {
			await api('PUT', `/calendar/events/${event.id}/response`, { response });
			await reload();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<article className='evc' aria-label={`Événement : ${event.title}`}>
			<div className='evc-date' aria-hidden>
				<span className='evc-month'>{monthFormat.format(day).replace('.', '')}</span>
				<span className='evc-day'>{day.getDate()}</span>
			</div>
			<div className='evc-main'>
				<div className='evc-title'>{event.title}</div>
				<p className='evc-line'>
					<Icon name='clock' size={14} />
					<span>
						{whenText(start, start + length, event.allDay)}
						{event.allDay ? '' : ` (${zoneName(start)})`} · {durationText(length, event.allDay)}
					</span>
				</p>
				{event.recurrence && (
					<p className='evc-line'>
						<Icon name='repeat' size={14} />
						<span>{recurrenceText(event.recurrence, event.allDay)}</span>
					</p>
				)}
				{event.location && (
					<p className='evc-line'>
						<Icon name='pin' size={14} />
						<span className='ellipsis'>{event.location}</span>
					</p>
				)}
				{voice && (
					<p className='evc-line'>
						<Icon name='speaker' size={14} />
						<button type='button' className='evc-link' onClick={() => lookup.openChannel(voice.id)}>
							{voice.name}
						</button>
					</p>
				)}
				<p className='evc-line'>
					<Avatar name={organizer.name} url={organizer.avatarUrl} size={16} />
					<span className='ellipsis'>Organisé par {organizer.name}</span>
				</p>
				<div className='evc-people'>
					{going.length > 0 && (
						<span className='evc-avatars'>
							{going.slice(0, AVATARS).map((a) => (
								<Avatar key={a.id} name={a.name} url={a.avatarUrl} size={22} />
							))}
							{going.length > AVATARS && <span className='evc-more'>+{going.length - AVATARS}</span>}
						</span>
					)}
					<span>
						{count('yes')} oui · {count('maybe')} peut-être · {count('no')} non
					</span>
				</div>
				<div className='evc-actions'>
					{CHOICES.map(([response, label]) => (
						<button
							key={response}
							type='button'
							className={`btn${response === 'yes' && mine !== 'yes' ? ' btn-primary' : ''}`}
							aria-pressed={mine === response}
							disabled={busy}
							onClick={() => void answer(response)}
						>
							{mine === response && <Icon name='check' size={14} />}
							{response === 'yes' && mine === 'yes' ? 'Dans ton calendrier' : label}
						</button>
					))}
					<span className='grow' />
					<a className='icon-btn' href={`/api/w/${workspaceId}/event-cards/${event.id}/ics`} download aria-label='Télécharger .ics' title='Télécharger .ics'>
						<Icon name='download' size={16} />
					</a>
					<button type='button' className='icon-btn' aria-label='Ouvrir dans le calendrier' title='Ouvrir dans le calendrier' onClick={() => navigate('/calendrier')}>
						<Icon name='calendar' size={16} />
					</button>
				</div>
				{error && (
					<p className='evc-error' role='alert'>
						{error}
					</p>
				)}
			</div>
		</article>
	);
}
