import type { Grade, Member, VoiceParticipant } from '../../shared/types';
import { Avatar, Icon } from '../ui';
import { memberColor, memberGrades } from './grades';

type Props = {
	members: Member[];
	grades: Grade[];
	online: Set<string>;
	voice: Record<string, VoiceParticipant[]>;
	myId: string;
	onMessage?: (userId: string) => void;
	onClose: () => void;
};

// Membres en ligne rangés sous leur plus haut grade, comme une liste TeamSpeak ; hors ligne à part.
export function MembersPanel({ members, grades, online, voice, myId, onMessage, onClose }: Props) {
	const inVoice = new Set(Object.values(voice).flatMap((list) => list.map((p) => p.userId)));
	const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
	const groups = new Map<string, { label: string; color?: string; order: number; list: Member[] }>();
	for (const member of sorted.filter((m) => online.has(m.id))) {
		const top = member.owner ? null : memberGrades(member, grades)[0];
		const key = member.owner ? 'owner' : (top?.id ?? 'default');
		const group = groups.get(key) ?? {
			label: member.owner ? 'Propriétaire' : (top?.name ?? 'En ligne'),
			color: top?.color || undefined,
			order: member.owner ? Number.MAX_SAFE_INTEGER : (top?.position ?? -1),
			list: [],
		};
		group.list.push(member);
		groups.set(key, group);
	}
	const offline = sorted.filter((m) => !online.has(m.id));
	const sections = [...groups.values()].sort((a, b) => b.order - a.order);
	if (offline.length) {
		sections.push({ label: 'Hors ligne', order: -2, list: offline });
	}
	return (
		<aside className='side-panel' aria-label='Membres'>
			<header className='side-panel-head'>
				<h2>Membres</h2>
				<button type='button' className='icon-btn' aria-label='Fermer la liste des membres' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<div className='side-panel-body'>
				{sections.map((section) => (
					<section key={section.label}>
						<h3 className='member-group' style={section.color ? { color: section.color } : undefined}>
							{section.label} : {section.list.length}
						</h3>
						<ul className='list'>
							{section.list.map((member) => (
								<li key={member.id} className={`list-row${online.has(member.id) ? '' : ' member-offline'}`}>
									<Avatar name={member.name} url={member.avatarUrl} size={32} online={online.has(member.id)} />
									<span className='grow ellipsis' style={{ color: memberColor(member, grades) }}>
										{member.name}
										{member.id === myId && <span className='muted'> (toi)</span>}
									</span>
									{inVoice.has(member.id) && (
										<span className='muted' title='En vocal'>
											<Icon name='speaker' size={16} />
										</span>
									)}
									{onMessage && member.id !== myId && (
										<button type='button' className='icon-btn icon-btn-sm member-dm' aria-label={`Message direct à ${member.name}`} title='Message direct' onClick={() => onMessage(member.id)}>
											<Icon name='chat' size={16} />
										</button>
									)}
								</li>
							))}
						</ul>
					</section>
				))}
			</div>
		</aside>
	);
}
