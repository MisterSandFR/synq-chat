import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type TouchEvent } from 'react';

import { appName } from '../../shared/commands';
import { QUICK_REACTIONS } from '../../shared/emoji';
import { mentionedUsers, type Channel, type Grade, type Message } from '../../shared/types';
import { Avatar, Icon } from '../ui';
import { EmojiPicker, rememberEmoji } from './chat/EmojiPicker';
import { emojiOnly } from './chat/markdown';
import { Reactions } from './chat/Reactions';
import { ForwardCard } from './rc/ForwardDialog';
import { ContextMenu, useContextMenu, type ContextMenuItem } from './ContextMenu';
import { memberColor, memberLabel } from './grades';
import { MessageMedia } from './media/MessageMedia';
import { EventCard } from './events/EventCard';
import { CanvasLinkCard } from './canvas/CanvasCard';
import { CANVAS_LINK_RE } from '../../shared/canvas';
import { MailCard } from '../mail/MailCard';
import { RichText, excerpt, toDisplay, toTokens, type Lookup } from './richText';
import { ThreadLink } from './dm-threads/ThreadLink';
import type { ChannelMessages } from './useWorkspace';
import { appAuthor } from './commands/useSlash';
import { AiAssist } from '../ai/AiAssist';
import { useMessageAi } from '../ai/useMessageAi';

const GROUP_GAP = 5 * 60 * 1000;

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
	authorMenu?: (userId: string) => ContextMenuItem[];
	extraActions?: (message: Message) => ReactNode;
	canReact: boolean;
	canPin: boolean;
	onReact: (id: number, emoji: string, add: boolean) => Promise<void>;
	onPin: (id: number, pinned: boolean) => Promise<void>;
	onOpenThread?: (rootId: number) => void;
};

