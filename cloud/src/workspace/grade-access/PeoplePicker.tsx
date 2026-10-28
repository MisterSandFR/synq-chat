import { useRef, useState } from 'react';

import { DEFAULT_GRADE } from '../../../shared/permissions';
import type { Grade, Member } from '../../../shared/types';
import { Floating } from '../../floating';
import { Avatar, Icon } from '../../ui';
import './grade-access.css';

export const gradeLabel = (grade: Grade | undefined) => (!grade ? 'Grade supprimé' : grade.id === DEFAULT_GRADE ? 'Tout le monde' : grade.name);

// Le grade `default` vaut pour tout membre, jamais pour un invité.
export const holdsGrade = (member: Member | undefined, gradeId: string) => !!member && !member.guest && (gradeId === DEFAULT_GRADE || member.gradeIds.includes(gradeId));

export const holderCount = (members: Iterable<Member>, gradeId: string) => [...members].filter((m) => holdsGrade(m, gradeId)).length;

const plural = (n: number) => `${n} membre${n > 1 ? 's' : ''}`;

export function GradeDot({ grade }: { grade: Grade | undefined }) {
	return <span className='ga-dot' style={{ background: grade?.color || 'var(--muted)' }} />;
}

type Props = {
	grades: Grade[];
	// Candidats déjà filtrés par l'appelant (soi, propriétaire, invités).
	members: Member[];
	// Tous les membres, pour compter les porteurs.
	everyone: Member[];
	online?: Set<string>;
	pickedGrades: string[];
	pickedMembers: string[];
	membersFull?: boolean;
	autoFocus?: boolean;
	onGrade: (id: string) => void;
	onMember: (id: string) => void;
};

// Sélecteur unique : grades d'abord, puis membres, filtrés par la recherche.
export function PeoplePicker({ grades, members, everyone, online, pickedGrades, pickedMembers, membersFull = false, autoFocus, onGrade, onMember }: Props) {
	const anchor = useRef<HTMLSpanElement>(null);
	const [query, setQuery] = useState('');
	const [open, setOpen] = useState(false);
	const needle = query.trim().toLowerCase();
	const gradeHits = grades.filter((g) => !pickedGrades.includes(g.id) && gradeLabel(g).toLowerCase().includes(needle)).sort((a, b) => b.position - a.position);
	const memberHits = members.filter((m) => !pickedMembers.includes(m.id) && m.name.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name));

	const pick = (select: () => void) => {
		select();
		setQuery('');
	};

	return (
		<div className='ga-picker'>
			<span ref={anchor} className='ga-search'>
				<Icon name='search' size={16} />
				<input
					type='search'
					role='combobox'
					aria-expanded={open}
					aria-label='Ajouter des personnes'
					placeholder={grades.length ? 'Ajouter des personnes ou un grade' : 'Ajouter des personnes'}
					autoFocus={autoFocus}
					value={query}
					onChange={(e) => {
						setQuery(e.target.value);
						setOpen(true);
					}}
					onFocus={() => setOpen(true)}
					onClick={() => setOpen(true)}
					onBlur={() => setOpen(false)}
					onKeyDown={(e) => {
						if (e.key === 'Escape' && open) {
							e.preventDefault();
							e.stopPropagation();
							setOpen(false);
						}
					}}
				/>
			</span>
			{open && (
				// Clic dans la liste : le champ garde le focus, la liste reste ouverte.
				<Floating anchor={anchor} matchWidth className='popover ga-menu' role='listbox' onMouseDown={(e) => e.preventDefault()}>
					{gradeHits.length > 0 && <p className='ga-group'>Grades</p>}
					{gradeHits.map((grade) => (
						<button key={grade.id} type='button' role='option' aria-selected={false} className='menu-item ga-option' onClick={() => pick(() => onGrade(grade.id))}>
							<GradeDot grade={grade} />
							<span className='grow ellipsis'>{gradeLabel(grade)}</span>
							<span className='ga-count'>{plural(holderCount(everyone, grade.id))}</span>
						</button>
					))}
					{memberHits.length > 0 && <p className='ga-group'>Membres</p>}
					{memberHits.map((member) => (
						<button
							key={member.id}
							type='button'
							role='option'
							aria-selected={false}
							className='menu-item ga-option'
							disabled={membersFull}
							title={membersFull ? 'Nombre maximum de personnes ajoutées une à une atteint' : undefined}
							onClick={() => pick(() => onMember(member.id))}
						>
							<Avatar name={member.name} url={member.avatarUrl} size={24} online={online?.has(member.id)} />
							<span className='grow ellipsis'>{member.name}</span>
						</button>
					))}
					{gradeHits.length + memberHits.length === 0 && <p className='muted ga-empty'>Aucun résultat.</p>}
				</Floating>
			)}
		</div>
	);
}
