import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { mentionedUsers, type Channel, type Grade, type Message } from '../../shared/types';
import { fileUrl } from '../api';
import { Avatar, Icon, fileIcon, formatSize } from '../ui';
import { memberColor, memberLabel } from './grades';
import { RichText, excerpt, toDisplay, toTokens, type Lookup } from './richText';
import type { ChannelMessages } from './useWorkspace';

const GROUP_GAP = 5 * 60 * 1000;
const IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const VIDEOS = new Set(['video/mp4', 'video/webm']);
const AUDIOS = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm']);

const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const longDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fullDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' });

function dayLabel(ts: number): string {
	const day = new Date(ts).toDateString();
	const today = new Date();
	if (day === today.toDateString()) {
		return 'Aujourd’hui';
	}
	if (day === new Date(today.getTime() - 86_400_000).toDateString()) {
		return 'Hier';
	}
	const label = longDate.format(ts);
	return label.charAt(0).toUpperCase() + label.slice(1);
}

type Props = {
	workspaceId: string;
	channel: Channel;
	data: ChannelMessages | undefined;
	lookup: Lookup;
	canModerate: boolean;
	grades: Grade[];
	highlightId: number | null;
	onLoadOlder: () => void;
	onLoadNewer: () => void;
	onJumpLatest: () => void;
	onJumpTo: (id: number) => void;
	onReply: (message: Message) => void;
	onEdit: (id: number, body: string) => Promise<void>;
	onDelete: (id: number) => Promise<void>;
	onAuthor?: (userId: string, anchor: HTMLElement) => void;
	extraActions?: (message: Message) => ReactNode;
};

export function MessageList({
	workspaceId,
	channel,
	data,
	lookup,
	canModerate,
	grades,
	highlightId,
	onLoadOlder,
	onLoadNewer,
	onJumpLatest,
	onJumpTo,
	onReply,
	onEdit,
	onDelete,
	onAuthor,
	extraActions,
}: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	const prevHeight = useRef(0);
	const items = data?.items ?? [];
	const firstId = items[0]?.id;
	const lastId = items.at(-1)?.id;
	const prevFirst = useRef(firstId);
	const [editing, setEditing] = useState<number | null>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		if (highlightId !== null && items.some((m) => m.id === highlightId)) {
			el.querySelector(`[data-id="${highlightId}"]`)?.scrollIntoView({ block: 'center' });
			stick.current = false;
		} else if (prevFirst.current !== undefined && firstId !== undefined && firstId < prevFirst.current) {
			// Historique ajouté en haut : garder la position de lecture.
			el.scrollTop += el.scrollHeight - prevHeight.current;
		} else if (stick.current) {
			el.scrollTop = el.scrollHeight;
		}
		prevFirst.current = firstId;
		prevHeight.current = el.scrollHeight;
	}, [firstId, lastId, items.length, highlightId, items]);

	useEffect(() => {
		stick.current = !data?.hasNewer;
	}, [data?.hasNewer]);

	const onScroll = () => {
		const el = ref.current;
		if (!el || !data || data.loading) {
			return;
		}
		const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
		stick.current = fromBottom < 80 && !data.hasNewer;
		if (el.scrollTop < 200 && data.hasMore) {
			prevHeight.current = el.scrollHeight;
			onLoadOlder();
		} else if (fromBottom < 200 && data.hasNewer) {
			onLoadNewer();
		}
	};

	const keepBottom = () => {
		if (stick.current && ref.current) {
			ref.current.scrollTop = ref.current.scrollHeight;
		}
	};

	return (
		<div className='messages' ref={ref} onScroll={onScroll} role='log' aria-live='polite' aria-label={`Messages de #${channel.name}`}>
			{data && !data.hasMore && (
				<div className='channel-intro'>
					<span className='channel-intro-icon'>
						<Icon name={channel.readOnly ? 'megaphone' : 'hash'} size={22} />
					</span>
					<h2>Bienvenue dans #{channel.name}</h2>
					<p className='muted'>{channel.topic || 'C’est le début du salon.'}</p>
				</div>
			)}
			{data?.loading && items.length === 0 && <div className='spinner' aria-busy />}
			{items.map((message, i) => {
				const prev = items[i - 1];
				const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
				const grouped = !newDay && !message.replyTo && prev?.userId === message.userId && message.createdAt - prev.createdAt < GROUP_GAP;
				const author = lookup.members.get(message.userId);
				const mine = message.userId === lookup.myId;
				const mentionsMe = mentionedUsers(message.body).includes(lookup.myId);
				const cls = ['msg', grouped && 'msg-grouped', message.replyTo && 'msg-reply', mentionsMe && 'msg-mention', highlightId === message.id && 'msg-highlight']
					.filter(Boolean)
					.join(' ');
				return (
					<Fragment key={message.id}>
						{newDay && (
							<div className='day' role='separator'>
								<span>{dayLabel(message.createdAt)}</span>
							</div>
						)}
						<article className={cls} data-id={message.id}>
							<div className='msg-gutter'>
								{grouped ? (
									<time className='msg-time-hover' title={fullDate.format(message.createdAt)}>
										{time.format(message.createdAt)}
									</time>
								) : (
									<Avatar name={author?.name ?? '?'} url={author?.avatarUrl} size={36} />
								)}
							</div>
							<div style={{ minWidth: 0 }}>
								{message.replyTo && (
									<button type='button' className='reply-ref' onClick={() => message.replyTo && onJumpTo(message.replyTo.id)}>
										<span className='reply-ref-line' aria-hidden />
										{message.replyTo.userId ? (
											<>
												<strong style={{ fontWeight: 600 }}>{lookup.members.get(message.replyTo.userId)?.name ?? 'Ancien membre'}</strong>
												<span className='ellipsis'>{excerpt(message.replyTo.body ?? '', lookup, 90) || 'Fichier joint'}</span>
											</>
										) : (
											<span>Message supprimé</span>
										)}
									</button>
								)}
								{!grouped && (
									<header className='msg-head'>
										<span
											className={`msg-author${author ? '' : ' muted'}`}
											style={{ color: memberColor(author, grades) }}
											{...(onAuthor && author
												? {
														role: 'button',
														tabIndex: 0,
														onClick: (e: React.MouseEvent<HTMLElement>) => onAuthor(author.id, e.currentTarget),
														onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => e.key === 'Enter' && onAuthor(author.id, e.currentTarget),
													}
												: {})}
										>
											{author?.name ?? 'Ancien membre'}
										</span>
										{memberLabel(author, grades) && <span className='tag'>{memberLabel(author, grades)}</span>}
										<time dateTime={new Date(message.createdAt).toISOString()} title={fullDate.format(message.createdAt)}>
											{time.format(message.createdAt)}
										</time>
									</header>
								)}
								{editing === message.id ? (
									<EditBox
										initial={toDisplay(message.body, lookup)}
										onCancel={() => setEditing(null)}
										onSave={async (text) => {
											await onEdit(message.id, toTokens(text, lookup));
											setEditing(null);
										}}
									/>
								) : (
									message.body && (
										<p className='msg-body'>
											<RichText text={message.body} lookup={lookup} />
											{message.editedAt && <span className='msg-edited'> (modifié)</span>}
										</p>
									)
								)}
								{message.attachment && <AttachmentView workspaceId={workspaceId} attachment={message.attachment} onLoad={keepBottom} />}
							</div>
							{editing !== message.id && (
								<div className='msg-actions'>
									<button type='button' className='icon-btn icon-btn-sm' aria-label='Répondre' title='Répondre' onClick={() => onReply(message)}>
										<Icon name='reply' size={16} />
									</button>
									{extraActions?.(message)}
									{mine && message.body && (
										<button type='button' className='icon-btn icon-btn-sm' aria-label='Modifier' title='Modifier' onClick={() => setEditing(message.id)}>
											<Icon name='pencil' size={16} />
										</button>
									)}
									{(mine || canModerate) && (
										<button
											type='button'
											className='icon-btn icon-btn-sm'
											aria-label='Supprimer'
											title='Supprimer'
											onClick={() => window.confirm('Supprimer ce message ?') && void onDelete(message.id)}
										>
											<Icon name='trash' size={16} />
										</button>
									)}
								</div>
							)}
						</article>
					</Fragment>
				);
			})}
			{data?.hasNewer && (
				<button type='button' className='btn jump-latest' onClick={onJumpLatest}>
					Revenir aux messages récents
				</button>
			)}
		</div>
	);
}

