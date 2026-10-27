import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ThreadView } from '../../../shared/dm-threads';
import type { Channel, Grade, Message } from '../../../shared/types';
import { api, errorText, fileUrl } from '../../api';
import { Avatar, Icon } from '../../ui';
import { memberColor } from '../grades';
import { RichText, toTokens, type Lookup } from '../richText';
import type { WorkspaceState } from '../useWorkspace';
import { when } from './DirectAvatar';
import { putReply, type DmThreadsAction } from './state';
import './dm-threads.css';

const fullDate = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' });

type Props = {
	workspaceId: string;
	connId: string | null;
	channel: Channel;
	channelName: string;
	rootId: number;
	state: WorkspaceState;
	dispatch: (action: DmThreadsAction) => void;
	lookup: Lookup;
	grades: Grade[];
	canPost: boolean;
	onClose: () => void;
};

export function ThreadPanel({ workspaceId, connId, channel, channelName, rootId, state, dispatch, lookup, grades, canPost, onClose }: Props) {
	const [fetched, setFetched] = useState<Message | null>(null);
	const [following, setFollowing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [text, setText] = useState('');
	const [alsoChannel, setAlsoChannel] = useState(false);
	const [sending, setSending] = useState(false);
	const bodyRef = useRef<HTMLDivElement>(null);
	const replies = state.dmThreads.threads[rootId];
	const count = replies?.length ?? 0;
	// Racine prise dans le salon si chargée : compteur et modifications à jour.
	const root = state.messages[channel.id]?.items.find((m) => m.id === rootId) ?? (fetched?.id === rootId ? fetched : null);

	useEffect(() => {
		if (!connId) {
			return;
		}
		let live = true;
		setError(null);
		api<ThreadView>('GET', `/w/${workspaceId}/messages/${rootId}/thread`)
			.then((view) => {
				if (!live) {
					return;
				}
				setFetched(view.root);
				setFollowing(view.following);
				dispatch({ type: 'dm_threads', update: (current) => ({ ...current, threads: { ...current.threads, [rootId]: view.replies } }) });
			})
			.catch((e: unknown) => live && setError(errorText(e)));
		return () => {
			live = false;
		};
	}, [workspaceId, rootId, connId, dispatch]);

	useEffect(() => {
		if (count > 0 && following) {
			void api('POST', `/w/${workspaceId}/messages/${rootId}/thread/read`).catch(() => undefined);
		}
	}, [workspaceId, rootId, count, following]);

	useLayoutEffect(() => {
		const el = bodyRef.current;
		if (el) {
			el.scrollTop = el.scrollHeight;
		}
	}, [count]);

	const send = async () => {
		const body = toTokens(text, lookup).trim();
		if (!body || sending) {
			return;
		}
		setSending(true);
		setError(null);
		try {
			const message = await api<Message>('POST', `/w/${workspaceId}/messages/${rootId}/thread`, { body, broadcast: alsoChannel });
			dispatch({ type: 'dm_threads', update: putReply(rootId, message) });
			setText('');
			setFollowing(true);
		} catch (e) {
			setError(errorText(e));
		} finally {
			setSending(false);
		}
	};

	const toggleFollow = async () => {
		const next = !following;
		setFollowing(next);
		await api('PUT', `/w/${workspaceId}/messages/${rootId}/follow`, { following: next }).catch(() => setFollowing(!next));
	};

	return (
		<aside className='side-panel thread-panel' aria-label='Fil de discussion'>
			<header className='side-panel-head'>
				<h2 className='grow ellipsis'>
					Fil <span className='thread-where'>{channelName}</span>
				</h2>
				<button type='button' className='btn thread-follow' aria-pressed={following} onClick={() => void toggleFollow()}>
					{following ? 'Suivi' : 'Suivre'}
				</button>
				<button type='button' className='icon-btn' aria-label='Fermer le fil' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<div className='thread-body' ref={bodyRef}>
				{root && <ThreadMessage message={root} lookup={lookup} grades={grades} workspaceId={workspaceId} />}
				{replies && (
					<div className='thread-count' role='separator'>
						{count === 0 ? 'Aucune réponse' : `${count} ${count > 1 ? 'réponses' : 'réponse'}`}
					</div>
				)}
				{!replies && !error && <div className='spinner' aria-busy />}
				{replies?.map((message) => <ThreadMessage key={message.id} message={message} lookup={lookup} grades={grades} workspaceId={workspaceId} />)}
				{error && <p className='notice notice-error'>{error}</p>}
			</div>
			{canPost && (
				<form
					className='thread-compose'
					onSubmit={(e) => {
						e.preventDefault();
						void send();
					}}
				>
					<div className='thread-compose-box'>
						<label className='sr-only' htmlFor='thread-reply'>
							Répondre dans le fil
						</label>
						<textarea
							id='thread-reply'
							rows={2}
							placeholder='Répondre…'
							value={text}
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
									e.preventDefault();
									void send();
								}
							}}
						/>
						<button type='submit' className='icon-btn' aria-label='Envoyer' disabled={sending || !text.trim()}>
							<Icon name='send' />
						</button>
					</div>
					<label className='thread-also'>
						<input type='checkbox' checked={alsoChannel} onChange={(e) => setAlsoChannel(e.target.checked)} />
						Envoyer aussi dans {channelName}
					</label>
				</form>
			)}
		</aside>
	);
}

function ThreadMessage({ message, lookup, grades, workspaceId }: { message: Message; lookup: Lookup; grades: Grade[]; workspaceId: string }) {
	const author = lookup.members.get(message.userId);
	return (
		<article className='thread-msg'>
			<Avatar name={author?.name ?? '?'} url={author?.avatarUrl} size={32} />
			<div style={{ minWidth: 0 }}>
				<header className='thread-msg-head'>
					<strong style={{ color: memberColor(author, grades) }}>{author?.name ?? 'Ancien membre'}</strong>
					<time dateTime={new Date(message.createdAt).toISOString()} title={fullDate.format(message.createdAt)}>
						{when(message.createdAt)}
					</time>
				</header>
				{message.body && (
					<p className='thread-msg-body'>
						<RichText text={message.body} lookup={lookup} />
						{message.editedAt && <span className='msg-edited'> (modifié)</span>}
					</p>
				)}
				{message.attachment && (
					<a className='thread-file' href={fileUrl(workspaceId, message.attachment.key)} download={message.attachment.name}>
						<Icon name='paperclip' size={14} /> {message.attachment.name}
					</a>
				)}
			</div>
		</article>
	);
}