export function MessageList({
	workspaceId,
	channel,
	data,
	lookup,
	canModerate,
	canReact,
	canPin,
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
	authorMenu,
	extraActions,
	onReact,
	onPin,
	onOpenThread,
}: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	const prevHeight = useRef(0);
	const items = data?.items ?? [];
	const firstId = items[0]?.id;
	const lastId = items.at(-1)?.id;
	const prevFirst = useRef(firstId);
	const [editing, setEditing] = useState<number | null>(null);
	const [picker, setPicker] = useState<{ id: number; anchor: DOMRect } | null>(null);
	const [menu, setMenu] = useState<{ message: Message; x: number; y: number } | null>(null);
	const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const authorCtx = useContextMenu();
	const ai = useMessageAi(workspaceId, channel.id, onReply);

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
	const toggle = (message: Message, emoji: string) => {
		const add = !message.reactions?.find((r) => r.emoji === emoji)?.users.includes(lookup.myId);
		if (add) {
			rememberEmoji(emoji);
		}
		void onReact(message.id, emoji, add).catch(() => undefined);
	};

	const openPicker = (id: number, anchor: DOMRect) => setPicker(picker?.id === id ? null : { id, anchor });

	const onContextMenu = (event: MouseEvent<HTMLElement>, message: Message) => {
		// Menu natif conservé sur les liens, médias et texte sélectionné.
		if (editing === message.id || window.getSelection()?.toString() || (event.target as HTMLElement).closest('a, img, video, audio, textarea')) {
			return;
		}
		event.preventDefault();
		setMenu({ message, x: event.clientX, y: event.clientY });
	};

	// Appui long sur écran tactile.
	const onTouchStart = (event: TouchEvent<HTMLElement>, message: Message) => {
		const touch = event.touches[0];
		clearTimeout(press.current);
		if (touch && editing !== message.id) {
			const { clientX, clientY } = touch;
			press.current = setTimeout(() => setMenu({ message, x: clientX, y: clientY }), 500);
		}
	};

	const cancelPress = () => clearTimeout(press.current);

	const menuItems = (message: Message): ContextMenuItem[] => {
		const mine = message.userId === lookup.myId;
		const items: ContextMenuItem[] = [
			{ label: 'Répondre', icon: 'reply', onSelect: () => onReply(message) },
			{ label: 'Copier le texte', icon: 'copy', disabled: !message.body, onSelect: () => void navigator.clipboard?.writeText(toDisplay(message.body, lookup)) },
			{ label: 'Copier le lien', icon: 'link', onSelect: () => void navigator.clipboard?.writeText(`${location.origin}${location.pathname}?m=${message.id}`) },
		];
		if (canPin) {
			items.push({ label: message.pinned ? 'Désépingler' : 'Épingler', icon: 'pin', onSelect: () => void onPin(message.id, !message.pinned).catch(() => undefined) });
		}
		const aiItems = ai.items(message);
		if (aiItems.length) {
			items.push('sep', ...aiItems);
		}
		items.push('sep');
		if (mine && message.body) {
			items.push({ label: 'Modifier', icon: 'pencil', onSelect: () => setEditing(message.id) });
		}
		if (mine || canModerate) {
			items.push({ label: 'Supprimer', icon: 'trash', danger: true, onSelect: () => window.confirm('Supprimer ce message ?') && void onDelete(message.id) });
		}
		return items;
	};

	return (
		<>
		<div className='messages' ref={ref} onScroll={onScroll} role='log' aria-live='polite' aria-label={`Messages de #${channel.name}`}>
			{data && !data.hasMore && (
				<div className='channel-intro'>
					<span className='channel-intro-icon'>
						<Icon name={channel.kind === 'dm' ? 'chat' : channel.readOnly ? 'megaphone' : 'hash'} size={22} />
					</span>
					<h2>{channel.kind === 'dm' ? channel.name : `Bienvenue dans #${channel.name}`}</h2>
					<p className='muted'>{channel.topic || (channel.kind === 'dm' ? 'C’est le début de votre conversation privée.' : 'C’est le début du salon.')}</p>
				</div>
			)}
			{data?.loading && items.length === 0 && <div className='spinner' aria-busy />}
			{items.map((message, i) => {
				const prev = items[i - 1];
				const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(message.createdAt).toDateString();
				const grouped = !newDay && !message.replyTo && prev?.userId === message.userId && message.createdAt - prev.createdAt < GROUP_GAP;
				const author = lookup.members.get(message.userId) ?? appAuthor(message.userId);
				const mine = message.userId === lookup.myId;
				const mentionsMe = mentionedUsers(message.body).includes(lookup.myId);
				const cls = ['msg', grouped && 'msg-grouped', message.replyTo && 'msg-reply', mentionsMe && 'msg-mention', highlightId === message.id && 'msg-highlight', message.pinned && 'msg-pinned']
					.filter(Boolean)
					.join(' ');
				return (
					<Fragment key={message.id}>
						{newDay && (
							<div className='day' role='separator'>
								<span>{dayLabel(message.createdAt)}</span>
							</div>
						)}
						<article
							className={cls}
							data-id={message.id}
							onContextMenu={(e) => onContextMenu(e, message)}
							onTouchStart={(e) => onTouchStart(e, message)}
							onTouchEnd={cancelPress}
							onTouchMove={cancelPress}
						>
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
								{message.pinned && (
									<div className='msg-pinned-by'>
										<Icon name='pin' size={12} />
										Épinglé par {message.pinned.by === lookup.myId ? 'toi' : (lookup.members.get(message.pinned.by)?.name ?? 'un ancien membre')}
									</div>
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
											{...(authorMenu && author ? authorCtx.bind(() => authorMenu(author.id)) : {})}
										>
											{author?.name ?? 'Ancien membre'}
										</span>
										{memberLabel(author, grades) && <span className='tag'>{memberLabel(author, grades)}</span>}
										{appName(message.userId) && <span className='tag'>App</span>}
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
									message.body &&
									!ai.hidesBody(message.id) && (
										<div className={`msg-body${emojiOnly(message.body) ? ' msg-body-jumbo' : ''}`}>
											<RichText text={message.body} lookup={lookup} />
											{message.editedAt && <span className='msg-edited'> (modifié)</span>}
										</div>
									)
								)}
								{editing !== message.id && ai.render(message)}
								{message.forward && <ForwardCard workspaceId={workspaceId} message={message} lookup={lookup} />}
								<MessageMedia workspaceId={workspaceId} message={message} onLoad={keepBottom} />
								{message.eventId && <EventCard workspaceId={workspaceId} eventId={message.eventId} lookup={lookup} />}
								{CANVAS_LINK_RE.test(message.body) && <CanvasLinkCard workspaceId={workspaceId} body={message.body} lookup={lookup} />}
								{message.mailCard && <MailCard card={message.mailCard} />}
								{message.reactions && message.reactions.length > 0 && (
									<Reactions
										reactions={message.reactions}
										lookup={lookup}
										canReact={canReact}
										pickerOpen={picker?.id === message.id}
										onToggle={(emoji) => toggle(message, emoji)}
										onAdd={(anchor) => openPicker(message.id, anchor)}
									/>
								)}
								{onOpenThread && <ThreadLink message={message} onOpen={onOpenThread} />}
							</div>
							{editing !== message.id && (
								<div className='msg-actions'>
									{canReact && (
										<button
											type='button'
											className='icon-btn icon-btn-sm'
											aria-label='Ajouter une réaction'
											title='Ajouter une réaction'
											onPointerDown={(e) => picker?.id === message.id && e.stopPropagation()}
											onClick={(e) => openPicker(message.id, e.currentTarget.getBoundingClientRect())}
										>
											<Icon name='smile-plus' size={16} />
										</button>
									)}
									{onOpenThread && !message.threadRoot && (
										<button type='button' className='icon-btn icon-btn-sm' aria-label='Répondre dans un fil' title='Répondre dans un fil' onClick={() => onOpenThread(message.id)}>
											<Icon name='thread' size={16} />
										</button>
									)}
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
									<button
										type='button'
										className='icon-btn icon-btn-sm'
										aria-label='Plus d’actions'
										title='Plus d’actions'
										onClick={(e) => {
											const rect = e.currentTarget.getBoundingClientRect();
											setMenu({ message, x: rect.right, y: rect.bottom + 4 });
										}}
									>
										<Icon name='more' size={16} />
									</button>
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
		{authorCtx.menu}
		{menu && (
			<ContextMenu
				x={menu.x}
				y={menu.y}
				items={menuItems(menu.message)}
				onClose={() => setMenu(null)}
				header={
					canReact ? (
						<div className='quick-reactions'>
							{QUICK_REACTIONS.map((emoji) => (
								<button
									key={emoji}
									type='button'
									className='quick-reaction'
									aria-label={`Réagir avec ${emoji}`}
									onClick={() => {
										toggle(menu.message, emoji);
										setMenu(null);
									}}
								>
									{emoji}
								</button>
							))}
							<button
								type='button'
								className='quick-reaction'
								aria-label='Autres réactions'
								onClick={() => {
									setPicker({ id: menu.message.id, anchor: new DOMRect(menu.x, menu.y, 0, 0) });
									setMenu(null);
								}}
							>
								<Icon name='smile-plus' size={18} />
							</button>
						</div>
					) : undefined
				}
			/>
		)}
		{picker && (
			<EmojiPicker
				anchor={picker.anchor}
				onClose={() => setPicker(null)}
				onPick={(emoji) => {
					const target = items.find((m) => m.id === picker.id);
					if (target) {
						toggle(target, emoji);
					}
					setPicker(null);
				}}
			/>
		)}
		</>
	);
}

function EditBox({ initial, onSave, onCancel }: { initial: string; onSave: (body: string) => Promise<void>; onCancel: () => void }) {
	const [value, setValue] = useState(initial);
	const textarea = useRef<HTMLTextAreaElement>(null);
	return (
		<div className='edit-box'>
			<label className='sr-only' htmlFor='edit-message'>
				Modifier le message
			</label>
			<textarea
				id='edit-message'
				ref={textarea}
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
			<div className='row' style={{ gap: 6 }}>
				<AiAssist textarea={textarea} value={value} onChange={setValue} />
				<p className='muted' style={{ fontSize: 12 }}>
					Entrée pour enregistrer, Échap pour annuler
				</p>
			</div>
		</div>
	);
}
