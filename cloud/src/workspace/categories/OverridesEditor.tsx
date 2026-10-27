import { useEffect, useMemo, useState } from 'react';

import { isMemberKey, memberKey } from '../../../shared/categories';
import { DEFAULT_GRADE, P, PERMISSIONS, has, type Override } from '../../../shared/permissions';
import type { Channel, ChannelOverrides, WorkspaceDetail } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Avatar } from '../../ui';
import './categories.css';

type State = 'deny' | 'inherit' | 'allow';

const STATES: Array<[State, string, string]> = [
	['deny', '✗', 'Refuser'],
	['inherit', '⧸', 'Hériter'],
	['allow', '✓', 'Autoriser'],
];

const stateOf = (override: Override | undefined, flag: number): State =>
	override && has(override.allow, flag) ? 'allow' : override && has(override.deny, flag) ? 'deny' : 'inherit';

const withState = (override: Override | undefined, flag: number, state: State): Override => {
	const base = override ?? { allow: 0, deny: 0 };
	return { allow: state === 'allow' ? base.allow | flag : base.allow & ~flag, deny: state === 'deny' ? base.deny | flag : base.deny & ~flag };
};

const CHANNEL_PERMS = PERMISSIONS.filter((p) => p.channel);

// Éditeur façon Discord : grades et membres à gauche, une ligne ✗ / ⧸ / ✓ par permission à droite.
export function OverridesEditor({ info, path }: { info: WorkspaceDetail; path: string }) {
	const [saved, setSaved] = useState<ChannelOverrides | null>(null);
	const [draft, setDraft] = useState<ChannelOverrides>({});
	const [subject, setSubject] = useState<string>(DEFAULT_GRADE);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let live = true;
		api<ChannelOverrides>('GET', path).then(
			(value) => {
				if (live) {
					setSaved(value);
					setDraft(value);
				}
			},
			(failure) => live && setError(errorText(failure)),
		);
		return () => {
			live = false;
		};
	}, [path]);

	const subjects = useMemo(() => {
		const keys = new Set([DEFAULT_GRADE, subject, ...Object.keys(draft)]);
		const grades = [...info.grades].sort((a, b) => b.position - a.position).filter((g) => g.id !== DEFAULT_GRADE && keys.has(g.id)).map((g) => g.id);
		return [...grades, ...[...keys].filter(isMemberKey), DEFAULT_GRADE];
	}, [draft, subject, info.grades]);

	const label = (key: string) =>
		isMemberKey(key)
			? (info.members.find((m) => memberKey(m.id) === key)?.name ?? 'Ancien membre')
			: key === DEFAULT_GRADE
				? 'Tout le monde'
				: (info.grades.find((g) => g.id === key)?.name ?? 'Grade supprimé');

	const update = (key: string, flag: number, state: State) => setDraft((current) => ({ ...current, [key]: withState(current[key], flag, state) }));

	const add = (key: string) => {
		setDraft((current) => ({ ...current, [key]: current[key] ?? { allow: 0, deny: 0 } }));
		setSubject(key);
	};

	const remove = (key: string) => {
		setDraft((current) => {
			const next = { ...current };
			delete next[key];
			return next;
		});
		setSubject(DEFAULT_GRADE);
	};

	const save = async () => {
		setBusy(true);
		try {
			const value = await api<ChannelOverrides>('PUT', path, { overrides: draft });
			setSaved(value);
			setDraft(value);
			setError(null);
		} catch (failure) {
			setError(errorText(failure));
		} finally {
			setBusy(false);
		}
	};

	if (!saved) {
		return error ? <p className='notice notice-error'>{error}</p> : <p className='muted'>Chargement…</p>;
	}

	const isPrivate = has(draft[DEFAULT_GRADE]?.deny ?? 0, P.VIEW_CHANNEL);
	const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
	const addableGrades = info.grades.filter((g) => g.id !== DEFAULT_GRADE && !subjects.includes(g.id));
	const addableMembers = info.members.filter((m) => !m.owner && !subjects.includes(memberKey(m.id)));

	return (
		<div className='stack'>
			<label className='ow-private'>
				<span className='grow'>
					<strong>Salon privé</strong>
					<span className='muted'>Seuls les grades et membres autorisés à voir le salon y ont accès.</span>
				</span>
				<input type='checkbox' role='switch' className='ow-switch' checked={isPrivate} onChange={(e) => update(DEFAULT_GRADE, P.VIEW_CHANNEL, e.target.checked ? 'deny' : 'inherit')} />
			</label>
			<div className='ow'>
				<div className='ow-subjects'>
					<ul className='ow-list'>
						{subjects.map((key) => {
							const member = isMemberKey(key) ? info.members.find((m) => memberKey(m.id) === key) : undefined;
							return (
								<li key={key}>
									<button type='button' className='ow-subject' aria-current={key === subject} onClick={() => setSubject(key)}>
										{isMemberKey(key) ? (
											<Avatar name={label(key)} url={member?.avatarUrl} size={20} />
										) : (
											<span className='ow-dot' style={{ background: info.grades.find((g) => g.id === key)?.color || 'var(--muted)' }} />
										)}
										<span className='grow ellipsis'>{label(key)}</span>
									</button>
								</li>
							);
						})}
					</ul>
					{addableGrades.length + addableMembers.length > 0 && (
						<select className='ow-add' value='' aria-label='Ajouter un grade ou un membre' onChange={(e) => e.target.value && add(e.target.value)}>
							<option value=''>Ajouter un grade ou un membre</option>
							{addableGrades.length > 0 && (
								<optgroup label='Grades'>
									{addableGrades.map((g) => (
										<option key={g.id} value={g.id}>
											{g.name}
										</option>
									))}
								</optgroup>
							)}
							{addableMembers.length > 0 && (
								<optgroup label='Membres'>
									{addableMembers.map((m) => (
										<option key={m.id} value={memberKey(m.id)}>
											{m.name}
										</option>
									))}
								</optgroup>
							)}
						</select>
					)}
				</div>
				<div className='ow-perms'>
					<div className='row'>
						<strong className='grow ellipsis'>{label(subject)}</strong>
						{subject !== DEFAULT_GRADE && (
							<button type='button' className='btn btn-ghost' onClick={() => remove(subject)}>
								Retirer
							</button>
						)}
					</div>
					<ul className='ow-rows'>
						{CHANNEL_PERMS.map((perm) => {
							const current = stateOf(draft[subject], P[perm.key]);
							return (
								<li key={perm.key} className='ow-row'>
									<span className='grow'>
										<span className='ow-label'>{perm.label}</span>
										<span className='muted ow-hint'>{perm.hint}</span>
									</span>
									<span className='ow-tri' role='radiogroup' aria-label={perm.label}>
										{STATES.map(([state, glyph, title]) => (
											<button
												key={state}
												type='button'
												role='radio'
												aria-checked={current === state}
												aria-label={title}
												title={title}
												className={`ow-btn ow-${state}`}
												onClick={() => update(subject, P[perm.key], state)}
											>
												{glyph}
											</button>
										))}
									</span>
								</li>
							);
						})}
					</ul>
				</div>
			</div>
			{error && <p className='notice notice-error'>{error}</p>}
			<div className='row' style={{ justifyContent: 'flex-end' }}>
				<button type='button' className='btn btn-ghost' disabled={!dirty || busy} onClick={() => setDraft(saved)}>
					Annuler les modifications
				</button>
				<button type='button' className='btn btn-primary' disabled={!dirty || busy} onClick={() => void save()}>
					Enregistrer
				</button>
			</div>
		</div>
	);
}

export function ChannelPermissions({ info, channel }: { info: WorkspaceDetail; channel: Channel }) {
	const [version, setVersion] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const sync = () =>
		api('POST', `/w/${info.id}/channels/${channel.id}/sync`).then(
			() => setVersion((v) => v + 1),
			(failure) => setError(errorText(failure)),
		);
	return (
		<div className='stack'>
			{channel.categoryId && (
				<div className='notice row'>
					<span className='grow'>{channel.synced ? `Synchronisé avec la catégorie ${channel.category}.` : `Permissions propres, différentes de la catégorie ${channel.category}.`}</span>
					{!channel.synced && (
						<button type='button' className='btn' onClick={() => void sync()}>
							Synchroniser avec la catégorie
						</button>
					)}
				</div>
			)}
			{error && <p className='notice notice-error'>{error}</p>}
			<OverridesEditor key={version} info={info} path={`/w/${info.id}/channels/${channel.id}/overrides`} />
		</div>
	);
}
