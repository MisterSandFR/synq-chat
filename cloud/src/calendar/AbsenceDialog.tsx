import { useState, type CSSProperties, type FormEvent } from 'react';

import { ABSENCE_KINDS, fmtAbsenceDay, kindInfo, type Absence, type AbsenceInput, type AbsenceKind, type AbsencePerson, type DayPart, type Half } from '../../shared/absences';
import type { Me } from '../../shared/types';
import { api, errorText } from '../api';
import { Avatar, Dialog, Icon } from '../ui';

export type AbsenceDraft = { userId: string; day: string };

export const WEEKDAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const PART_TEXT: Record<DayPart, string> = { day: 'journée', am: 'matin', pm: 'après-midi' };

export const kindStyle = (kind: AbsenceKind | null) => ({ '--ab': `var(--ab-${kind ?? 'private'})` }) as CSSProperties;

export function spanText(a: Pick<Absence, 'startDay' | 'startHalf' | 'endDay' | 'endHalf' | 'weekdays'>): string {
	if (a.weekdays) {
		const days = WEEKDAY_NAMES.filter((_, i) => a.weekdays & (1 << i)).join(', ');
		const part: DayPart = a.startHalf === 'am' && a.endHalf === 'pm' ? 'day' : a.startHalf;
		const end = a.endDay ? `, jusqu’au ${fmtAbsenceDay(a.endDay)}` : '';
		return `Chaque ${days}${part === 'day' ? '' : ` (${PART_TEXT[part]})`}, depuis le ${fmtAbsenceDay(a.startDay)}${end}`;
	}
	const start = `${fmtAbsenceDay(a.startDay)}${a.startHalf === 'pm' ? ' après-midi' : ''}`;
	if (a.endDay === a.startDay) {
		const part: DayPart = a.startHalf === 'pm' ? 'pm' : a.endHalf === 'am' ? 'am' : 'day';
		return `Le ${fmtAbsenceDay(a.startDay)}, ${PART_TEXT[part]}`;
	}
	return `Du ${start} au ${fmtAbsenceDay(a.endDay ?? a.startDay)}${a.endHalf === 'am' ? ' midi' : ''}`;
}

type Props = { me: Me; people: AbsencePerson[]; absence?: Absence; draft?: AbsenceDraft; onClose: () => void; onChanged: () => void };

export function AbsenceDialog({ me, people, absence, draft, onClose, onChanged }: Props) {
	const [editing, setEditing] = useState(!absence);
	const person = people.find((p) => p.id === (absence?.userId ?? draft?.userId));
	const title = editing ? (absence ? 'Modifier l’absence' : 'Poser une absence') : (person?.name ?? 'Absence');
	const done = () => {
		onChanged();
		onClose();
	};
	return (
		<Dialog open onClose={onClose} title={title}>
			{editing || !absence ? (
				<AbsenceForm me={me} people={people} absence={absence} draft={draft ?? { userId: me.user.id, day: '' }} onCancel={absence ? () => setEditing(false) : onClose} onSaved={done} />
			) : (
				<AbsenceDetails absence={absence} person={person} onEdit={() => setEditing(true)} onDeleted={done} />
			)}
		</Dialog>
	);
}

