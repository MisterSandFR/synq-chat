import { useRef, useState, type DragEvent } from 'react';

import { Floating } from '../../floating';
import { DEFAULT_GRADE, P, PERMISSIONS, has } from '../../../shared/permissions';
import type { Grade, Member, WorkspaceDetail } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Avatar, Icon, useDismiss } from '../../ui';
import { canManageMember, canTouchGrade, memberColor, reorder } from '../grades';
import { Swatches } from './Swatches';
import './settings.css';

type Pane = 'display' | 'perms' | 'members';

type Props = { info: WorkspaceDetail; myId: string; onChanged: () => Promise<unknown> };

const fold = (text: string) =>
	text
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();

export function GradesTab({ info, myId, onChanged }: Props) {
	const ordered = [...info.grades].sort((a, b) => b.position - a.position);
	const movable = ordered.filter((g) => g.id !== DEFAULT_GRADE);
	const [selected, setSelected] = useState(() => (movable.find((g) => canTouchGrade(info, g)) ?? ordered[0])?.id ?? DEFAULT_GRADE);
	const [pane, setPane] = useState<Pane>('display');
	const [error, setError] = useState<string | null>(null);
	const [over, setOver] = useState<string | null>(null);
	const dragged = useRef<string | null>(null);
	const grade = info.grades.find((g) => g.id === selected) ?? ordered[0];
	const count = (g: Grade) => (g.id === DEFAULT_GRADE ? info.members.length : info.members.filter((m) => m.gradeIds.includes(g.id)).length);
	const canReorder = (g: Grade) => g.id !== DEFAULT_GRADE && canTouchGrade(info, g);

	const run = async (fn: () => Promise<unknown>) => {
		setError(null);
		try {
			await fn();
			return true;
		} catch (err) {
			setError(errorText(err));
			return false;
		}
	};

	const create = () =>
		run(async () => {
			const created = await api<Grade>('POST', `/w/${info.id}/grades`, { name: 'Nouveau grade', permissions: 0 });
			await onChanged();
			setSelected(created.id);
			setPane('display');
		});

	const drop = (target: Grade) => {
		const from = dragged.current;
		dragged.current = null;
		setOver(null);
		if (!from || from === target.id || !canReorder(target)) {
			return;
		}
		// L'API attend l'ordre du plus bas au plus haut.
		const ids = reorder(
			movable.map((g) => g.id),
			from,
			target.id,
		).reverse();
		void run(async () => {
			await api('PUT', `/w/${info.id}/grades/order`, { ids });
			await onChanged();
		});
	};

	const dragProps = (g: Grade) =>
		canReorder(g)
			? {
					draggable: true,
					onDragStart: (e: DragEvent) => {
						dragged.current = g.id;
						e.dataTransfer.effectAllowed = 'move';
						e.dataTransfer.setData('text/plain', g.id);
					},
					onDragOver: (e: DragEvent) => {
						if (dragged.current && dragged.current !== g.id) {
							e.preventDefault();
							setOver(g.id);
						}
					},
					onDragLeave: () => setOver((current) => (current === g.id ? null : current)),
					onDrop: (e: DragEvent) => {
						e.preventDefault();
						drop(g);
					},
					onDragEnd: () => {
						dragged.current = null;
						setOver(null);
					},
				}
			: {};

	return (
		<div className='roles'>
			<aside className='roles-side' aria-label='Grades'>
				<button type='button' className='btn' onClick={() => void create()}>
					<Icon name='plus' size={16} /> Créer un grade
				</button>
				<p className='field-hint'>Glisse pour ordonner. Les grades du haut l’emportent.</p>
				<ul className='roles-list'>
					{ordered.map((g) => (
						<li key={g.id} {...dragProps(g)}>
							<button
								type='button'
								className={`roles-item${over === g.id ? ' roles-item-over' : ''}`}
								aria-current={g.id === grade?.id}
								onClick={() => setSelected(g.id)}
							>
								<span className='grade-dot' style={{ background: g.color || 'var(--line-strong)' }} aria-hidden />
								<span className='ellipsis' style={{ color: g.color || undefined }}>
									{g.name}
								</span>
								<span className='roles-count' title={`${count(g)} membre${count(g) > 1 ? 's' : ''}`}>
									<Icon name='users' size={12} /> {count(g)}
								</span>
							</button>
						</li>
					))}
				</ul>
			</aside>
			{grade && (
				<section className='roles-main'>
					<div className='roles-head'>
						<h3 className='roles-title'>
							<span className='roles-title-label'>Modifier le grade</span>
							<span className='roles-title-name'>
								<span className='grade-dot' style={{ background: grade.color || 'var(--line-strong)' }} aria-hidden />
								<span className='ellipsis' title={grade.name}>
									{grade.name}
								</span>
							</span>
						</h3>
						<div className='tabs roles-tabs' role='tablist'>
							<button type='button' role='tab' className='tab' aria-selected={pane === 'display'} onClick={() => setPane('display')}>
								Affichage
							</button>
							<button type='button' role='tab' className='tab' aria-selected={pane === 'perms'} onClick={() => setPane('perms')}>
								Permissions
							</button>
							<button type='button' role='tab' className='tab' aria-selected={pane === 'members'} onClick={() => setPane('members')}>
								Membres <span className='roles-tab-count'>{count(grade)}</span>
							</button>
						</div>
					</div>
					{!canTouchGrade(info, grade) && <p className='notice'>Ce grade est égal ou supérieur au tien : lecture seule.</p>}
					{pane === 'members' ? (
						<GradeMembers info={info} grade={grade} myId={myId} run={run} onChanged={onChanged} />
					) : (
						<GradeForm key={`${grade.id}-${grade.name}-${grade.color}-${grade.permissions}`} info={info} grade={grade} pane={pane} run={run} onChanged={onChanged} />
					)}
					{error && <p className='notice notice-error'>{error}</p>}
				</section>
			)}
		</div>
	);
}

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;