function AttachmentView({ workspaceId, attachment, onLoad }: { workspaceId: string; attachment: NonNullable<Message['attachment']>; onLoad: () => void }) {
	const url = fileUrl(workspaceId, attachment.key);
	if (IMAGES.has(attachment.type)) {
		return (
			<a href={url} target='_blank' rel='noopener noreferrer'>
				<img className='attachment-media' src={url} alt={attachment.name} loading='lazy' onLoad={onLoad} />
			</a>
		);
	}
	if (VIDEOS.has(attachment.type)) {
		return <video className='attachment-media' src={url} controls preload='metadata' onLoadedMetadata={onLoad} />;
	}
	if (AUDIOS.has(attachment.type)) {
		return <audio src={url} controls preload='metadata' style={{ display: 'block', marginTop: 6, maxWidth: '100%' }} />;
	}
	return (
		<a className='attachment-file' href={url} download={attachment.name}>
			<span className='file-icon'>
				<Icon name={fileIcon(attachment.type)} />
			</span>
			<span className='file-meta'>
				<span>{attachment.name}</span>
				<span>{formatSize(attachment.size)}</span>
			</span>
			<Icon name='download' size={16} />
		</a>
	);
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (body: string) => Promise<void>; onCancel: () => void }) {
	const [value, setValue] = useState(initial);
	return (
		<div className='edit-box'>
			<label className='sr-only' htmlFor='edit-message'>
				Modifier le message
			</label>
			<textarea
				id='edit-message'
				autoFocus
				value={value}
				rows={Math.min(8, value.split('\n').length + 1)}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Escape') {
						onCancel();
					} else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
						e.preventDefault();
						void onSave(value);
					}
				}}
			/>
			<p className='muted' style={{ fontSize: 12 }}>
				Entrée pour enregistrer, Échap pour annuler
			</p>
		</div>
	);
}
