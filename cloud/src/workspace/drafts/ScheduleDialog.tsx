import { useState } from 'react';

import { Dialog } from '../../ui';
import { dateField, fromFields, timeField, whenText } from './format';

type Props = {
	title: string;
	initial: number;
	submitLabel: string;
	onClose: () => void;
	onSubmit: (at: number) => Promise<void>;
};

export function ScheduleDialog({ title, initial, submitLabel, onClose, onSubmit }: Props) {
	const [date, setDate] = useState(() => dateField(initial));
	const [time, setTime] = useState(() => timeField(initial));
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const at = fromFields(date, time);
	const future = at !== null && at > Date.now();

	return (
		<Dialog open onClose={onClose} title={title}>
			<form
				className='schedule-form'
				onSubmit={(e) => {
					e.preventDefault();
					// Portail : sans ça, l'envoi remonte au formulaire du composer.
					e.stopPropagation();
					if (at === null || !future) {
						setError('Choisis une heure à venir.');
						return;
					}
					setBusy(true);
					setError(null);
					onSubmit(at)
						.then(onClose)
						.catch((err: unknown) => setError(err instanceof Error ? err.message : 'Programmation impossible.'))
						.finally(() => setBusy(false));
				}}
			>
				<div className='schedule-fields'>
					<label className='field'>
						<span>Date</span>
						<input type='date' value={date} min={dateField(Date.now())} required onChange={(e) => setDate(e.target.value)} />
					</label>
					<label className='field'>
						<span>Heure</span>
						<input type='time' value={time} required onChange={(e) => setTime(e.target.value)} />
					</label>
				</div>
				<p className={`schedule-preview${future ? '' : ' is-past'}`} aria-live='polite'>
					{at === null ? 'Choisis une date et une heure.' : future ? `Envoi ${whenText(at)}` : 'Cette heure est déjà passée.'}
				</p>
				{error && <p className='notice notice-error'>{error}</p>}
				<div className='schedule-actions'>
					<button type='button' className='btn btn-ghost' onClick={onClose}>
						Annuler
					</button>
					<button className='btn btn-primary' disabled={busy || !future}>
						{submitLabel}
					</button>
				</div>
			</form>
		</Dialog>
	);
}
