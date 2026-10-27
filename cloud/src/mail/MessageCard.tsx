import { useRef, useState } from 'react';

import type { MailMessage } from '../../shared/mail';
import { Avatar, Icon, useDismiss } from '../ui';
import { Attachments } from './Attachments';
import { addressLabel, longDate, relativeDate } from './format';
import { MailBody } from './MailBody';

type Props = {
	message: MailMessage;
	expanded: boolean;
	canReply: boolean;
	onToggle: () => void;
	onReply: (message: MailMessage, all: boolean) => void;
	onForward: (message: MailMessage) => void;
};

export function MessageCard({ message, expanded, canReply, onToggle, onReply, onForward }: Props) {
	const [menu, setMenu] = useState(false);
	const [plain, setPlain] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);
	useDismiss(menuRef, menu, () => setMenu(false));
	const sender = message.fromName || message.fromAddr;
	const recipients = message.toList?.length ? message.toList.map(addressLabel).join(', ') : message.to;

	if (!expanded) {
		return (
			<button className='mail-fold' onClick={onToggle}>
				<Avatar name={sender} size={28} />
				<strong>{sender}</strong>
				<span className='mail-fold-text'>{message.body.replace(/\s+/g, ' ').slice(0, 160)}</span>
				<time>{relativeDate(message.date)}</time>
			</button>
		);
	}

	return (
		<article className={`mail-message mail-message-${message.direction}`}>
			<header className='mail-message-head'>
				<button className='mail-message-who' onClick={onToggle} title='Replier'>
					<Avatar name={sender} size={36} />
					<span>
						<strong>{sender}</strong>
						<span className='mail-message-to'>
							à {recipients}
							{message.ccList && message.ccList.length > 0 && `, cc ${message.ccList.map(addressLabel).join(', ')}`}
						</span>
					</span>
				</button>
				<time title={longDate(message.date)}>{relativeDate(message.date)}</time>
				<div className='mail-pop-anchor' ref={menuRef}>
					<button className='icon-btn icon-btn-sm' onClick={() => setMenu(!menu)} title='Plus' aria-label='Plus' aria-expanded={menu}>
						<Icon name='more' size={16} />
					</button>
					{menu && (
						<div className='popover mail-pop mail-pop-right'>
							{canReply && (
								<>
									<button className='menu-item' onClick={() => (setMenu(false), onReply(message, false))}>
										<Icon name='reply' size={16} />
										Répondre
									</button>
									<button className='menu-item' onClick={() => (setMenu(false), onReply(message, true))}>
										<Icon name='reply-all' size={16} />
										Répondre à tous
									</button>
									<button className='menu-item' onClick={() => (setMenu(false), onForward(message))}>
										<Icon name='forward' size={16} />
										Transférer
									</button>
								</>
							)}
							{message.hasHtml && (
								<button className='menu-item' onClick={() => (setMenu(false), setPlain(!plain))}>
									<Icon name='file' size={16} />
									{plain ? 'Afficher la mise en forme' : 'Afficher le texte brut'}
								</button>
							)}
							<a className='menu-item' href={`mailto:${message.fromAddr}`}>
								<Icon name='mail' size={16} />
								{message.fromAddr}
							</a>
						</div>
					)}
				</div>
			</header>
			<div className='mail-message-body'>
				<MailBody message={message} plain={plain} />
			</div>
			<Attachments messageId={message.id} attachments={message.attachments} />
			{canReply && (
				<footer className='mail-message-actions'>
					<button className='icon-btn icon-btn-sm' onClick={() => onReply(message, false)} title='Répondre' aria-label='Répondre'>
						<Icon name='reply' size={16} />
					</button>
					<button className='icon-btn icon-btn-sm' onClick={() => onForward(message)} title='Transférer' aria-label='Transférer'>
						<Icon name='forward' size={16} />
					</button>
				</footer>
			)}
		</article>
	);
}
