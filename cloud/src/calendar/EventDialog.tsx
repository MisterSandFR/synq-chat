import { useEffect, useState, type FormEvent } from 'react';

import type { AiParsedEvent } from '../../shared/ai-chat';
import type { CalendarPerson, EventInput, RecurrenceFreq, RsvpResponse } from '../../shared/calendar';
import { ACCENTS, type Channel, type Me, type WorkspaceSummary } from '../../shared/types';
import { api, errorText } from '../api';
import { EventDescribe } from '../ai/EventDescribe';
import { navigate } from '../router';
import { Avatar, Dialog, Icon } from '../ui';
import { DAY, fromDateInput, fromLocalInput, HOUR, recurrenceText, reminderText, REMINDERS, toDateInput, toLocalInput, userTimeZone, whenText, type Placed } from './dates';

const RESPONSES: Record<RsvpResponse, string> = { pending: 'En attente', yes: 'Oui', maybe: 'Peut-être', no: 'Non' };

type Props = { me: Me; workspaces: WorkspaceSummary[]; placed?: Placed; draft?: number; onClose: () => void; onChanged: () => void };

export function EventDialog({ me, workspaces, placed, draft, onClose, onChanged }: Props) {
	const [editing, setEditing] = useState(!placed);
	const title = editing ? (placed ? 'Modifier l’événement' : 'Nouvel événement') : (placed?.event.title ?? '');
	return (
		<Dialog open onClose={onClose} title={title} wide={editing}>
			{editing || !placed ? (
				<EventForm
					me={me}
					workspaces={workspaces}
					placed={placed}
					draft={draft ?? Date.now()}
					onCancel={placed ? () => setEditing(false) : onClose}
					onSaved={() => {
						onChanged();
						onClose();
					}}
				/>
			) : (
				<EventDetails me={me} placed={placed} workspaces={workspaces} onEdit={() => setEditing(true)} onChanged={onChanged} onClose={onClose} />
			)}
		</Dialog>
	);
}

