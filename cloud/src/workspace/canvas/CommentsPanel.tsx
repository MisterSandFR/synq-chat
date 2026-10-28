import type { Editor } from '@tiptap/core';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { PageComment } from '../../../shared/canvas';
import type { Member } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Avatar, Icon } from '../../ui';
import { removeThreadMark } from './blocks';

export type PendingComment = { from: number; to: number; quote: string };

type Props = {
	workspaceId: string;
	pageId: string;
	editor: Editor | null;
	members: Map<string, Member>;
	myId: string;
	canWrite: boolean;
	pending: PendingComment | null;
	focus: string | null;
	onPendingDone: () => void;
	onClose: () => void;
	onCount: (open: number) => void;
};

const when = (at: number) => new Date(at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Mention par `@Nom` dans le texte du commentaire.
const mentionsIn = (body: string, members: Map<string, Member>) => [...members.values()].filter((m) => body.includes(`@${m.name}`)).map((m) => m.id);

export function CommentsPanel({ workspaceId, pageId, editor, members, myId, canWrite, pending, focus, onPendingDone, onClose, onCount }: Props) {
	const [items, setItems] = useState<PageComment[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<'open' | 'resolved'>('open');
	const [draft, setDraft] = useState('');
	const base = `/w/${workspaceId}/canvases/${pageId}/comments`;
	const focusRef = useRef<HTMLElement | null>(null);

	const load = () =>
		api<PageComment[]>('GET', base)
			.then(setItems)
			.catch((e: unknown) => setError(errorText(e)));

	useEffect(() => {
		void load();
		const onFocus = () => void load();
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [base]);

	const threads = useMemo(() => {
		const map = new Map<string, PageComment[]>();
		for (const c of items ?? []) {
			map.set(c.threadId, [...(map.get(c.threadId) ?? []), c]);
		}
		return [...map.entries()].map(([id, list]) => ({ id, list, resolved: list[0]!.resolvedAt !== null }));
	}, [items]);

	useEffect(() => onCount(threads.filter((t) => !t.resolved).length), [threads]);

	useEffect(() => {
		const thread = threads.find((t) => t.id === focus);
		if (thread) {
			setTab(thread.resolved ? 'resolved' : 'open');
			requestAnimationFrame(() => focusRef.current?.scrollIntoView({ block: 'nearest' }));
		}
	}, [focus, threads.length]);

	const post = async (threadId: string, body: string, quote = '') => {
		const comment = await api<PageComment>('POST', base, { threadId, quote, body, mentions: mentionsIn(body, members) });
		setItems((prev) => [...(prev ?? []), comment]);
		return comment;
	};

	const start = async () => {
		if (!pending || !draft.trim()) {
			return;
		}
		const thread = crypto.randomUUID();
		try {
			await post(thread, draft, pending.quote);
			editor?.chain().setTextSelection({ from: pending.from, to: pending.to }).setMark('comment', { thread }).run();
			setDraft('');
			onPendingDone();
		} catch (e) {
			setError(errorText(e));
		}
	};

	const resolve = async (first: PageComment, resolved: boolean) => {
		try {
			setItems(await api<PageComment[]>('PATCH', `${base}/${first.id}`, { resolved }));
			if (resolved && editor) {
				removeThreadMark(editor, first.threadId);
			}
		} catch (e) {
			setError(errorText(e));
		}
	};

	const remove = async (comment: PageComment) => {
		try {
			await api('DELETE', `${base}/${comment.id}`);
			setItems((prev) => (prev ?? []).filter((c) => c.id !== comment.id));
		} catch (e) {
			setError(errorText(e));
		}
	};

	const shown = threads.filter((t) => t.resolved === (tab === 'resolved'));

	return (
		<aside className='page-comments' aria-label='Commentaires'>
			<div className='page-comments-head'>
				<strong className='grow'>Commentaires</strong>
				<div className='page-comments-tabs' role='tablist'>
					<button type='button' role='tab' aria-selected={tab === 'open'} onClick={() => setTab('open')}>
						Ouverts
					</button>
					<button type='button' role='tab' aria-selected={tab === 'resolved'} onClick={() => setTab('resolved')}>
						Résolus
					</button>
				</div>
				<button type='button' className='icon-btn' aria-label='Fermer les commentaires' onClick={onClose}>
					<Icon name='close' size={16} />
				</button>
			</div>
			{error && (
				<p className='notice notice-error' onClick={() => setError(null)}>
					{error}
				</p>
			)}
			<div className='page-comments-body'>
				{pending && (
					<form
						className='page-thread page-thread-new'
						onSubmit={(e) => {
							e.preventDefault();
							void start();
						}}
					>
						<blockquote>{pending.quote}</blockquote>
						<textarea className='field' autoFocus rows={3} value={draft} placeholder='Ton commentaire, @Nom pour mentionner' aria-label='Nouveau commentaire' onChange={(e) => setDraft(e.target.value)} />
						<div className='page-thread-actions'>
							<button type='button' className='btn' onClick={onPendingDone}>
								Annuler
							</button>
							<button type='submit' className='btn btn-primary' disabled={!draft.trim()}>
								Commenter
							</button>
						</div>
					</form>
				)}
				{items === null ? (
					<div className='spinner' aria-busy />
				) : shown.length === 0 && !pending ? (
					<p className='page-comments-empty'>{tab === 'open' ? (canWrite ? 'Sélectionne du texte puis « Commenter » pour ouvrir une discussion.' : 'Aucune discussion ouverte.') : 'Aucune discussion résolue.'}</p>
				) : (
					shown.map((thread) => (
						<section
							key={thread.id}
							ref={thread.id === focus ? (el) => void (focusRef.current = el) : undefined}
							className={`page-thread${thread.id === focus ? ' page-thread-focus' : ''}`}
						>
							{thread.list[0]!.quote && <blockquote>{thread.list[0]!.quote}</blockquote>}
							{thread.list.map((c) => {
								const author = members.get(c.authorId);
								return (
									<div key={c.id} className='page-comment'>
										<Avatar name={author?.name ?? '?'} url={author?.avatarUrl} size={24} />
										<div className='grow'>
											<div className='page-comment-meta'>
												<strong>{author?.name ?? 'Ancien membre'}</strong>
												<time>{when(c.createdAt)}</time>
												{c.authorId === myId && (
													<button type='button' className='page-comment-del' aria-label='Supprimer ce commentaire' onClick={() => void remove(c)}>
														<Icon name='trash' size={13} />
													</button>
												)}
											</div>
											<p>{c.body}</p>
										</div>
									</div>
								);
							})}
							<Reply onSend={(body) => post(thread.id, body).then(() => undefined)} />
							<div className='page-thread-actions'>
								<button type='button' className='btn' onClick={() => void resolve(thread.list[0]!, !thread.resolved)}>
									<Icon name={thread.resolved ? 'repeat' : 'check'} size={14} /> {thread.resolved ? 'Rouvrir' : 'Résoudre'}
								</button>
							</div>
						</section>
					))
				)}
			</div>
		</aside>
	);
}

function Reply({ onSend }: { onSend: (body: string) => Promise<void> }) {
	const [text, setText] = useState('');
	const [busy, setBusy] = useState(false);
	const send = async () => {
		if (!text.trim() || busy) {
			return;
		}
		setBusy(true);
		try {
			await onSend(text);
			setText('');
		} finally {
			setBusy(false);
		}
	};
	return (
		<textarea
			className='field page-reply'
			rows={1}
			value={text}
			placeholder='Répondre, Entrée pour envoyer'
			aria-label='Répondre'
			onChange={(e) => setText(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey) {
					e.preventDefault();
					void send();
				}
			}}
		/>
	);
}