function GradeForm({ info, grade, pane, run, onChanged }: { info: WorkspaceDetail; grade: Grade; pane: 'display' | 'perms'; run: Run; onChanged: () => Promise<unknown> }) {
	const [name, setName] = useState(grade.name);
	const [color, setColor] = useState(grade.color);
	const [perms, setPerms] = useState(grade.permissions);
	const [query, setQuery] = useState('');
	const editable = canTouchGrade(info, grade);
	const fullPower = info.owner || has(info.perms, P.ADMINISTRATOR);
	const dirty = name !== grade.name || color !== grade.color || perms !== grade.permissions;
	const needle = fold(query.trim());
	const shown = PERMISSIONS.filter((p) => !needle || fold(`${p.label} ${p.hint}`).includes(needle));
	const groups = [...new Set(shown.map((p) => p.group))];

	const reset = () => {
		setName(grade.name);
		setColor(grade.color);
		setPerms(grade.permissions);
	};

	return (
		<>
			{pane === 'display' ? (
				<div className='stack' style={{ gap: 20 }}>
					<label className='field'>
						Nom du grade
						<input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} disabled={!editable} />
					</label>
					<div className='field'>
						Couleur
						<span className='field-hint'>Les membres prennent la couleur de leur plus haut grade coloré.</span>
						<Swatches value={color} onPick={setColor} allowNone disabled={!editable} />
					</div>
					{editable && grade.id !== DEFAULT_GRADE && (
						<button
							type='button'
							className='btn btn-danger'
							style={{ alignSelf: 'flex-start' }}
							onClick={() =>
								window.confirm(`Supprimer le grade « ${grade.name} » ? Ses membres le perdent.`) &&
								void run(async () => {
									await api('DELETE', `/w/${info.id}/grades/${grade.id}`);
									await onChanged();
								})
							}
						>
							<Icon name='trash' size={16} /> Supprimer le grade
						</button>
					)}
				</div>
			) : (
				<div className='stack' style={{ gap: 8 }}>
					{grade.id === DEFAULT_GRADE && <p className='field-hint'>Permissions de base de tous les membres de l’espace.</p>}
					<div className='roles-tools'>
						<input type='search' value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Rechercher une permission' aria-label='Rechercher une permission' />
						<button type='button' className='btn btn-ghost' disabled={!editable || perms === 0} onClick={() => setPerms(0)}>
							Effacer les permissions
						</button>
					</div>
					{groups.length === 0 && <p className='muted'>Aucune permission ne correspond.</p>}
					{groups.map((group) => (
						<section key={group}>
							<h4 className='roles-group'>{group}</h4>
							{shown
								.filter((p) => p.group === group)
								.map((perm) => {
									const flag = P[perm.key];
									const allowed = editable && (fullPower || has(info.perms, flag));
									return (
										<label key={perm.key} className='role-perm'>
											<span className='role-perm-text'>
												<span className='role-perm-label'>{perm.label}</span>
												<span className='field-hint'>{perm.hint}</span>
											</span>
											<input
												type='checkbox'
												role='switch'
												className='role-switch'
												checked={has(perms, flag)}
												disabled={!allowed}
												onChange={(e) => setPerms(e.target.checked ? perms | flag : perms & ~flag)}
											/>
										</label>
									);
								})}
						</section>
					))}
				</div>
			)}
			{dirty && editable && (
				<div className='roles-savebar' role='status'>
					<span className='grow'>Modifications non enregistrées.</span>
					<button type='button' className='btn btn-ghost' onClick={reset}>
						Réinitialiser
					</button>
					<button
						type='button'
						className='btn btn-primary'
						onClick={() =>
							void run(async () => {
								await api('PATCH', `/w/${info.id}/grades/${grade.id}`, { name, color, permissions: perms });
								await onChanged();
							})
						}
					>
						Enregistrer
					</button>
				</div>
			)}
		</>
	);
}