function EventDetails({ me, placed, workspaces, onEdit, onChanged, onClose }: { me: Me; placed: Placed; workspaces: WorkspaceSummary[]; onEdit: () => void; onChanged: () => void; onClose: () => void }) {
	const { event } = placed;
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [channelName, setChannelName] = useState('');
	const workspace = workspaces.find((w) => w.id === event.workspaceId);

	useEffect(() => {
		if (event.workspaceId && event.channelId) {
			api<Channel[]>('GET', `/w/${event.workspaceId}/channels`)
				.then((list) => setChannelName(list.find((c) => c.id === event.channelId)?.name ?? ''))
				.catch(() => setChannelName(''));
		}
	}, [event.workspaceId, event.channelId]);

	const run = async (action: () => Promise<unknown>, close: boolean) => {
		setBusy(true);
		setError('');
		try {
			await action();
			onChanged();
			if (close) {
				onClose();
			}
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	const remove = (occurrence: boolean) => {
		if (confirm(occurrence ? 'Supprimer cette occurrence ?' : 'Supprimer cet événement et toutes ses occurrences ?')) {
			void run(() => api('DELETE', `/calendar/events/${event.id}${occurrence ? `?occurrence=${placed.startsAt}` : ''}`), true);
		}
	};

	return (
		<div className='cal-details'>
			<p className='cal-detail'>
				<Icon name='clock' size={16} />
				{whenText(placed.startsAt, placed.endsAt, event.allDay)}
			</p>
			{event.recurrence && (
				<p className='cal-detail'>
					<Icon name='repeat' size={16} />
					{recurrenceText(event.recurrence, event.allDay)}
				</p>
			)}
			<p className='cal-detail'>
				<span className='cal-dot' style={{ background: placed.color }} />
				{workspace?.name ?? 'Personnel'}
			</p>
			{event.location && (
				<p className='cal-detail'>
					<Icon name='pin' size={16} />
					{event.location}
				</p>
			)}
			{event.channelId && workspace && (
				<p className='cal-detail'>
					<Icon name='speaker' size={16} />
					<button type='button' className='cal-link' onClick={() => navigate(`/w/${workspace.id}/${event.channelId}`)}>
						{channelName || 'Salon vocal'}
					</button>
				</p>
			)}
			{event.reminderMinutes !== null && (
				<p className='cal-detail'>
					<Icon name='bell' size={16} />
					{reminderText(event.reminderMinutes)}
				</p>
			)}
			{event.description && <p className='cal-description'>{event.description}</p>}
			{event.attendees.length > 0 && (
				<div>
					<h3 className='cal-label'>Participants</h3>
					<ul className='cal-people'>
						{event.attendees.map((a) => (
							<li key={a.id}>
								<Avatar name={a.name} url={a.avatarUrl} size={24} />
								<span className='cal-person-name'>{a.id === me.user.id ? `${a.name} (toi)` : a.name}</span>
								<span className='cal-rsvp' data-response={a.response}>
									{RESPONSES[a.response]}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
			<div className='cal-rsvp-row'>
				<span>Tu participes ?</span>
				<div className='segmented' role='group' aria-label='Ma réponse'>
					{(['yes', 'maybe', 'no'] as const).map((response) => (
						<button
							key={response}
							type='button'
							aria-selected={event.myResponse === response}
							disabled={busy}
							onClick={() => run(() => api('PUT', `/calendar/events/${event.id}/response`, { response }), false)}
						>
							{RESPONSES[response]}
						</button>
					))}
				</div>
			</div>
			{error && <p className='notice notice-error'>{error}</p>}
			{event.canEdit && (
				<div className='cal-actions'>
					{event.recurrence && (
						<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => remove(true)}>
							Supprimer cette occurrence
						</button>
					)}
					<button type='button' className='btn btn-danger' disabled={busy} onClick={() => remove(false)}>
						<Icon name='trash' size={16} />
						{event.recurrence ? 'Supprimer la série' : 'Supprimer'}
					</button>
					<button type='button' className='btn btn-primary' onClick={onEdit}>
						<Icon name='pencil' size={16} />
						Modifier
					</button>
				</div>
			)}
		</div>
	);
}

type FormProps = { me: Me; workspaces: WorkspaceSummary[]; placed?: Placed; draft: number; onCancel: () => void; onSaved: () => void };

function EventForm({ me, workspaces, placed, draft, onCancel, onSaved }: FormProps) {
	const event = placed?.event;
	const [workspaceId, setWorkspaceId] = useState(event?.workspaceId ?? '');
	const [title, setTitle] = useState(event?.title ?? '');
	const [allDay, setAllDay] = useState(event?.allDay ?? false);
	const [start, setStart] = useState(() => (event ? (event.allDay ? toDateInput(event.startsAt) : toLocalInput(event.startsAt)) : toLocalInput(draft)));
	const [end, setEnd] = useState(() => (event ? (event.allDay ? toDateInput(event.endsAt - DAY) : toLocalInput(event.endsAt)) : toLocalInput(draft + HOUR)));
	const [freq, setFreq] = useState<RecurrenceFreq | ''>(event?.recurrence?.freq ?? '');
	const [every, setEvery] = useState(event?.recurrence?.interval ?? 1);
	const [until, setUntil] = useState(() => {
		const value = event?.recurrence?.until;
		return value == null ? '' : event!.allDay ? toDateInput(value) : toLocalInput(value).slice(0, 10);
	});
	const [reminder, setReminder] = useState(event ? String(event.reminderMinutes ?? '') : '15');
	const [location, setLocation] = useState(event?.location ?? '');
	const [channelId, setChannelId] = useState(event?.channelId ?? '');
	const [color, setColor] = useState(event?.color ?? '');
	const [description, setDescription] = useState(event?.description ?? '');
	const [attendees, setAttendees] = useState<CalendarPerson[]>(() => event?.attendees.map(({ id, name, avatarUrl }) => ({ id, name, avatarUrl })) ?? []);
	const [people, setPeople] = useState<CalendarPerson[]>([]);
	const [channels, setChannels] = useState<Channel[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	useEffect(() => {
		api<CalendarPerson[]>('GET', `/calendar/people${workspaceId ? `?workspace=${workspaceId}` : ''}`)
			.then(setPeople)
			.catch(() => setPeople([]));
		if (workspaceId) {
			api<Channel[]>('GET', `/w/${workspaceId}/channels`)
				.then((list) => setChannels(list.filter((c) => c.kind === 'voice')))
				.catch(() => setChannels([]));
		} else {
			setChannels([]);
		}
	}, [workspaceId]);

	const applyParsed = (p: AiParsedEvent) => {
		if (p.title) setTitle(p.title);
		if (p.description) setDescription(p.description);
		if (p.location) setLocation(p.location);
		if (p.channelId) setChannelId(p.channelId);
		if (p.reminderMinutes !== undefined) setReminder(p.reminderMinutes === null ? '' : String(p.reminderMinutes));
		if (p.recurrence) {
			setFreq(p.recurrence.freq);
			setEvery(p.recurrence.interval);
		}
		if (p.attendees?.length) {
			const found = people.filter((person) => p.attendees!.includes(person.id));
			setAttendees((current) => [...current, ...found.filter((person) => !current.some((a) => a.id === person.id))]);
		}
		if (typeof p.startsAt === 'number') {
			const day = p.allDay ?? false;
			const endsAt = typeof p.endsAt === 'number' && p.endsAt >= p.startsAt ? p.endsAt : p.startsAt + (day ? DAY : HOUR);
			setAllDay(day);
			setStart(day ? toDateInput(p.startsAt) : toLocalInput(p.startsAt));
			setEnd(day ? toDateInput(Math.max(p.startsAt, endsAt - DAY)) : toLocalInput(endsAt));
		}
	};

	const toggleAllDay = (on: boolean) => {
		setStart(on ? start.slice(0, 10) : `${start.slice(0, 10)}T09:00`);
		setEnd(on ? end.slice(0, 10) : `${end.slice(0, 10)}T10:00`);
		setAllDay(on);
	};

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		const startsAt = allDay ? fromDateInput(start) : fromLocalInput(start);
		// Journée entière : la date de fin affichée est incluse.
		const endsAt = allDay ? fromDateInput(end) + DAY : fromLocalInput(end);
		if (!(endsAt >= startsAt)) {
			setError('La fin doit suivre le début.');
			return;
		}
		const body: EventInput = {
			workspaceId: workspaceId || null,
			title,
			description,
			startsAt,
			endsAt,
			allDay,
			timezone: allDay ? 'UTC' : userTimeZone(),
			location,
			channelId: workspaceId && channelId ? channelId : null,
			color,
			recurrence: freq ? { freq, interval: every, until: until ? (allDay ? fromDateInput(until) : new Date(`${until}T23:59:59`).getTime()) : null } : null,
			reminderMinutes: reminder === '' ? null : Number(reminder),
			attendees: attendees.map((a) => a.id),
		};
		setBusy(true);
		setError('');
		try {
			await (event ? api('PATCH', `/calendar/events/${event.id}`, body) : api('POST', '/calendar/events', body));
			onSaved();
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(false);
		}
	};

	const candidates = people.filter((p) => !attendees.some((a) => a.id === p.id));

	return (
		<form className='cal-form' onSubmit={submit}>
			{!event && <EventDescribe workspaceId={workspaceId || null} onParsed={applyParsed} />}
			<label className='field'>
				Titre
				<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus placeholder='Point d’équipe' />
			</label>
			<div className='cal-form-row'>
				<label className='field'>
					Calendrier
					<select value={workspaceId} disabled={Boolean(event)} onChange={(e) => (setWorkspaceId(e.target.value), setChannelId(''), setAttendees([]))}>
						<option value=''>Personnel</option>
						{workspaces.map((w) => (
							<option key={w.id} value={w.id}>
								{w.name}
							</option>
						))}
					</select>
				</label>
				<label className='check cal-allday'>
					<input type='checkbox' checked={allDay} onChange={(e) => toggleAllDay(e.target.checked)} />
					Journée entière
				</label>
			</div>
			<div className='cal-form-row'>
				<label className='field'>
					Début
					<input type={allDay ? 'date' : 'datetime-local'} value={start} onChange={(e) => setStart(e.target.value)} required />
				</label>
				<label className='field'>
					Fin
					<input type={allDay ? 'date' : 'datetime-local'} value={end} onChange={(e) => setEnd(e.target.value)} required />
				</label>
			</div>
			<div className='cal-form-row'>
				<label className='field'>
					Répétition
					<select value={freq} onChange={(e) => setFreq(e.target.value as RecurrenceFreq | '')}>
						<option value=''>Ne se répète pas</option>
						<option value='daily'>Chaque jour</option>
						<option value='weekly'>Chaque semaine</option>
						<option value='monthly'>Chaque mois</option>
					</select>
				</label>
				<label className='field'>
					Rappel
					<select value={reminder} onChange={(e) => setReminder(e.target.value)}>
						{REMINDERS.map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</label>
			</div>
			{freq && (
				<div className='cal-form-row'>
					<label className='field'>
						Intervalle
						<input type='number' min={1} max={99} value={every} onChange={(e) => setEvery(Math.min(99, Math.max(1, Number(e.target.value) || 1)))} />
					</label>
					<label className='field'>
						Jusqu’au (facultatif)
						<input type='date' value={until} onChange={(e) => setUntil(e.target.value)} />
					</label>
				</div>
			)}
			<div className='cal-form-row'>
				<label className='field'>
					Lieu
					<input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder='Adresse ou lien' />
				</label>
				{workspaceId && (
					<label className='field'>
						Salon vocal
						<select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
							<option value=''>Aucun</option>
							{channels.map((c) => (
								<option key={c.id} value={c.id}>
									{c.name}
								</option>
							))}
						</select>
					</label>
				)}
			</div>
			<div className='field'>
				Participants
				{attendees.length > 0 && (
					<ul className='cal-chips'>
						{attendees.map((a) => (
							<li key={a.id} className='grade-chip'>
								<Avatar name={a.name} url={a.avatarUrl} size={18} />
								{a.id === me.user.id ? `${a.name} (toi)` : a.name}
								<button type='button' className='chip-x' aria-label={`Retirer ${a.name}`} onClick={() => setAttendees(attendees.filter((x) => x.id !== a.id))}>
									<Icon name='close' size={12} />
								</button>
							</li>
						))}
					</ul>
				)}
				<select
					value=''
					aria-label='Ajouter un participant'
					onChange={(e) => {
						const person = people.find((p) => p.id === e.target.value);
						if (person) {
							setAttendees([...attendees, person]);
						}
					}}
				>
					<option value=''>{candidates.length ? 'Ajouter un participant…' : 'Personne à ajouter'}</option>
					{candidates.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
				</select>
			</div>
			<div className='field'>
				Couleur
				<div className='swatches'>
					<button type='button' className='swatch cal-swatch-auto' aria-pressed={color === ''} title='Couleur du calendrier' onClick={() => setColor('')} />
					{ACCENTS.map((value) => (
						<button key={value} type='button' className='swatch' style={{ background: value }} aria-pressed={color === value} aria-label={value} onClick={() => setColor(value)} />
					))}
				</div>
			</div>
			<label className='field'>
				Description
				<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={4000} />
			</label>
			{error && <p className='notice notice-error'>{error}</p>}
			<div className='cal-actions'>
				<button type='button' className='btn btn-ghost' onClick={onCancel}>
					Annuler
				</button>
				<button type='submit' className='btn btn-primary' disabled={busy || !title.trim()}>
					{event ? 'Enregistrer' : 'Créer l’événement'}
				</button>
			</div>
		</form>
	);
}
