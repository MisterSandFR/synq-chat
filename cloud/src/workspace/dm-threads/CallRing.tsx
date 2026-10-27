import type { Member } from '../../../shared/types';
import { Avatar } from '../../ui';
import type { DmThreadsState } from './state';
import './dm-threads.css';

type Props = {
	ring: DmThreadsState['ring'];
	members: Map<string, Member>;
	label: (channelId: string) => string;
	onJoin: (channelId: string) => void;
	onDismiss: () => void;
};

export function CallRing({ ring, members, label, onJoin, onDismiss }: Props) {
	if (!ring) {
		return null;
	}
	const caller = members.get(ring.by);
	return (
		<div className='call-ring' role='alert'>
			<Avatar name={caller?.name ?? '?'} url={caller?.avatarUrl} size={28} />
			<span className='grow ellipsis'>
				<strong>{caller?.name ?? 'Quelqu’un'}</strong> lance un appel dans {label(ring.channelId)}
			</span>
			<button type='button' className='btn btn-primary' onClick={() => onJoin(ring.channelId)}>
				Rejoindre
			</button>
			<button type='button' className='btn' onClick={onDismiss}>
				Ignorer
			</button>
		</div>
	);
}
