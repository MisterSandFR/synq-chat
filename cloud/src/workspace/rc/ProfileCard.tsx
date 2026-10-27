import { useRef } from 'react';

import { PRESENCE_LABEL, type Profile } from '../../../shared/rc';
import type { Grade, Member } from '../../../shared/types';
import { Avatar, Icon, useDismiss } from '../../ui';
import { memberColor, memberLabel } from '../grades';
import { StatusDot } from './status';
import { presenceOf } from './useRc';
import './rc.css';

type Props = {
	member: Member | undefined;
	profile: Profile | undefined;
	online: boolean;
	grades: Grade[];
	myId: string;
	rect: DOMRect;
	onClose: () => void;
	onEdit: () => void;
};

const localTime = (zone: string) => {
	try {
		return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(Date.now());
	} catch {
		return null;
	}
};

export function ProfileCard({ member, profile, online, grades, myId, rect, onClose, onEdit }: Props) {
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, true, onClose);
	const presence = presenceOf(profile, online);
	const label = memberLabel(member, grades);
	const time = profile?.timezone ? localTime(profile.timezone) : null;
	// Collée sous le nom cliqué, ramenée dans la fenêtre.
	const style = {
		left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
		top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 320)),
	};
	return (
		<div ref={ref} className='popover profile-card' role='dialog' aria-label={`Profil de ${member?.name ?? 'membre'}`} style={style}>
			<div className='profile-card-head'>
				<Avatar name={member?.name ?? '?'} url={member?.avatarUrl} size={56} />
				<div style={{ minWidth: 0 }}>
					<div className='profile-card-name ellipsis' style={{ color: memberColor(member, grades) }}>
						{member?.name ?? 'Ancien membre'}
					</div>
					{label && <span className='tag'>{label}</span>}
				</div>
			</div>
			<p className='profile-card-line'>
				<StatusDot presence={presence} />
				<span>{PRESENCE_LABEL[presence]}</span>
				{profile?.statusText && <span className='muted ellipsis'>· {profile.statusText}</span>}
			</p>
			{profile?.bio && <p className='profile-card-bio'>{profile.bio}</p>}
			{time && (
				<p className='profile-card-line muted'>
					<Icon name='clock' size={14} /> {time}, heure locale
				</p>
			)}
			{member?.id === myId && (
				<button type='button' className='btn' onClick={onEdit}>
					Modifier le profil
				</button>
			)}
		</div>
	);
}
