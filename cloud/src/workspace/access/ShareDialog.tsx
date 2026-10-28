import { useEffect, useRef, useState } from 'react';

import { ACCESS_LEVELS, LEVEL_HINTS, LEVEL_LABELS, levelRank, type AccessInfo, type AccessKind, type AccessLevel, type AccessRule, type AccessUpdate } from '../../../shared/access';
import { isMemberKey, memberKey } from '../../../shared/categories';
import { ADMIN_GRADE, DEFAULT_GRADE } from '../../../shared/permissions';
import type { Grade, Member, WorkspaceDetail } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Floating } from '../../floating';
import { Avatar, Dialog, Icon, useDismiss } from '../../ui';
import { GradeDot, PeoplePicker, gradeLabel, holderCount, plural } from '../grade-access/PeoplePicker';
import '../grade-access/grade-access.css';
import './access.css';

type Props = { workspaceId: string; kind: AccessKind; id: string; title: string; onClose: () => void; onChanged?: (info: AccessInfo) => void };

const NOUN: Record<AccessKind, string> = { page: 'Page', page_category: 'Catégorie', base: 'Base' };

// Les bases n'ont pas de commentaires.
const levelsFor = (kind: AccessKind) => (kind === 'base' ? ACCESS_LEVELS.filter((l) => l !== 'comment') : ACCESS_LEVELS);

function Meter({ level }: { level: AccessLevel | null }) {
	return (
		<span className='sh-meter' aria-hidden>
			{ACCESS_LEVELS.map((l, i) => (
				<i key={l} className={i < levelRank(level) ? 'on' : undefined} />
			))}
		</span>
	);
}

type Option = { key: string; label: string; hint?: string; level: AccessLevel | null };

function Picker({ value, options, label, disabled, onPick, onRemove }: { value: string; options: Option[]; label: string; disabled: boolean; onPick: (key: string) => void; onRemove?: () => void }) {
	const ref = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	useDismiss(ref, open, () => setOpen(false));
	const current = options.find((o) => o.key === value);
	return (
		<div ref={ref} className='sh-level'>
			<button type='button' className='btn btn-ghost sh-level-btn' disabled={disabled} aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<Meter level={current?.level ?? null} />
				<span className='ellipsis'>{label}</span>
				{!disabled && <Icon name='chevron' size={12} />}
			</button>
			{open && (
				<Floating anchor={ref} placement='bottom-end' className='popover' role='menu' style={{ width: 250 }}>
					{options.map((o) => (
						<button
							key={o.key}
							type='button'
							role='menuitemradio'
							aria-checked={o.key === value}
							className='menu-item sh-option'
							onClick={() => {
								setOpen(false);
								onPick(o.key);
							}}
						>
							<Meter level={o.level} />
							<span className='grow sh-option-text'>
								<span>{o.label}</span>
								{o.hint && <span className='sh-hint'>{o.hint}</span>}
							</span>
							{o.key === value && <Icon name='check' size={14} />}
						</button>
					))}
					{onRemove && (
						<>
							<div className='menu-sep' />
							<button
								type='button'
								role='menuitem'
								className='menu-item menu-item-danger'
								onClick={() => {
									setOpen(false);
									onRemove();
								}}
							>
								<Icon name='close' size={16} /> Retirer l’accès
							</button>
						</>
					)}
				</Floating>
			)}
		</div>
	);
}

