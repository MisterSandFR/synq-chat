import { useEffect, useState, type FormEvent } from 'react';

import { DM_MAX_MEMBERS } from '../../../shared/dm-threads';
import type { Grade, Member } from '../../../shared/types';
import { errorText } from '../../api';
import { Dialog, Icon } from '../../ui';
import { GradeDot, PeoplePicker, gradeLabel } from '../grade-access/PeoplePicker';
import './dm-threads.css';

type Props = {
	open: boolean;
	members: Map<string, Member>;
	grades: Grade[];
	myId: string;
	online: Set<string>;
	onClose: () => void;
	onSubmit: (userIds: string[], name: string, gradeIds: string[]) => Promise<void>;
};

const MAX = DM_MAX_MEMBERS - 1;

export function NewDirectDialog({ open, members, grades, myId, online, onClose, onSubmit }: Props) {
	const [name, setName] = useState('');
	const [picked, setPicked] = useState<string[]>([]);
	const [gradeIds, setGradeIds] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setName('');
			setPicked([]);
			setGradeIds([]);
			setError(null);
		}
	}, [open]);

	const guest = members.get(myId)?.guest === true;
	const group = picked.length > 1 || gradeIds.length > 0;
	const empty = !picked.length && !gradeIds.length;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (empty || busy) {
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await onSubmit(picked, group ? name.trim() : '', gradeIds);
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onClose={onClose} title='Nouveau message'>
			<form onSubmit={submit}>
				<div className='field'>
					<span>Destinataires</span>
					<PeoplePicker
						autoFocus
						grades={guest ? [] : grades}
						members={[...members.values()].filter((m) => m.id !== myId && !m.guest)}
						everyone={[...members.values()]}
						online={online}
						pickedGrades={gradeIds}
						pickedMembers={picked}
						membersFull={picked.length >= MAX}
						onGrade={(id) => setGradeIds((current) => [...current, id])}
						onMember={(id) => setPicked((current) => (current.length < MAX ? [...current, id] : current))}
					/>
				</div>
				{!empty && (
					<div className='dm-chips'>
						{gradeIds.map((id) => {
							const grade = grades.find((g) => g.id === id);
							return (
								<button key={id} type='button' className='dm-chip' aria-label={`Retirer le grade ${gradeLabel(grade)}`} onClick={() => setGradeIds((current) => current.filter((x) => x !== id))}>
									<GradeDot grade={grade} />
									{gradeLabel(grade)}
									<Icon name='close' size={12} />
								</button>
							);
						})}
						{picked.map((id) => (
							<button key={id} type='button' className='dm-chip' aria-label={`Retirer ${members.get(id)?.name ?? 'ce membre'}`} onClick={() => setPicked((current) => current.filter((x) => x !== id))}>
								{members.get(id)?.name ?? 'Membre'}
								<Icon name='close' size={12} />
							</button>
						))}
					</div>
				)}
				{group && (
					<label className='field'>
						<span>Nom du groupe</span>
						<input maxLength={64} placeholder='Facultatif' value={name} onChange={(e) => setName(e.target.value)} />
					</label>
				)}
				<p className='field-hint'>
					{gradeIds.length > 0
						? 'Groupe ouvert à tous les porteurs des grades choisis, présents et futurs.'
						: `${group ? 'Conversation de groupe' : 'Conversation privée'}, ${MAX} personnes ajoutées une à une maximum.`}
				</p>
				{error && <p className='notice notice-error'>{error}</p>}
				<div className='dm-dialog-actions'>
					<button type='button' className='btn' onClick={onClose}>
						Annuler
					</button>
					<button type='submit' className='btn btn-primary' disabled={empty || busy}>
						Ouvrir la conversation
					</button>
				</div>
			</form>
		</Dialog>
	);
}
