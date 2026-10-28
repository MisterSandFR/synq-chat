import { useEffect, useState, type FormEvent } from 'react';

import { DM_MAX_MEMBERS, type GuestOutcome } from '../../../shared/dm-threads';
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
	onSubmit: (userIds: string[], name: string, gradeIds: string[], guestEmails: string[]) => Promise<GuestOutcome[]>;
};

const MAX = DM_MAX_MEMBERS - 1;

export function NewDirectDialog({ open, members, grades, myId, online, onClose, onSubmit }: Props) {
	const [name, setName] = useState('');
	const [picked, setPicked] = useState<string[]>([]);
	const [gradeIds, setGradeIds] = useState<string[]>([]);
	const [emails, setEmails] = useState<string[]>([]);
	const [outcomes, setOutcomes] = useState<GuestOutcome[] | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setName('');
			setPicked([]);
			setGradeIds([]);
			setEmails([]);
			setOutcomes(null);
			setCopied(null);
			setError(null);
		}
	}, [open]);

	const guest = members.get(myId)?.guest === true;
	const group = picked.length > 1 || gradeIds.length > 0 || emails.length > 0;
	const empty = !picked.length && !gradeIds.length && !emails.length;
	const full = picked.length + emails.length >= MAX;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (empty || busy) {
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const invited = await onSubmit(picked, group ? name.trim() : '', gradeIds, emails);
			if (invited.length) {
				setOutcomes(invited);
			}
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	const copy = async (link: string) => {
		try {
			await navigator.clipboard.writeText(link);
			setCopied(link);
		} catch {
			setError('Copie impossible : sélectionne le lien');
		}
	};

	if (outcomes) {
		return (
			<Dialog open={open} onClose={onClose} title='Prestataires invités'>
				<p className='field-hint'>Chaque lien ouvre seulement cette conversation, sans accès au reste de l’espace. Il expire dans 7 jours.</p>
				<ul className='dm-guest-links'>
					{outcomes.map((outcome) => (
						<li key={outcome.email}>
							<span className='dm-guest-email'>
								<strong className='ellipsis'>{outcome.email}</strong>
								<span className={outcome.link ? 'muted' : 'notice-error'}>{outcome.emailed ? 'Invitation envoyée par mail' : (outcome.error ?? 'Lien à transmettre')}</span>
							</span>
							{outcome.link && (
								<button type='button' className='btn' onClick={() => void copy(outcome.link!)}>
									<Icon name={copied === outcome.link ? 'check' : 'copy'} size={14} />
									{copied === outcome.link ? 'Copié' : 'Copier le lien'}
								</button>
							)}
						</li>
					))}
				</ul>
				{error && <p className='notice notice-error'>{error}</p>}
				<div className='dm-dialog-actions'>
					<button type='button' className='btn btn-primary' onClick={onClose}>
						Terminé
					</button>
				</div>
			</Dialog>
		);
	}

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
						membersFull={full}
						onGrade={(id) => setGradeIds((current) => [...current, id])}
						onMember={(id) => setPicked((current) => (current.length < MAX ? [...current, id] : current))}
						onEmail={guest ? undefined : (email) => setEmails((current) => (current.length + picked.length < MAX ? [...current, email] : current))}
						pickedEmails={emails}
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
						{emails.map((email) => (
							<button key={email} type='button' className='dm-chip dm-chip-guest' aria-label={`Retirer ${email}`} onClick={() => setEmails((current) => current.filter((x) => x !== email))}>
								<Icon name='mail' size={12} />
								{email}
								<span className='guest-badge'>Externe</span>
								<Icon name='close' size={12} />
							</button>
						))}
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
					{emails.length > 0
						? 'Les prestataires externes ne voient que cette conversation. Un lien d’invitation est créé pour chacun.'
						: gradeIds.length > 0
							? 'Groupe ouvert à tous les porteurs des grades choisis, présents et futurs.'
							: `${group ? 'Conversation de groupe' : 'Conversation privée'}, ${MAX} personnes ajoutées une à une maximum. Tape un email pour inviter un prestataire.`}
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
