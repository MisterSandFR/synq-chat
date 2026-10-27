import { useEffect, useState } from 'react';

import type { FollowedThread } from '../../../shared/dm-threads';
import { api, errorText } from '../../api';
import { Avatar, Icon } from '../../ui';
import { excerpt, type Lookup } from '../richText';
import { when } from './DirectAvatar';
import './dm-threads.css';

type Props = {
	workspaceId: string;
	connId: string | null;
	lookup: Lookup;
	channelLabel: (channelId: string) => string;
	onOpen: (channelId: string, rootId: number) => void;
};

export function ThreadsView({ workspaceId, connId, lookup, channelLabel, onOpen }: Props) {
	const [threads, setThreads] = useState<FollowedThread[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!connId) {
			return;
		}
		let live = true;
		api<FollowedThread[]>('GET', `/w/${workspaceId}/threads`)
			.then((list) => live && setThreads(list))
			.catch((e: unknown) => live && setError(errorText(e)));
		return () => {
			live = false;
		};
	}, [workspaceId, connId]);

	return (
		<section className='dm-view' aria-label='Fils suivis'>
			<header className='dm-view-head'>
				<h2>Fils</h2>
			</header>
			<p className='muted dm-view-hint'>Les fils où tu as écrit et ceux que tu suis.</p>
			{error && <p className='notice notice-error'>{error}</p>}
			{threads === null ? (
				!error && <div className='spinner' aria-busy />
			) : threads.length === 0 ? (
				<p className='dm-empty muted'>Aucun fil suivi. Réponds dans un fil ou suis-le pour le retrouver ici.</p>
			) : (
				<ul className='dm-list'>
					{threads.map(({ root, unread }) => {
						const author = lookup.members.get(root.userId);
						const count = root.thread?.count ?? 0;
						const at = root.thread?.lastAt ?? root.createdAt;
						return (
							<li key={root.id}>
								<button type='button' className={`dm-row${unread > 0 ? ' dm-row-unread' : ''}`} onClick={() => onOpen(root.channelId, root.id)}>
									<Avatar name={author?.name ?? '?'} url={author?.avatarUrl} size={36} />
									<span className='dm-row-main'>
										<span className='dm-row-top'>
											<strong className='ellipsis'>{channelLabel(root.channelId)}</strong>
											<time dateTime={new Date(at).toISOString()}>{when(at)}</time>
										</span>
										<span className='dm-row-last ellipsis'>
											{author?.name ?? 'Ancien membre'} : {excerpt(root.body, lookup, 120) || 'Fichier joint'}
										</span>
										<span className='thread-card-meta'>
											<Icon name='thread' size={14} />
											{count} {count > 1 ? 'réponses' : 'réponse'}
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
