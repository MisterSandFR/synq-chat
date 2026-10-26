import type { Member, VoiceParticipant } from '../../shared/types';
import { Avatar, Icon } from '../ui';

type Props = {
	members: Member[];
	online: Set<string>;
	voice: Record<string, VoiceParticipant[]>;
	myId: string;
	onClose: () => void;
};

export function MembersPanel({ members, online, voice, myId, onClose }: Props) {
	const inVoice = new Set(Object.values(voice).flatMap((list) => list.map((p) => p.userId)));
	const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
	const groups: Array<[string, Member[]]> = [
		['En ligne', sorted.filter((m) => online.has(m.id))],
		['Hors ligne', sorted.filter((m) => !online.has(m.id))],
	];
	return (
		<aside className='side-panel' aria-label='Membres'>
			<header className='side-panel-head'>
				<h2>Membres</h2>
				<button type='button' className='icon-btn' aria-label='Fermer la liste des membres' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<div className='side-panel-body'>
				{groups.map(
					([label, list]) =>
						list.length > 0 && (
							<section key={label}>
								<h3 className='member-group'>
									{label} : {list.length}
								</h3>
								<ul className='list'>
									{list.map((member) => (
										<li key={member.id} className={`list-row${online.has(member.id) ? '' : ' member-offline'}`}>
											<Avatar name={member.name} url={member.avatarUrl} size={32} online={online.has(member.id)} />
											<span className='grow ellipsis'>
												{member.name}
												{member.id === myId && <span className='muted'> (toi)</span>}
											</span>
											{inVoice.has(member.id) && (
												<span className='muted' title='En vocal'>
													<Icon name='speaker' size={16} />
												</span>
											)}
											{member.role !== 'member' && <span className='tag'>{member.role === 'owner' ? 'Propriétaire' : 'Admin'}</span>}
										</li>
									))}
								</ul>
							</section>
						),
				)}
			</div>
		</aside>
	);
}
