import { useRef, useState } from 'react';

import { Floating } from '../floating';
import type { MailLevel, MailShareGrade } from '../../shared/mail';
import { DEFAULT_GRADE } from '../../shared/permissions';
import type { Grade, Member } from '../../shared/types';
import { Icon, useDismiss } from '../ui';

const LEVELS: Array<{ level: MailLevel; label: string; hint: string }> = [
	{ level: 'view', label: 'Lecture', hint: 'Lire les conversations et les pièces jointes.' },
	{ level: 'reply', label: 'Réponse', hint: 'Répondre, attribuer, changer le statut, annoter.' },
	{ level: 'manage', label: 'Gestion', hint: 'Régler ce partage : grades et salons.' },
];

export const reachText = (n: number) => (n === 0 ? 'Personne n’a accès' : `${n} personne${n > 1 ? 's ont' : ' a'} accès`);

// Aperçu avant enregistrement ; le serveur recompte ensuite.
export function reachOf(members: Member[], rules: MailShareGrade[], boxOwnerId: string): number {
	const ids = new Set(rules.map((rule) => rule.gradeId));
	return members.filter((m) => !m.guest && (m.owner || m.id === boxOwnerId || ids.has(DEFAULT_GRADE) || m.gradeIds.some((id) => ids.has(id)))).length;
}

function LevelMenu({ value, disabled, onChange }: { value: MailLevel; disabled?: boolean; onChange: (level: MailLevel) => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLButtonElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	const current = LEVELS.find((item) => item.level === value) ?? LEVELS[0]!;
	return (
		<>
			<button ref={ref} type='button' className='btn btn-ghost mail-level' disabled={disabled} aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				{current.label}
				{!disabled && <Icon name='chevron' size={14} />}
			</button>
			{open && (
				<Floating anchor={ref} placement='bottom-end' className='popover mail-level-menu' role='menu'>
					{LEVELS.map((item) => (
						<button
							key={item.level}
							type='button'
							role='menuitemradio'
							aria-checked={item.level === value}
							aria-selected={item.level === value}
							className='menu-item mail-level-item'
							onClick={() => {
								setOpen(false);
								if (item.level !== value) {
									onChange(item.level);
								}
							}}
						>
							<span>{item.label}</span>
							<small>{item.hint}</small>
						</button>
					))}
				</Floating>
			)}
		</>
	);
}

function GradePicker({ grades, counts, onPick }: { grades: Grade[]; counts: Map<string, number>; onPick: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLButtonElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	return (
		<>
			<button ref={ref} type='button' className='btn btn-ghost mail-grade-add' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<Icon name='plus' size={16} />
				Ajouter un grade
			</button>
			{open && (
				<Floating anchor={ref} placement='bottom-start' className='popover mail-level-menu' role='menu'>
					{grades.map((grade) => (
						<button
							key={grade.id}
							type='button'
							role='menuitem'
							className='menu-item mail-grade-option'
							onClick={() => {
								setOpen(false);
								onPick(grade.id);
							}}
						>
							<span className='grade-dot' style={{ background: grade.color || 'var(--line-strong)' }} aria-hidden />
							<span>{grade.id === DEFAULT_GRADE ? 'Tout le monde' : grade.name}</span>
							<small>{grade.id === DEFAULT_GRADE ? 'Tous les membres' : `${counts.get(grade.id) ?? 0}`}</small>
						</button>
					))}
				</Floating>
			)}
		</>
	);
}

export function ShareGrades({ grades, members, rules, disabled, onChange }: { grades: Grade[]; members: Member[]; rules: MailShareGrade[]; disabled?: boolean; onChange: (rules: MailShareGrade[]) => void }) {
	const byId = new Map(grades.map((grade) => [grade.id, grade]));
	const position = (id: string) => byId.get(id)?.position ?? -1;
	const shown = [...rules].sort((a, b) => position(b.gradeId) - position(a.gradeId));
	const free = grades.filter((grade) => !rules.some((rule) => rule.gradeId === grade.id));
	const counts = new Map<string, number>();
	for (const member of members) {
		for (const id of member.guest ? [] : member.gradeIds) {
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
	}
	return (
		<div className='mail-grades'>
			{shown.length === 0 && <p className='field-hint'>Aucun grade : seuls le propriétaire de la boîte et les administrateurs de l’espace l’ouvrent.</p>}
			{shown.map((rule) => {
				const grade = byId.get(rule.gradeId);
				// Même libellé que pour les salons et les groupes.
				const name = rule.gradeId === DEFAULT_GRADE ? 'Tout le monde' : (grade?.name ?? 'Grade');
				return (
					<div key={rule.gradeId} className='mail-grade-row'>
						<span className='grade-dot' style={{ background: grade?.color || 'var(--line-strong)' }} aria-hidden />
						<span className='mail-grade-name'>
							{name}
						</span>
						<LevelMenu value={rule.level} disabled={disabled} onChange={(level) => onChange(rules.map((item) => (item.gradeId === rule.gradeId ? { ...item, level } : item)))} />
						{!disabled && (
							<button type='button' className='icon-btn' title='Retirer' aria-label={`Retirer ${name}`} onClick={() => onChange(rules.filter((item) => item.gradeId !== rule.gradeId))}>
								<Icon name='close' size={16} />
							</button>
						)}
					</div>
				);
			})}
			{!disabled && free.length > 0 && <GradePicker grades={free} counts={counts} onPick={(id) => onChange([...rules, { gradeId: id, level: 'view' }])} />}
		</div>
	);
}
