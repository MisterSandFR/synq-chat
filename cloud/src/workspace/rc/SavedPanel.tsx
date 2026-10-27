import type { SavedMessage } from '../../../shared/rc';
import type { Message } from '../../../shared/types';
import { Icon } from '../../ui';
import { excerpt, type Lookup } from '../richText';
import './rc.css';

type Props = {
	saved: SavedMessage[];
	lookup: Lookup;
	onOpen: (channelId: string, id: number) => void;
	onRemove: (message: Message) => void;
	onClose: () => void;
};

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function SavedPanel({ saved, lookup, onOpen, onRemove, onClose }: Props) {
	return (
		<aside className='side-panel' aria-label='Messages enregistrés'>
			<header className='side-panel-head'>
				<h2>Enregistrés</h2>
				<button type='button' className='icon-btn' aria-label='Fermer les messages enregistrés' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<div className='side-panel-body'>
				{saved.length === 0 ? (
					<p className='muted rc-empty'>Aucun message enregistré. Survole un message et clique sur le signet pour le retrouver ici.</p>
				) : (
					<ul className='list'>
						{saved.map(({ message }) => {
							const channel = lookup.channels.find((c) => c.id === message.channelId);
							return (
								<li key={message.id} className='saved-item'>
									<button type='button' className='saved-open' onClick={() => onOpen(message.channelId, message.id)}>
										<span className='saved-meta'>
											<strong>{lookup.members.get(message.userId)?.name ?? 'Ancien membre'}</strong>
											<span className='muted ellipsis'>
												{channel ? `${channel.kind === 'text' ? '#' : ''}${channel.name}` : ''} · {when.format(message.createdAt)}
											</span>
										</span>
										<span className='saved-text'>{excerpt(message.body, lookup, 160) || 'Fichier joint'}</span>
									</button>
									<button
										type='button'
										className='icon-btn icon-btn-sm'
										aria-label='Retirer des enregistrés'
										title='Retirer'
										onClick={() => onRemove(message)}
									>
										<Icon name='close' size={14} />
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</aside>
	);
}
