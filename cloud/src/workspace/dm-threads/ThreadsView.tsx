import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { FollowedThread } from '../../../shared/dm-threads';
import type { Message } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Avatar, Icon } from '../../ui';
import { RichText, toTokens, type Lookup } from '../richText';
import { when } from './DirectAvatar';
import './dm-threads.css';

type Props = {
	workspaceId: string;
	connId: string | null;
	lookup: Lookup;
	// Incrémenté à chaque réponse reçue en direct.
	version: number;
	channelLabel: (channelId: string) => string;
	onOpen: (channelId: string, rootId: number) => void;
};

export function ThreadsView({ workspaceId, connId, lookup, version, channelLabel, onOpen }: Props) {
	const [threads, setThreads] = useState<FollowedThread[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!connId) {
			return;
		}
		let live = true;
		api<FollowedThread[]>('GET', `/w/${workspaceId}/threads`)
			.then((list) => {
				if (live) {
					setThreads(list);
					setError(null);
				}
			})
			.catch((e: unknown) => live && setError(errorText(e)));
		return () => {
			live = false;
		};
	}, [workspaceId, connId, version]);

	const patch = (rootId: number, change: Partial<FollowedThread> | null) =>
		setThreads((list) => list && (change ? list.map((t) => (t.root.id === rootId ? { ...t, ...change } : t)) : list.filter((t) => t.root.id !== rootId)));

	const read = (rootId: number) => {
		patch(rootId, { unread: 0 });
		void api('POST', `/w/${workspaceId}/messages/${rootId}/thread/read`).catch(() => undefined);
	};

	const unfollow = (rootId: number) => {
		patch(rootId, null);
		void api('PUT', `/w/${workspaceId}/messages/${rootId}/follow`, { following: false }).catch((e: unknown) => setError(errorText(e)));
	};

	const unread = threads?.filter((t) => t.unread > 0).length ?? 0;

	return (
		<section className='dm-view th-view' aria-label='Fils suivis'>
			<header className='dm-view-head'>
				<h2>Fils</h2>
				{unread > 0 && <span className='th-count'>{unread > 1 ? `${unread} fils non lus` : '1 fil non lu'}</span>}
			</header>
			<p className='muted dm-view-hint'>Les fils où tu as écrit et ceux que tu suis, les plus récents d’abord.</p>
			{error && <p className='notice notice-error'>{error}</p>}
			{threads === null ? (
				!error && <div className='spinner' aria-busy />
			) : threads.length === 0 ? (
				<p className='dm-empty muted'>Aucun fil suivi. Réponds dans un fil ou suis-le pour le retrouver ici.</p>
			) : (
				<ul className='th-list'>
					{threads.map((thread) => (
						<ThreadCard
							key={thread.root.id}
							workspaceId={workspaceId}
							thread={thread}
							lookup={lookup}
							label={channelLabel(thread.root.channelId)}
							onOpen={() => onOpen(thread.root.channelId, thread.root.id)}
							onRead={() => read(thread.root.id)}
							onUnfollow={() => unfollow(thread.root.id)}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

// Carte restée visible ce temps-là : fil lu.
const SEEN_DELAY = 1200;

type CardProps = {
	workspaceId: string;
	thread: FollowedThread;
	lookup: Lookup;
	label: string;
	onOpen: () => void;
	onRead: () => void;
	onUnfollow: () => void;
};

function ThreadCard({ workspaceId, thread, lookup, label, onOpen, onRead, onUnfollow }: CardProps) {
	const { root, unread, replies, total } = thread;
	const ref = useRef<HTMLLIElement>(null);
	// Repère gardé jusqu'à la sortie de la page, même après lecture.
	const [fresh] = useState(unread > 0);
	const [text, setText] = useState('');
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const isDm = lookup.channels.find((c) => c.id === root.channelId)?.kind === 'dm';
	const more = total - replies.length;

	useEffect(() => {
		const el = ref.current;
		if (!unread || !el) {
			return;
		}
		let timer: number | undefined;
		const observer = new IntersectionObserver(
			([entry]) => {
				window.clearTimeout(timer);
				if (entry?.isIntersecting) {
					timer = window.setTimeout(() => {
						if (document.visibilityState === 'visible') {
							observer.disconnect();
							onRead();
						}
					}, SEEN_DELAY);
				}
			},
			{ threshold: 0.5 },
		);
		observer.observe(el);
		return () => {
			observer.disconnect();
			window.clearTimeout(timer);
		};
	}, [unread, root.id]);

	const send = async () => {
		const body = toTokens(text.trim(), lookup);
		if (!body || sending) {
			return;
		}
		setSending(true);
		try {
			await api('POST', `/w/${workspaceId}/messages/${root.id}/thread`, { body });
			setText('');
			setError(null);
		} catch (e) {
			setError(errorText(e));
		} finally {
			setSending(false);
		}
	};

	const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			void send();
		}
	};

	return (
		<li ref={ref} className={`th-card${unread > 0 || fresh ? ' th-card-unread' : ''}`}>
			<header className='th-card-head'>
				<button type='button' className='th-card-where' onClick={onOpen} title='Ouvrir le fil'>
					<Icon name={isDm ? 'chat' : 'hash'} size={15} />
					<strong className='ellipsis'>{label}</strong>
				</button>
				{unread > 0 && (
					<span className='pill' aria-label={unread > 1 ? `${unread} réponses non lues` : '1 réponse non lue'}>
						{unread > 99 ? '99+' : unread}
					</span>
				)}
				<span className='grow' />
				{unread > 0 && (
					<button type='button' className='btn btn-ghost th-act' onClick={onRead} title='Marquer comme lu'>
						<Icon name='check' size={15} /> <span className='th-act-label'>Marquer comme lu</span>
					</button>
				)}
				<button type='button' className='btn btn-ghost th-act' onClick={onUnfollow} title='Ne plus suivre'>
					<Icon name='close' size={15} /> <span className='th-act-label'>Ne plus suivre</span>
				</button>
				<button type='button' className='btn btn-ghost th-act' onClick={onOpen} title='Ouvrir le fil dans le panneau'>
					<Icon name='expand' size={15} /> <span className='th-act-label'>Ouvrir</span>
				</button>
			</header>
			<ThreadMessage message={root} lookup={lookup} root />
			{(more > 0 || replies.length > 0) && (
				<div className='th-replies'>
					{more > 0 && (
						<button type='button' className='th-more' onClick={onOpen}>
							{more > 1 ? `${more} autres réponses` : '1 autre réponse'}
						</button>
					)}
					{replies.map((m) => (
						<ThreadMessage key={m.id} message={m} lookup={lookup} />
					))}
				</div>
			)}
			<div className='th-reply'>
				<textarea
					rows={1}
					className='th-input'
					placeholder='Répondre…'
					aria-label={`Répondre dans le fil de ${label}`}
					value={text}
					disabled={sending}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={onKey}
				/>
				<button type='button' className='icon-btn' aria-label='Envoyer' title='Envoyer (Entrée)' disabled={!text.trim() || sending} onClick={() => void send()}>
					<Icon name='send' size={16} />
				</button>
			</div>
			{error && <p className='notice notice-error'>{error}</p>}
		</li>
	);
}

function ThreadMessage({ message, lookup, root = false }: { message: Message; lookup: Lookup; root?: boolean }) {
	const author = lookup.members.get(message.userId);
	const files = message.attachments.length;
	return (
		<article className={`th-msg${root ? ' th-msg-root' : ''}`}>
			<Avatar name={author?.name ?? '?'} url={author?.avatarUrl} size={root ? 36 : 26} />
			<div className='th-msg-main'>
				<div className='th-msg-top'>
					<strong className='ellipsis'>{author?.name ?? 'Ancien membre'}</strong>
					<time dateTime={new Date(message.createdAt).toISOString()}>{when(message.createdAt)}</time>
				</div>
				{message.body && (
					<div className='th-msg-body'>
						<RichText text={message.body} lookup={lookup} />
					</div>
				)}
				{files > 0 && (
					<span className='th-file'>
						<Icon name='paperclip' size={13} /> {files > 1 ? `${files} fichiers joints` : message.attachments[0]!.name}
					</span>
				)}
			</div>
		</article>
	);
}