// Dialogue « Partager » commun aux pages, catégories de pages et bases.
export function ShareDialog({ workspaceId, kind, id, title, onClose, onChanged }: Props) {
	const path = `/w/${workspaceId}/access/${kind}/${id}`;
	const [info, setInfo] = useState<AccessInfo | null>(null);
	const [grades, setGrades] = useState<Grade[]>([]);
	const [members, setMembers] = useState<Member[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let live = true;
		Promise.all([api<AccessInfo>('GET', path), api<WorkspaceDetail>('GET', `/w/${workspaceId}/info`)]).then(
			([access, detail]) => {
				if (live) {
					setInfo(access);
					setGrades(detail.grades);
					setMembers(detail.members);
				}
			},
			(failure) => live && setError(errorText(failure)),
		);
		return () => {
			live = false;
		};
	}, [path, workspaceId]);

	const save = async (body: AccessUpdate) => {
		setBusy(true);
		try {
			const next = await api<AccessInfo>('PUT', path, body);
			setInfo(next);
			setError(null);
			onChanged?.(next);
		} catch (failure) {
			setError(errorText(failure));
		} finally {
			setBusy(false);
		}
	};

	if (!info) {
		return (
			<Dialog open onClose={onClose} title={`Partager « ${title} »`}>
				{error ? <p className='notice notice-error'>{error}</p> : <p className='muted'>Chargement…</p>}
			</Dialog>
		);
	}

	const manage = info.level === 'manage' && !busy;
	const source = info.inherited;
	const channel = source?.kind === 'channel';
	// Hérité de l'espace : l'accès général équivaut à « Tout l'espace peut modifier ».
	const startRules = (): AccessRule[] => (info.own ? info.rules : source?.kind === 'space' ? [{ subjectId: DEFAULT_GRADE, level: 'edit' }] : info.rules);
	const write = (rules: AccessRule[], restricted = info.restricted) => void save({ restricted, rules });
	const upsert = (rules: AccessRule[], subjectId: string, level: AccessLevel) => [...rules.filter((r) => r.subjectId !== subjectId), { subjectId, level }];
	const drop = (rules: AccessRule[], subjectId: string) => rules.filter((r) => r.subjectId !== subjectId);

	const shown = info.own ? info.rules : startRules();
	const general = info.restricted ? null : (shown.find((r) => r.subjectId === DEFAULT_GRADE)?.level ?? null);
	const others = shown.filter((r) => r.subjectId !== DEFAULT_GRADE);
	const gradeRules = others.filter((r) => !isMemberKey(r.subjectId)).sort((a, b) => (grades.find((g) => g.id === b.subjectId)?.position ?? 0) - (grades.find((g) => g.id === a.subjectId)?.position ?? 0));
	const memberRules = others.filter((r) => isMemberKey(r.subjectId));
	const levelOptions: Option[] = levelsFor(kind).map((l) => ({ key: l, label: LEVEL_LABELS[l], hint: LEVEL_HINTS[l], level: l }));

	const generalOptions: Option[] = channel
		? [
				{ key: 'space', label: 'Membres du salon', hint: 'Droits du salon rattaché', level: 'edit' },
				{ key: 'restricted', label: 'Restreint', hint: 'Seules les personnes ajoutées', level: null },
			]
		: [
				...levelsFor(kind).map((l) => ({ key: l, label: `Tout l’espace : ${LEVEL_LABELS[l].toLowerCase()}`, hint: LEVEL_HINTS[l], level: l })),
				{ key: 'restricted', label: 'Restreint', hint: 'Seules les personnes ajoutées', level: null },
			];
	const generalKey = info.restricted ? 'restricted' : channel ? 'space' : (general ?? 'restricted');
	const pickGeneral = (key: string) => {
		const rules = startRules();
		if (key === 'restricted') {
			write(drop(rules, DEFAULT_GRADE), true);
		} else if (key === 'space') {
			write(rules, false);
		} else {
			write(upsert(rules, DEFAULT_GRADE, key as AccessLevel), false);
		}
	};

	const sourceLabel = !source
		? null
		: source.kind === 'space'
			? 'Hérité de l’espace'
			: source.kind === 'channel'
				? 'Hérité du salon rattaché'
				: `Hérité de ${source.kind === 'page' ? 'la page' : 'la catégorie'} « ${source.title} »`;
	const candidates = members.filter((m) => !m.owner);
	const nameOf = (key: string) => members.find((m) => memberKey(m.id) === key);

	return (
		<Dialog open onClose={onClose} title={`Partager « ${title} »`}>
			<div className='stack sh-dialog'>
				<div className={`sh-banner${info.own ? ' sh-banner-own' : ''}`}>
					<Icon name={info.own ? 'shield' : 'users'} size={16} />
					<span className='grow'>
						<strong>{info.own ? `${NOUN[kind]} avec des accès propres` : sourceLabel}</strong>
						<span className='muted'>{info.own ? 'Les règles ci-dessous remplacent l’héritage.' : 'Modifier un accès ici crée des accès propres.'}</span>
					</span>
					{info.level === 'manage' &&
						(info.own ? (
							<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => void save({ inherit: true })}>
								Revenir à l’héritage
							</button>
						) : (
							<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => write(startRules())}>
								Définir des accès propres
							</button>
						))}
				</div>

				<div className='sh-row sh-general'>
					<span className='ga-icon'>
						<Icon name={generalKey === 'restricted' ? 'shield' : 'users'} size={16} />
					</span>
					<span className='ga-name'>
						<span>Accès général</span>
						<span className='ga-via'>{generalKey === 'restricted' ? 'Propriétaire, administrateurs et personnes ajoutées' : channel ? 'Qui voit le salon' : 'Tous les membres, hors invités'}</span>
					</span>
					<Picker value={generalKey} options={generalOptions} label={generalOptions.find((o) => o.key === generalKey)?.label ?? 'Restreint'} disabled={!manage} onPick={pickGeneral} />
				</div>

				{info.level === 'manage' && (
					<PeoplePicker
						grades={grades.filter((g) => g.id !== DEFAULT_GRADE && g.id !== ADMIN_GRADE)}
						members={candidates}
						everyone={members}
						pickedGrades={gradeRules.map((r) => r.subjectId)}
						pickedMembers={memberRules.map((r) => r.subjectId.slice(1))}
						onGrade={(gradeId) => write(upsert(startRules(), gradeId, 'edit'))}
						onMember={(userId) => write(upsert(startRules(), memberKey(userId), 'edit'))}
					/>
				)}

				{others.length > 0 && <p className='ga-section'>Grades et personnes</p>}
				<ul className='ga-list'>
					{gradeRules.map((rule) => {
						const grade = grades.find((g) => g.id === rule.subjectId);
						return (
							<li key={rule.subjectId}>
								<span className='ga-icon'>
									<GradeDot grade={grade} />
								</span>
								<span className='ga-name'>
									<span className='ellipsis'>{gradeLabel(grade)}</span>
									<span className='ga-via'>Grade · {plural(holderCount(members, rule.subjectId))}</span>
								</span>
								<Picker
									value={rule.level}
									options={levelOptions}
									label={LEVEL_LABELS[rule.level]}
									disabled={!manage}
									onPick={(l) => write(upsert(startRules(), rule.subjectId, l as AccessLevel))}
									onRemove={() => write(drop(startRules(), rule.subjectId))}
								/>
							</li>
						);
					})}
					{memberRules.map((rule) => {
						const member = nameOf(rule.subjectId);
						return (
							<li key={rule.subjectId}>
								<Avatar name={member?.name ?? '?'} url={member?.avatarUrl} size={28} />
								<span className='ga-name'>
									<span className='ellipsis'>{member?.name ?? 'Ancien membre'}</span>
									<span className='ga-via'>{member?.guest ? 'Invité' : 'Membre'}</span>
								</span>
								<Picker
									value={rule.level}
									options={levelOptions}
									label={LEVEL_LABELS[rule.level]}
									disabled={!manage}
									onPick={(l) => write(upsert(startRules(), rule.subjectId, l as AccessLevel))}
									onRemove={() => write(drop(startRules(), rule.subjectId))}
								/>
							</li>
						);
					})}
				</ul>

				<p className='sh-count'>
					<strong>
						{info.count} personne{info.count > 1 ? 's ont' : ' a'} accès
					</strong>{' '}
					· le propriétaire et les administrateurs ont toujours un accès complet.
				</p>
				{info.level !== 'manage' && <p className='field-hint'>Ton accès : {LEVEL_LABELS[info.level].toLowerCase()}. Seul un accès complet permet de modifier le partage.</p>}
				{error && <p className='notice notice-error'>{error}</p>}
				<div className='ga-actions'>
					<span className='grow' />
					<button type='button' className='btn btn-primary' onClick={onClose}>
						Terminé
					</button>
				</div>
			</div>
		</Dialog>
	);
}
