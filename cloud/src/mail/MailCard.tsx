import type { MouseEvent } from 'react';

import type { MailCardRef } from '../../shared/mail';
import { navigate } from '../router';
import { Icon } from '../ui';
import './mail-card.css';

export function MailCard({ card }: { card: MailCardRef }) {
	const href = `/mail?thread=${encodeURIComponent(card.threadId)}`;
	const open = (event: MouseEvent) => {
		if (event.button === 0 && !event.metaKey && !event.ctrlKey) {
			event.preventDefault();
			navigate(href);
		}
	};
	return (
		<a className='mail-card' href={href} onClick={open}>
			<span className='mail-card-icon'>
				<Icon name='mail' size={18} />
			</span>
			<span className='mail-card-text'>
				<strong>{card.subject || '(sans objet)'}</strong>
				<span className='mail-card-from'>{card.from}</span>
				{card.snippet && <span className='mail-card-snippet'>{card.snippet}</span>}
			</span>
			<span className='mail-card-open'>Ouvrir dans Mail</span>
		</a>
	);
}
