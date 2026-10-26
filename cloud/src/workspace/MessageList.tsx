import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import type { Channel, Member, Message, Role } from '../../shared/types';
import { fileUrl } from '../api';
import { Avatar, Icon, formatSize } from '../ui';
import type { ChannelMessages } from './useWorkspace';

const GROUP_GAP = 5 * 60 * 1000;
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
const INLINE_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const longDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

function dayLabel(ts: number): string {
	const day = new Date(ts).toDateString();
	const today = new Date();
	if (day === today.toDateString()) {
		return 'Aujourd’hui';
	}
	if (day === new Date(today.getTime() - 86_400_000).toDateString()) {
		return 'Hier';
	}
	return longDate.format(ts);
}

function linkify(text: string): ReactNode[] {
	return text.split(URL_RE).map((part, i) =>
		i % 2 ? (
			<a key={i} href={part} target='_blank' rel='noopener noreferrer'>
				{part}
			</a>
		) : (
			part
		),
	);
}

type Props = {
	workspaceId: string;
	channel: Channel;
	data: ChannelMessages | undefined;
	members: Map<string, Member>;
	myId: string;
	role: Role;
	onLoadOlder: () => void;
	onEdit: (id: number, body: string) => Promise<void>;
	onDelete: (id: number) => Promise<void>;
};

export function MessageList({ workspaceId, channel, data, members, myId, role, onLoadOlder, onEdit, onDelete }: Props) {
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
		if (prevFirst.current !== undefined && firstId !== undefined && firstId < prevFirst.current) {
			// Historique ajouté en haut : garder la position de lecture.
			el.scrollTop += el.scrollHeight - prevHeight.current;
		} else if (stick.current) {
			el.scrollTop = el.scrollHeight;
		}
		prevFirst.current = firstId;
		prevHeight.current = el.scrollHeight;
	}, [firstId, lastId, items.length]);

	const onScroll = () => {
		const el = ref.current;
		if (!el) {
			return;
		}
		stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
		if (el.scrollTop < 160 && data?.hasMore && !data.loading) {
			prevHeight.current = el.scrollHeight;
			onLoadOlder();
		}
	};

	const keepBottom = () => {
		if (stick.current && ref.current) {
			ref.current.scrollTop = ref.current.scrollHeight;
		}
	};

	const staff = role !== 'member';

	return (
		<div className='messages' ref={ref} onScroll={onScroll} role='log' aria-live='polite' aria-label={`Messages de #${channel.name}`}>
			{data && !data.hasMore && (
				<div className='channel-intro'>
					<h2>
						{channel.readOnly ? <Icon name='megaphone' size={26} /> : <Icon name='hash' size={26} />}
						{channel.name}
					</h2>
					<p className='muted'>{channel.topic || 'Début du salon.'}</p>
				</div>
			)}
			{data?.loading && items.length === 0 && <div className='splash splash-inline' aria-busy />}
			{items.map((message, i) => {
				const prev = items[i - 1];
				const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
				const grouped = !newDay && prev?.userId === message.userId && message.createdAt - prev.createdAt < GROUP_GAP;
				const author = members.get(message.userId);
				const mine = message.userId === myId;
				return (
					<Fragment key={message.id}>
						{newDay && (
							<div className='day' role='separator'>
								<span>{dayLabel(message.createdAt)}</span>
							</div>
						)}
						<article className={`message${grouped ? ' message-grouped' : ''}`}>
							<div className='message-gutter'>
								{grouped ? (
									<time className='message-time-hover'>{time.format(message.createdAt)}</time>
								) : (
									<Avatar id={message.userId} name={author?.name ?? '?'} url={author?.avatarUrl} />
								)}
							</div>
							<div className='message-main'>
								{!grouped && (
									<header className='message-head'>
										<strong className={author ? '' : 'muted'}>{author?.name ?? 'Ancien membre'}</strong>
										{author && author.role !== 'member' && <span className='role-tag'>{author.role === 'owner' ? 'Propriétaire' : 'Admin'}</span>}
										<time dateTime={new Date(message.createdAt).toISOString()}>{time.format(message.createdAt)}</time>
									</header>
								)}
								{editing === message.id ? (
									<EditBox
										initial={message.body}
										onCancel={() => setEditing(null)}
										onSave={async (body) => {
											await onEdit(message.id, body);
											setEditing(null);
										}}
									/>
								) : (
									message.body && (
										<p className='message-body'>
											{linkify(message.body)}
											{message.editedAt && <span className='edited'> (modifié)</span>}
										</p>
									)
								)}
								{message.attachment &&
									(INLINE_IMAGES.has(message.attachment.type) ? (
										<a className='attachment-image' href={fileUrl(workspaceId, message.attachment.key)} target='_blank' rel='noopener noreferrer'>
											<img src={fileUrl(workspaceId, message.attachment.key)} alt={message.attachment.name} loading='lazy' onLoad={keepBottom} />
										</a>
									) : (
										<a className='attachment-file' href={fileUrl(workspaceId, message.attachment.key)} download={message.attachment.name}>
											<Icon name='file' />
											<span>{message.attachment.name}</span>
											<span className='muted'>{formatSize(message.attachment.size)}</span>
										</a>
									))}
							</div>
							{(mine || staff) && editing !== message.id && (
								<div className='message-actions'>
									{mine && (
										<button type='button' className='icon-button' aria-label='Modifier' title='Modifier' onClick={() => setEditing(message.id)}>
											<Icon name='pencil' size={16} />
										</button>
									)}
									<button
										type='button'
										className='icon-button'
										aria-label='Supprimer'
										title='Supprimer'
										onClick={() => {
											if (window.confirm('Supprimer ce message ?')) {
												void onDelete(message.id);
											}
										}}
									>
										<Icon name='trash' size={16} />
									</button>
								</div>
							)}
						</article>
					</Fragment>
				);
			})}
		</div>
	);
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (body: string) => Promise<void>; onCancel: () => void }) {
	const [value, setValue] = useState(initial);
	return (
		<div className='edit-box'>
			<textarea
				autoFocus
				value={value}
				rows={Math.min(8, value.split('\n').length)}
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
			<p className='muted edit-hint'>Entrée pour enregistrer, Échap pour annuler</p>
		</div>
	);
}
