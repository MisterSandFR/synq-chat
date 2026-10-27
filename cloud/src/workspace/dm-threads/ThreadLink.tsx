import type { Message } from '../../../shared/types';
import { Icon } from '../../ui';
import { when } from './DirectAvatar';
import './dm-threads.css';

export function ThreadLink({ message, onOpen }: { message: Message; onOpen: (rootId: number) => void }) {
	const rootId = message.threadRoot;
	if (rootId) {
		return (
			<button type='button' className='thread-link thread-link-muted' onClick={() => onOpen(rootId)}>
				<Icon name='thread' size={14} /> Réponse dans un fil
			</button>
		);
	}
	const summary = message.thread;
	if (!summary?.count) {
		return null;
	}
	return (
		<button type='button' className='thread-link' onClick={() => onOpen(message.id)}>
			<Icon name='thread' size={14} />
			{summary.count} {summary.count > 1 ? 'réponses' : 'réponse'}
			<span className='muted'>Dernière : {when(summary.lastAt)}</span>
		</button>
	);
}
