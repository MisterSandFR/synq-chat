import { useState } from 'react';

import { Icon } from '../../ui';
import { excerpt, type Lookup } from '../richText';
import type { WorkspaceState } from '../useWorkspace';
import { DirectAvatar, directName, when } from './DirectAvatar';
import './dm-threads.css';

type Props = {
	state: WorkspaceState;
	lookup: Lookup;
	onOpen: (channelId: string) => void;
	onNew: () => void;
};

// Toutes les conversations directes, affichable dans la zone de contenu.
export function DirectMessagesView({ state, lookup, onOpen, onNew }: Props) {
	const [query, setQuery] = useState('');
	const { members, myId } = lookup;
	const all = state.dmThreads.dms;
	const needle = query.trim().toLowerCase();
	const dms = (all ?? []).filter((dm) => directName(dm, members, myId).toLowerCase().includes(needle));

	return (
		<section className='dm-view' aria-label='Messages directs'>
			<header className='dm-view-head'>
				<h2>Messages directs</h2>
				<button type='button' className='btn btn-primary' onClick={onNew}>
					<Icon name='compose' size={16} /> Nouveau message
				</button>
			</header>
			<label className='dm-search'>
				<Icon name='search' size={16} />
				<input type='search' placeholder='Rechercher une conversation' aria-label='Rechercher une conversation' value={query} onChange={(e) => setQuery(e.target.value)} />
			</label>
			{all === null ? (
				<div className='spinner' aria-busy />
			) : dms.length === 0 ? (
				<p className='dm-empty muted'>{needle ? 'Aucune conversation trouvée.' : 'Aucun message direct pour l’instant. Écris à un membre pour commencer.'}</p>
			) : (
				<ul className='dm-list'>
					{dms.map((dm) => {
						const unread = state.unread[dm.id] ?? 0;
						const last = dm.last;
						const at = last?.createdAt ?? dm.createdAt;
						return (
							<li key={dm.id}>
								<button type='button' className={`dm-row${unread > 0 ? ' dm-row-unread' : ''}`} onClick={() => onOpen(dm.id)}>
									<DirectAvatar conversation={dm} members={members} myId={myId} online={state.online} size={36} />
									<span className='dm-row-main'>
										<span className='dm-row-top'>
											<strong className='ellipsis'>{directName(dm, members, myId)}</strong>
											<time dateTime={new Date(at).toISOString()}>{when(at)}</time>
										</span>
										<span className='dm-row-last ellipsis'>
											{last ? `${last.userId === myId ? 'Toi : ' : ''}${excerpt(last.body, lookup, 120) || 'Fichier joint'}` : 'Aucun message'}
										</span>
									</span>
									{unread > 0 && <span className='pill'>{unread > 99 ? '99+' : unread}</span>}
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
