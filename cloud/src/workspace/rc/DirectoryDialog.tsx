import { useMemo, useState } from 'react';

import type { Channel, Member } from '../../../shared/types';
import { Avatar, Dialog, Icon } from '../../ui';
import './rc.css';

type Props = {
	open: boolean;
	channels: Channel[];
	members: Member[];
	myId: string;
	onClose: () => void;
	onOpenChannel: (id: string) => void;
	onMessage: (userId: string) => void;
};

const matches = (q: string, ...values: string[]) => !q || values.some((v) => v.toLowerCase().includes(q));

// Salons visibles seulement : la visibilité suit les permissions, rejoindre revient à ouvrir.
export function DirectoryDialog({ open, channels, members, myId, onClose, onOpenChannel, onMessage }: Props) {
	const [tab, setTab] = useState<'channels' | 'members'>('channels');
	const [query, setQuery] = useState('');
	const q = query.trim().toLowerCase();
	const rooms = useMemo(() => channels.filter((c) => c.kind !== 'dm' && matches(q, c.name, c.topic)).sort((a, b) => a.name.localeCompare(b.name, 'fr')), [channels, q]);
	const people = useMemo(() => members.filter((m) => matches(q, m.name)).sort((a, b) => a.name.localeCompare(b.name, 'fr')), [members, q]);

	return (
		<Dialog open={open} onClose={onClose} title='Annuaire' wide>
			<div className='tabs' role='tablist'>
				<button type='button' role='tab' aria-selected={tab === 'channels'} className='tab' onClick={() => setTab('channels')}>
					Salons
				</button>
				<button type='button' role='tab' aria-selected={tab === 'members'} className='tab' onClick={() => setTab('members')}>
					Membres
				</button>
			</div>
			<label className='field'>
				<span className='sr-only'>Rechercher</span>
				<input type='search' value={query} placeholder={tab === 'channels' ? 'Chercher un salon' : 'Chercher un membre'} onChange={(e) => setQuery(e.target.value)} autoFocus />
			</label>
			<ul className='list directory-list'>
				{tab === 'channels' &&
					rooms.map((c) => (
						<li key={c.id} className='directory-item'>
							<Icon name={c.kind === 'voice' ? 'speaker' : 'hash'} size={18} />
							<span className='directory-main'>
								<strong className='ellipsis'>{c.name}</strong>
								{c.topic && <span className='muted ellipsis'>{c.topic}</span>}
							</span>
							<button
								type='button'
								className='btn btn-sm'
								onClick={() => {
									onOpenChannel(c.id);
									onClose();
								}}
							>
								Rejoindre
							</button>
						</li>
					))}
				{tab === 'members' &&
					people.map((m) => (
						<li key={m.id} className='directory-item'>
							<Avatar name={m.name} url={m.avatarUrl} size={28} />
							<span className='directory-main'>
								<strong className='ellipsis'>{m.name}</strong>
								{m.owner && <span className='muted'>Propriétaire</span>}
							</span>
							{m.id !== myId && (
								<button
									type='button'
									className='btn btn-sm'
									onClick={() => {
										onMessage(m.id);
										onClose();
									}}
								>
									Message
								</button>
							)}
						</li>
					))}
				{(tab === 'channels' ? rooms : people).length === 0 && <li className='muted rc-empty'>Aucun résultat.</li>}
			</ul>
		</Dialog>
	);
}