function AbsenceDetails({ absence, person, onEdit, onDeleted }: { absence: Absence; person?: AbsencePerson; onEdit: () => void; onDeleted: () => void }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const info = kindInfo(absence.kind);
	const remove = async () => {
		setBusy(true);
		setError('');
		try {
			await api('DELETE', `/absences/${absence.id}`);
			onDeleted();
		} catch (e) {
			setError(errorText(e));
			setBusy(false);
		}
	};
	return (
		<div className='cal-details'>
			{person && (
				<p className='cal-detail'>
					<Avatar name={person.name} url={person.avatarUrl} size={24} />
					<strong>{person.name}</strong>
				</p>
			)}
			<p className='cal-detail' style={kindStyle(absence.kind)}>
				<span className='team-swatch' />
				{info.label}
				{absence.private && <span className='tag'>Privée</span>}
			</p>
			<p className='cal-detail'>
				<Icon name={absence.weekdays ? 'repeat' : 'calendar'} size={16} />
				{spanText(absence)}
			</p>
			{absence.note && <p className='cal-description'>{absence.note}</p>}
			{error && <p className='notice notice-error'>{error}</p>}
			{absence.canEdit && (
				<div className='cal-actions'>
					<button type='button' className='btn btn-danger' disabled={busy} onClick={() => void remove()}>
						<Icon name='trash' size={16} />
						Supprimer
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

type FormProps = { me: Me; people: AbsencePerson[]; absence?: Absence; draft: AbsenceDraft; onCancel: () => void; onSaved: () => void };

function AbsenceForm({ me, people, absence, draft, onCancel, onSaved }: FormProps) {
	const today = draft.day || new Date().toISOString().slice(0, 10);
	// Absence privée d'un autre : type et note restent cachés au gestionnaire.
	const masked = absence?.kind === null;
	const [userId, setUserId] = useState(absence?.userId ?? draft.userId);
	const [kind, setKind] = useState<AbsenceKind>(absence?.kind ?? 'leave');
	const [weekly, setWeekly] = useState(Boolean(absence?.weekdays));
	const [startDay, setStartDay] = useState(absence?.startDay ?? today);
	const [startHalf, setStartHalf] = useState<Half>(absence?.startHalf ?? 'am');
	const [endDay, setEndDay] = useState(absence?.endDay ?? (absence ? '' : today));
	const [endHalf, setEndHalf] = useState<Half>(absence?.endHalf ?? 'pm');
	const [weekdays, setWeekdays] = useState(absence?.weekdays || 1 << ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
	const [moment, setMoment] = useState<DayPart>(() => (absence && absence.startHalf === 'pm' ? 'pm' : absence && absence.endHalf === 'am' ? 'am' : 'day'));
	const [note, setNote] = useState(absence?.note ?? '');
	const [hidden, setHidden] = useState(absence?.private ?? false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const managed = people.filter((p) => p.canManage);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		const body: Partial<AbsenceInput> = weekly
			? { startDay, endDay: endDay || null, weekdays, startHalf: moment === 'pm' ? 'pm' : 'am', endHalf: moment === 'am' ? 'am' : 'pm' }
			: { startDay, startHalf, endDay: endDay || startDay, endHalf, weekdays: 0 };
		if (!masked) {
			Object.assign(body, { kind, note, private: hidden });
		}
		if (!absence) {
			body.userId = userId;
		}
		setBusy(true);
		setError('');
		try {
			await (absence ? api('PATCH', `/absences/${absence.id}`, body) : api('POST', '/absences', body));
			onSaved();
		} catch (err) {
			setError(errorText(err));
			setBusy(false);
		}
	};

	return (
		<form className='cal-form' onSubmit={(e) => void submit(e)}>
			{!absence && managed.length > 1 && (
				<label className='field'>
					Personne
					<select value={userId} onChange={(e) => setUserId(e.target.value)}>
						{managed.map((p) => (
							<option key={p.id} value={p.id}>
								{p.id === me.user.id ? `${p.name} (toi)` : p.name}
							</option>
						))}
					</select>
				</label>
			)}
			{!masked && (
				<fieldset className='team-kinds'>
					<legend>Type</legend>
					{ABSENCE_KINDS.map((k) => (
						<label key={k.value} className='team-kind' style={kindStyle(k.value)}>
							<input type='radio' name='kind' value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} />
							<span className='team-swatch' />
							{k.label}
						</label>
					))}
				</fieldset>
			)}
			<label className='check'>
				<input type='checkbox' checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
				Chaque semaine
			</label>
			{weekly ? (
				<>
					<div className='team-weekdays' role='group' aria-label='Jours de la semaine'>
						{WEEKDAY_LETTERS.map((letter, i) => (
							<button
								key={i}
								type='button'
								aria-pressed={Boolean(weekdays & (1 << i))}
								aria-label={WEEKDAY_NAMES[i]}
								// Au moins un jour reste coché.
								onClick={() => setWeekdays((w) => w ^ (1 << i) || w)}
							>
								{letter}
							</button>
						))}
					</div>
					<div className='cal-form-row'>
						<label className='field'>
							Moment
							<select value={moment} onChange={(e) => setMoment(e.target.value as DayPart)}>
								<option value='day'>Journée</option>
								<option value='am'>Matin</option>
								<option value='pm'>Après-midi</option>
							</select>
						</label>
						<span />
					</div>
					<div className='cal-form-row'>
						<label className='field'>
							À partir du
							<input type='date' value={startDay} onChange={(e) => setStartDay(e.target.value)} required />
						</label>
						<label className='field'>
							Jusqu’au (facultatif)
							<input type='date' value={endDay} min={startDay} onChange={(e) => setEndDay(e.target.value)} />
						</label>
					</div>
				</>
			) : (
				<>
					<div className='cal-form-row'>
						<label className='field'>
							Du
							<input type='date' value={startDay} onChange={(e) => (setStartDay(e.target.value), endDay < e.target.value && setEndDay(e.target.value))} required />
						</label>
						<label className='field'>
							<span className='sr-only'>Début</span>
							<select value={startHalf} onChange={(e) => setStartHalf(e.target.value as Half)}>
								<option value='am'>Dès le matin</option>
								<option value='pm'>Dès l’après-midi</option>
							</select>
						</label>
					</div>
					<div className='cal-form-row'>
						<label className='field'>
							Au
							<input type='date' value={endDay} min={startDay} onChange={(e) => setEndDay(e.target.value)} required />
						</label>
						<label className='field'>
							<span className='sr-only'>Fin</span>
							<select value={endHalf} onChange={(e) => setEndHalf(e.target.value as Half)}>
								<option value='pm'>Jusqu’au soir</option>
								<option value='am'>Jusqu’à midi</option>
							</select>
						</label>
					</div>
				</>
			)}
			{!masked && (
				<>
					<label className='field'>
						Note
						<textarea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} placeholder='Joignable par mail en cas d’urgence' />
					</label>
					<label className='check'>
						<input type='checkbox' checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
						Privée : les autres voient seulement « Absent »
					</label>
				</>
			)}
			{error && <p className='notice notice-error'>{error}</p>}
			<div className='cal-actions'>
				<button type='button' className='btn btn-ghost' onClick={onCancel}>
					Annuler
				</button>
				<button type='submit' className='btn btn-primary' disabled={busy}>
					{absence ? 'Enregistrer' : 'Poser l’absence'}
				</button>
			</div>
		</form>
	);
}
