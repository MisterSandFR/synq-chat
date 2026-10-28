import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ThreadView } from '../../../shared/dm-threads';
import type { Channel, Grade, Message } from '../../../shared/types';
import type { AiTextResult } from '../../../shared/ai';
import { api, errorText, fileUrl } from '../../api';
import { AiAssist } from '../../ai/AiAssist';
import { AiBlock } from '../../ai/AiBlock';
import { aiErrorText, isAbort } from '../../ai/parse';
import { Avatar, Icon } from '../../ui';
import { useDraft } from '../drafts';
import { memberColor } from '../grades';
import { PollCard } from '../polls/PollCard';
import { PollDialog } from '../polls/PollDialog';
import { RichText, toDisplay, toTokens, type Lookup } from '../richText';
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
	const [pollOpen, setPollOpen] = useState(false);
	const [alsoChannel, setAlsoChannel] = useState(false);
	const [sending, setSending] = useState(false);
	const draft = useDraft(workspaceId, channel.id, rootId, { body: text, keys: [] }, (saved) => setText(saved.body));
	const bodyRef = useRef<HTMLDivElement>(null);
	const replyRef = useRef<HTMLTextAreaElement>(null);
	const [summary, setSummary] = useState<{ text: string | null; error: string | null } | null>(null);
	const summaryCall = useRef<AbortController | null>(null);
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

	useEffect(() => () => summaryCall.current?.abort(), []);

	const summarize = () => {
		summaryCall.current?.abort();
		const ctrl = new AbortController();
		summaryCall.current = ctrl;
		setSummary({ text: null, error: null });
		bodyRef.current?.scrollTo({ top: 0 });
		api<AiTextResult>('POST', `/w/${workspaceId}/messages/${rootId}/ai/thread-summary`, {}, ctrl.signal)
			.then(({ text: result }) => setSummary({ text: result, error: null }))
			.catch((e: unknown) => !isAbort(e) && setSummary({ text: null, error: aiErrorText(e) }));
	};

	const closeSummary = () => {
		summaryCall.current?.abort();
		setSummary(null);
	};

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
			draft.sent();
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
				{count > 0 && (
					<button type='button' className='icon-btn' aria-label='Résumer le fil' title='Résumer le fil' disabled={summary !== null && summary.text === null && !summary.error} onClick={summarize}>
						<span aria-hidden className='ai-glyph'>
							✦
						</span>
					</button>
				)}
				<button type='button' className='btn thread-follow' aria-pressed={following} onClick={() => void toggleFollow()}>
					{following ? 'Suivi' : 'Suivre'}
				</button>
				<button type='button' className='icon-btn' aria-label='Fermer le fil' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<div className='thread-body' ref={bodyRef}>
				{summary && <AiBlock label='Résumé du fil' text={summary.text} error={summary.error} onCancel={closeSummary} onClose={closeSummary} onRetry={summarize} />}
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
							ref={replyRef}
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
						<AiAssist textarea={replyRef} value={text} onChange={setText} context={root ? toDisplay(root.body, lookup) : undefined} align='end' />
						<button type='button' className='icon-btn' aria-label='Sondage' title='Créer un sondage dans le fil' onClick={() => setPollOpen(true)}>
							<Icon name='poll' />
						</button>
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
			{pollOpen && <PollDialog workspaceId={workspaceId} channelId={channel.id} threadRoot={rootId} lookup={lookup} initialQuestion='' onClose={() => setPollOpen(false)} />}
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
				{message.poll && <PollCard workspaceId={workspaceId} message={message} lookup={lookup} />}
				{message.body && !message.poll && (
					<p className='thread-msg-body'>
						<RichText text={message.body} lookup={lookup} />
						{message.editedAt && <span className='msg-edited'> (modifié)</span>}
					</p>
				)}
				{message.attachments.map((file) => (
					<a key={file.key} className='thread-file' href={fileUrl(workspaceId, file.key)} download={file.name}>
						<Icon name='paperclip' size={14} /> {file.name}
					</a>
				))}
			</div>
		</article>
	);
}
