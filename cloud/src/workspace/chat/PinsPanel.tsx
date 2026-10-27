import { useEffect, useState } from 'react';

import type { Channel, Message } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Avatar, Icon } from '../../ui';
import { RichText, type Lookup } from '../richText';
import './chat.css';

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

type Props = {
	workspaceId: string;
	channel: Channel;
	// Incrémenté à chaque épinglage diffusé dans le salon.
	version: number;
	lookup: Lookup;
	canPin: boolean;
	onJump: (id: number) => void;
	onClose: () => void;
};

export function PinsPanel({ workspaceId, channel, version, lookup, canPin, onJump, onClose }: Props) {
	const [pins, setPins] = useState<Message[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		api<Message[]>('GET', `/w/${workspaceId}/channels/${channel.id}/pins`)
			.then((list) => {
				if (live) {
					setPins(list);
					setError(null);
				}
			})
			.catch((err: unknown) => {
				if (live) {
					setError(errorText(err));
				}
			});
		return () => {
			live = false;
		};
	}, [workspaceId, channel.id, version]);

	const unpin = async (id: number) => {
		try {
			await api('DELETE', `/w/${workspaceId}/messages/${id}/pin`);
			setPins((list) => list?.filter((m) => m.id !== id) ?? null);
		} catch (err) {
			setError(errorText(err));
		}
	};

	return (
		<aside className='side-panel' aria-label='Messages épinglés'>
			<header className='side-panel-head'>
				<h2>Épinglés</h2>
				<button type='button' className='icon-btn' aria-label='Fermer les messages épinglés' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<div className='side-panel-body'>
				{error && <p className='notice notice-error'>{error}</p>}
				{!pins && !error && <div className='spinner' aria-busy />}
				{pins?.length === 0 && (
					<div className='pins-empty'>
						<Icon name='pin' size={22} />
						<p>Aucun message épinglé dans #{channel.name}.</p>
						<p className='muted'>Épingle un message depuis son menu pour le retrouver ici.</p>
					</div>
				)}
				{pins?.map((message) => {
					const author = lookup.members.get(message.userId);
					return (
						<article key={message.id} className='pin-card'>
							<header className='pin-head'>
								<Avatar name={author?.name ?? '?'} url={author?.avatarUrl} size={24} />
								<strong className='ellipsis'>{author?.name ?? 'Ancien membre'}</strong>
								<time dateTime={new Date(message.createdAt).toISOString()}>{when.format(message.createdAt)}</time>
								{canPin && (
									<button type='button' className='icon-btn icon-btn-sm' aria-label='Désépingler' title='Désépingler' onClick={() => void unpin(message.id)}>
										<Icon name='close' size={14} />
									</button>
								)}
							</header>
							<div className='pin-body msg-body'>{message.body ? <RichText text={message.body} lookup={lookup} /> : <span className='muted'>Fichier joint</span>}</div>
							<button type='button' className='pin-jump' onClick={() => onJump(message.id)}>
								Aller au message
							</button>
						</article>
					);
				})}
			</div>
		</aside>
	);
}
