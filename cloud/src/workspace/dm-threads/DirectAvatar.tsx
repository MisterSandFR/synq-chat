import type { DirectConversation } from '../../../shared/dm-threads';
import type { Channel, Member } from '../../../shared/types';
import { Avatar, Icon } from '../../ui';

const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

export const when = (ts: number) => (new Date(ts).toDateString() === new Date().toDateString() ? timeFormat.format(ts) : dayFormat.format(ts));

export const directOthers = (conversation: DirectConversation, myId: string) => conversation.memberIds.filter((id) => id !== myId);

export function directName(conversation: DirectConversation, members: Map<string, Member>, myId: string): string {
	return (
		conversation.name ||
		directOthers(conversation, myId)
			.map((id) => members.get(id)?.name ?? 'Ancien membre')
			.join(', ') || 'Message direct'
	);
}

export function channelLabel(channel: Channel | undefined, dms: DirectConversation[] | null, members: Map<string, Member>, myId: string): string {
	if (!channel) {
		return 'Salon supprimé';
	}
	if (channel.kind !== 'dm') {
		return channel.kind === 'voice' ? channel.name : `#${channel.name}`;
	}
	const dm = dms?.find((d) => d.id === channel.id);
	return dm ? directName(dm, members, myId) : 'Message direct';
}

type Props = { conversation: DirectConversation; members: Map<string, Member>; myId: string; online: Set<string>; size: number };

export function DirectAvatar({ conversation, members, myId, online, size }: Props) {
	const others = directOthers(conversation, myId);
	const single = others.length === 1 ? others[0] : undefined;
	if (single) {
		const member = members.get(single);
		return <Avatar name={member?.name ?? '?'} url={member?.avatarUrl} size={size} online={online.has(single)} />;
	}
	return (
		<span className='avatar avatar-square dm-group-avatar' style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.42)) }} aria-hidden>
			{others.length || <Icon name='users' size={Math.round(size * 0.55)} />}
		</span>
	);
}
