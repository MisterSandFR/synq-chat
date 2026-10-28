import { useEffect, useState } from 'react';

import { isMemberKey, memberKey } from '../../../shared/categories';
import { ADMIN_GRADE, DEFAULT_GRADE, P, has, type Override } from '../../../shared/permissions';
import type { Channel, ChannelOverrides, WorkspaceDetail } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Avatar, Dialog, Icon } from '../../ui';
import { ChannelPermissions } from '../categories/OverridesEditor';
import { GradeDot, PeoplePicker, gradeLabel, holderCount, plural } from './PeoplePicker';
import './grade-access.css';

type Props = { info: WorkspaceDetail; channel: Channel; onClose: () => void };

const EMPTY: Override = { allow: 0, deny: 0 };

// Ouvrir un salon à un sujet = le voir et y participer.
const grantOf = (channel: Channel) => P.VIEW_CHANNEL | P.SEND_MESSAGES | (channel.kind === 'voice' ? P.VOICE_CONNECT : 0);

// Vue simple au-dessus des surcharges : salon privé, liste « Ont accès », ajout en un clic.
export function AccessDialog({ info, channel, onClose }: Props) {
	const path = `/w/${info.id}/channels/${channel.id}/overrides`;
	const [overrides, setOverrides] = useState<ChannelOverrides | null>(null);
	const [advanced, setAdvanced] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (advanced) {
			return;
		}
		let live = true;
		api<ChannelOverrides>('GET', path).then(
			(value) => live && setOverrides(value),
			(failure) => live && setError(errorText(failure)),
		);
		return () => {
			live = false;
		};
	}, [path, advanced]);

	const grant = grantOf(channel);

	const save = async (key: string, change: (o: Override) => Override) => {
		if (!overrides || busy) {
			return;
		}
		setBusy(true);
		try {
			setOverrides(await api<ChannelOverrides>('PUT', path, { overrides: { ...overrides, [key]: change(overrides[key] ?? EMPTY) } }));
			setError(null);
		} catch (failure) {
			setError(errorText(failure));
		} finally {
			setBusy(false);
		}
	};

	const add = (key: string) => void save(key, (o) => ({ allow: o.allow | grant, deny: o.deny & ~grant }));
	const remove = (key: string) => void save(key, (o) => ({ allow: o.allow & ~grant, deny: o.deny }));

	if (advanced) {
		return (
			<Dialog open onClose={onClose} title={`Permissions de ${channel.name}`} wide>
				<div className='stack'>
					<div>
						<button type='button' className='btn btn-ghost' onClick={() => setAdvanced(false)}>
							<Icon name='reply' size={16} /> Retour à l’accès
						</button>
					</div>
					<ChannelPermissions info={info} channel={channel} />
				</div>
			</Dialog>
		);
	}

	const isPrivate = has(overrides?.[DEFAULT_GRADE]?.deny ?? 0, P.VIEW_CHANNEL);
	const keys = Object.entries(overrides ?? {})
		.filter(([key, o]) => key !== DEFAULT_GRADE && has(o.allow, P.VIEW_CHANNEL))
		.map(([key]) => key);
	const gradeKeys = keys.filter((key) => !isMemberKey(key)).sort((a, b) => (info.grades.find((g) => g.id === b)?.position ?? 0) - (info.grades.find((g) => g.id === a)?.position ?? 0));
	const memberKeys = keys.filter(isMemberKey);
	const candidates = info.members.filter((m) => !m.owner && !m.guest);

	return (
		<Dialog open onClose={onClose} title={`Accès à ${channel.kind === 'voice' ? channel.name : `#${channel.name}`}`}>
			{!overrides ? (
				error ? <p className='notice notice-error'>{error}</p> : <p className='muted'>Chargement…</p>
			) : (
				<div className='stack'>
					<label className='ow-private'>
						<span className='grow'>
							<strong>Salon privé</strong>
							<span className='muted'>Seuls les grades et membres ajoutés ci-dessous voient le salon.</span>
						</span>
						<input
							type='checkbox'
							role='switch'
							className='ow-switch'
							checked={isPrivate}
							disabled={busy}
							onChange={(e) => {
								const on = e.target.checked;
								void save(DEFAULT_GRADE, (o) => (on ? { allow: o.allow & ~P.VIEW_CHANNEL, deny: o.deny | P.VIEW_CHANNEL } : { allow: o.allow, deny: o.deny & ~P.VIEW_CHANNEL }));
							}}
						/>
					</label>
					<PeoplePicker
						grades={info.grades.filter((g) => g.id !== DEFAULT_GRADE && g.id !== ADMIN_GRADE)}
						members={candidates}
						everyone={info.members}
						pickedGrades={gradeKeys}
						pickedMembers={memberKeys.map((key) => key.slice(1))}
						onGrade={add}
						onMember={(id) => add(memberKey(id))}
					/>
					<p className='ga-section'>Ont accès</p>
					<ul className='ga-list'>
						{!isPrivate && (
							<li>
								<span className='ga-icon'>
									<Icon name='users' size={16} />
								</span>
								<span className='ga-name'>
									<span>Tout le monde</span>
									<span className='ga-via'>Tous les membres de l’espace</span>
								</span>
							</li>
						)}
						{gradeKeys.map((key) => {
							const grade = info.grades.find((g) => g.id === key);
							return (
								<li key={key}>
									<span className='ga-icon'>
										<GradeDot grade={grade} />
									</span>
									<span className='ga-name'>
										<span className='ellipsis'>{gradeLabel(grade)}</span>
										<span className='ga-via'>Grade · {plural(holderCount(info.members, key))}</span>
									</span>
									<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => remove(key)}>
										Retirer
									</button>
								</li>
							);
						})}
						{memberKeys.map((key) => {
							const member = info.members.find((m) => memberKey(m.id) === key);
							return (
								<li key={key}>
									<Avatar name={member?.name ?? '?'} url={member?.avatarUrl} size={28} />
									<span className='ga-name'>
										<span className='ellipsis'>{member?.name ?? 'Ancien membre'}</span>
										<span className='ga-via'>Membre</span>
									</span>
									<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => remove(key)}>
										Retirer
									</button>
								</li>
							);
						})}
						{isPrivate && keys.length === 0 && <li className='muted'>Personne d’autre que les administrateurs.</li>}
					</ul>
					<p className='field-hint'>Le propriétaire et les administrateurs ont toujours accès. Qui reçoit un grade plus tard obtient l’accès, qui le perd le perd.</p>
					{error && <p className='notice notice-error'>{error}</p>}
					<div className='ga-actions'>
						<button type='button' className='btn btn-ghost' onClick={() => setAdvanced(true)}>
							<Icon name='settings' size={16} /> Permissions avancées
						</button>
						<button type='button' className='btn btn-primary' onClick={onClose}>
							Terminé
						</button>
					</div>
				</div>
			)}
		</Dialog>
	);
}
