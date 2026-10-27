import { useRef, useState } from 'react';

import type { MailMessage, MailTranslateInput } from '../../shared/mail';
import type { AiTextResult } from '../../shared/ai';
import { api } from '../api';
import { Avatar, Icon, useDismiss } from '../ui';
import { Attachments } from './Attachments';
import { addressLabel, longDate, relativeDate } from './format';
import { MailBody } from './MailBody';
import { aiErrorText } from './Summary';

type Translation = { lang: MailTranslateInput['lang']; text: string | null; error: string | null; original: boolean };

const LANGS: Record<MailTranslateInput['lang'], string> = { fr: 'français', en: 'anglais' };

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
	const [translation, setTranslation] = useState<Translation | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	useDismiss(menuRef, menu, () => setMenu(false));
	const sender = message.fromName || message.fromAddr;
	const recipients = message.toList?.length ? message.toList.map(addressLabel).join(', ') : message.to;

	const translate = async (lang: MailTranslateInput['lang']) => {
		setMenu(false);
		setTranslation({ lang, text: null, error: null, original: false });
		try {
			const result = await api<AiTextResult>('POST', `/mail/messages/${message.id}/translate`, { lang } satisfies MailTranslateInput);
			setTranslation((current) => (current?.lang === lang ? { ...current, text: result.text } : current));
		} catch (e) {
			setTranslation((current) => (current?.lang === lang ? { ...current, error: aiErrorText(e) } : current));
		}
	};

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
							<button className='menu-item' onClick={() => void translate('fr')}>
								<Icon name='sparkle' size={16} />
								Traduire en français
							</button>
							<button className='menu-item' onClick={() => void translate('en')}>
								<Icon name='sparkle' size={16} />
								Traduire en anglais
							</button>
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
			{translation && (
				<section className='mail-translation' aria-busy={translation.text === null && !translation.error}>
					<header>
						<Icon name='sparkle' size={14} />
						<span>Traduction en {LANGS[translation.lang]}</span>
						{translation.text !== null && (
							<button className='link' onClick={() => setTranslation({ ...translation, original: !translation.original })}>
								{translation.original ? 'Voir la traduction' : 'Voir l’original'}
							</button>
						)}
						<button className='icon-btn icon-btn-sm' onClick={() => setTranslation(null)} title='Fermer la traduction' aria-label='Fermer la traduction'>
							<Icon name='close' size={13} />
						</button>
					</header>
					{translation.error ? (
						<p className='notice notice-error'>{translation.error}</p>
					) : translation.text === null ? (
						<div className='mail-skeleton'>
							<span />
							<span />
						</div>
					) : (
						!translation.original && <p className='mail-msg-text'>{translation.text}</p>
					)}
				</section>
			)}
			<div className='mail-message-body' hidden={Boolean(translation?.text && !translation.original)}>
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