function GradeMembers({ info, grade, myId, run, onChanged }: { info: WorkspaceDetail; grade: Grade; myId: string; run: Run; onChanged: () => Promise<unknown> }) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	if (grade.id === DEFAULT_GRADE) {
		return <p className='muted'>Tous les membres de l’espace ont ce grade.</p>;
	}
	const editable = canTouchGrade(info, grade);
	const holders = info.members.filter((m) => m.gradeIds.includes(grade.id)).sort((a, b) => a.name.localeCompare(b.name));
	const needle = fold(query.trim());
	const candidates = info.members.filter((m) => !m.gradeIds.includes(grade.id) && canManageMember(info, m, myId) && (!needle || fold(m.name).includes(needle)));
	const setGrades = (member: Member, gradeIds: string[]) =>
		run(async () => {
			await api('PUT', `/w/${info.id}/members/${member.id}/grades`, { gradeIds });
			await onChanged();
		});

	return (
		<div className='stack'>
			{editable && (
				<div ref={ref} className='roles-picker'>
					<button type='button' className='btn' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
						<Icon name='user-plus' size={16} /> Ajouter des membres
					</button>
					{open && (
						<Floating anchor={ref} placement='bottom-start' className='popover roles-picker-pop' role='menu'>
							<input type='search' value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Rechercher un membre' aria-label='Rechercher un membre' autoFocus />
							{candidates.length === 0 && <p className='muted' style={{ padding: 8, fontSize: 13 }}>Aucun membre à ajouter.</p>}
							{candidates.map((member) => (
								<button key={member.id} type='button' role='menuitem' className='menu-item' onClick={() => void setGrades(member, [...member.gradeIds, grade.id])}>
									<Avatar name={member.name} url={member.avatarUrl} size={22} />
									<span className='ellipsis'>{member.name}</span>
								</button>
							))}
						</Floating>
					)}
				</div>
			)}
			{holders.length === 0 ? (
				<p className='muted'>Personne n’a encore ce grade.</p>
			) : (
				<ul className='list'>
					{holders.map((member) => (
						<li key={member.id} className='list-row'>
							<Avatar name={member.name} url={member.avatarUrl} size={30} />
							<span className='grow ellipsis' style={{ fontWeight: 600, color: memberColor(member, info.grades) }}>
								{member.name}
								{member.id === myId && <span className='muted' style={{ fontWeight: 400 }}> (toi)</span>}
							</span>
							{editable && canManageMember(info, member, myId) && (
								<button
									type='button'
									className='icon-btn icon-btn-sm'
									aria-label={`Retirer ${grade.name} à ${member.name}`}
									title='Retirer du grade'
									onClick={() => void setGrades(member, member.gradeIds.filter((id) => id !== grade.id))}
								>
									<Icon name='close' size={16} />
								</button>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
