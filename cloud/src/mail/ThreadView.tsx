import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import type { MailAssignee, MailboxInfo, MailDraft, MailMessage, MailThreadDetail } from '../../shared/mail';
import type { Me, WorkspaceSummary } from '../../shared/types';
import { api, errorText } from '../api';
import { Icon } from '../ui';
import { AiBox } from './AiBox';
import { newSeed, seedFromDraft, type ComposeSeed } from './Composer';
import { DraftCard } from './DraftCard';
import { formatAddress, forwardSubject, longDate, replySubject, replyTargets } from './format';
import { MessageCard } from './MessageCard';
import { QuickReplies } from './QuickReplies';
import { ThreadSummary } from './Summary';
import { ThreadToolbar, type ThreadPatch } from './ThreadToolbar';

type Props = {
	id: string;
	me: Me;
	boxes: MailboxInfo[];
	workspaces: WorkspaceSummary[];
	version: number;
	openDrafts: string[];
	onBack: () => void;
	onChanged: () => Promise<void>;
	onCompose: (seed: ComposeSeed) => void;
	onSent: (detail: MailThreadDetail) => void;
	onRead: () => void;
	onUnread: () => void;
};

const CONTEXT_MAX = 4000;
const LONG_THREAD = 1500;

// Message cité pour l'assistant de rédaction.
const quoted = (message: MailMessage) => `De : ${message.fromName ? `${message.fromName} <${message.fromAddr}>` : message.fromAddr}\nObjet : ${message.subject}\n\n${message.body}`.slice(0, CONTEXT_MAX);

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function ThreadView({ id, me, boxes, workspaces, version, openDrafts, onBack, onChanged, onCompose, onSent, onRead, onUnread }: Props) {
	const [detail, setDetail] = useState<MailThreadDetail | null>(null);
	const [drafts, setDrafts] = useState<MailDraft[]>([]);
	const [members, setMembers] = useState<MailAssignee[]>([]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [aiOpen, setAiOpen] = useState(false);
	const [noting, setNoting] = useState(false);
	const [note, setNote] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const read = useRef(onRead);
	read.current = onRead;

	const load = useCallback(async () => {
		try {
			const next = await api<MailThreadDetail>('GET', `/mail/threads/${id}`);
			setDetail(next);
			read.current();
			const last = next.messages[next.messages.length - 1];
			setExpanded((current) => (last && !current.has(last.id) ? new Set([...current, last.id]) : current));
		} catch (e) {
			setError(errorText(e));
		}
		api<MailDraft[]>('GET', `/mail/drafts?thread=${encodeURIComponent(id)}`)
			.then(setDrafts)
			.catch(() => setDrafts([]));
	}, [id]);

	useEffect(() => {
		void load();
	}, [load, version]);

	const box = detail ? boxes.find((b) => b.id === detail.thread.mailboxId) : undefined;
	const boxId = box?.id;
	const boxReply = !!box?.access.reply;

	// Attribuables : au moins le niveau réponse, calculé par le serveur.
	useEffect(() => {
		if (!boxId || !boxReply) {
			setMembers([]);
			return;
		}
		let cancelled = false;
		void api<MailAssignee[]>('GET', `/mail/boxes/${boxId}/assignees`)
			.then((list) => !cancelled && setMembers(list))
			.catch(() => !cancelled && setMembers([]));
		return () => {
			cancelled = true;
		};
	}, [boxId, boxReply, version]);

	const run = async (task: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await task();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	const patch = (body: ThreadPatch) =>
		run(async () => {
			await api('PATCH', `/mail/threads/${id}`, body);
			await onChanged();
			// Traité ou mis en attente : le fil quitte la liste courante.
			if (body.status === 'done' || (body.snoozedUntil && body.snoozedUntil > Date.now())) {
				onBack();
			} else {
				await load();
			}
		});

	const remove = () => {
		if (confirm('Mettre ce fil à la corbeille ? Rien n’est supprimé sur le serveur mail.')) {
			void run(async () => {
				await api('DELETE', `/mail/threads/${id}`);
				await onChanged();
				onBack();
			});
		}
	};

	const lastMessage = detail?.messages[detail.messages.length - 1];
	const lastIncoming = detail ? ([...detail.messages].reverse().find((message) => message.direction === 'in') ?? lastMessage) : undefined;

	const reply = (message: MailMessage | undefined, all: boolean, text = '') => {
		if (!detail || !message) {
			return;
		}
		const targets = replyTargets(message, box?.address ?? '', all);
		onCompose(
			newSeed({
				mailboxId: detail.thread.mailboxId,
				threadId: detail.thread.id,
				to: targets.to.map(formatAddress).join(', '),
				cc: targets.cc.map(formatAddress).join(', '),
				subject: replySubject(detail.thread.subject),
				text,
				context: quoted(message),
			}),
		);
	};

	const forward = (message: MailMessage | undefined) => {
		if (!detail || !message) {
			return;
		}
		// Le serveur ajoute lui-même le message d'origine sous le texte.
		onCompose(newSeed({ mailboxId: detail.thread.mailboxId, forwardOf: message.id, subject: forwardSubject(message.subject || detail.thread.subject), text: '', context: quoted(message) }));
	};

	const addNote = (event: FormEvent) => {
		event.preventDefault();
		if (!note.trim()) {
			return;
		}
		void run(async () => {
			await api('POST', `/mail/threads/${id}/notes`, { body: note });
			setNote('');
			setNoting(false);
			await load();
		});
	};

	const canReply = Boolean(detail?.access.reply);
	const actions = useRef({ patch, remove, reply, forward, onBack, detail, lastIncoming, lastMessage, canReply });
	actions.current = { patch, remove, reply, forward, onBack, detail, lastIncoming, lastMessage, canReply };

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target) || document.querySelector('dialog[open], .mail-pop')) {
				return;
			}
			const a = actions.current;
			if (event.key === 'Escape') {
				a.onBack();
			} else if (a.canReply && a.detail) {
				const handlers: Record<string, () => void> = {
					e: () => void a.patch({ status: a.detail!.thread.status === 'open' ? 'done' : 'open' }),
					r: () => a.reply(a.lastIncoming, false),
					f: () => a.forward(a.lastMessage),
					'#': () => a.remove(),
				};
				const handler = handlers[event.key];
				if (handler) {
					event.preventDefault();
					handler();
				}
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	if (!detail) {
		return error ? <p className='notice notice-error'>{error}</p> : <div className='spinner' aria-busy />;
	}
	const { thread, messages, notes } = detail;
	const toggle = (messageId: string) =>
		setExpanded((current) => {
			const next = new Set(current);
			if (!next.delete(messageId)) {
				next.add(messageId);
			}
			return next;
		});
	const visibleDrafts = drafts.filter((draft) => !openDrafts.includes(draft.id));

	return (
		<div className='mail-read'>
			<ThreadToolbar
				thread={thread}
				canReply={canReply}
				busy={busy}
				aiOpen={aiOpen}
				meId={me.user.id}
				members={members}
				workspaces={workspaces}
				onBack={onBack}
				onPatch={(body) => void patch(body)}
				onDelete={remove}
				onAi={() => setAiOpen(!aiOpen)}
				onReply={(all) => reply(lastIncoming, all)}
				onForward={() => forward(lastMessage)}
				onNote={() => setNoting(true)}
				onUnread={onUnread}
			/>
			<div className='mail-read-body'>
				<header className='mail-read-title'>
					<h2>
						{thread.pinned && <Icon name='pin' size={16} />}
						{thread.subject || '(sans objet)'}
					</h2>
					<span>
						{box ? `${box.name} · ${box.address}` : ''}
						{thread.snoozedUntil && thread.snoozedUntil > Date.now() && ` · rappel ${longDate(thread.snoozedUntil)}`}
					</span>
				</header>
				{(messages.length >= 3 || messages.reduce((n, message) => n + message.body.length, 0) > LONG_THREAD) && <ThreadSummary key={thread.id} threadId={thread.id} />}
				{aiOpen && <AiBox threadId={thread.id} onClose={() => setAiOpen(false)} />}
				{error && <p className='notice notice-error'>{error}</p>}
				{messages.map((message) => (
					<MessageCard
						key={message.id}
						message={message}
						expanded={expanded.has(message.id)}
						canReply={canReply}
						onToggle={() => toggle(message.id)}
						onReply={(target, all) => reply(target, all)}
						onForward={forward}
					/>
				))}
				{visibleDrafts.map((draft) => (
					<DraftCard key={draft.id} draft={draft} onEdit={() => onCompose(seedFromDraft(draft))} onChanged={() => void load()} onSent={onSent} />
				))}
				{notes.length > 0 && (
					<section className='mail-notes'>
						<h3>Notes internes</h3>
						{notes.map((item) => (
							<div key={item.id} className='mail-note'>
								<header>
									<strong>{item.authorName}</strong>
									<time>{longDate(item.createdAt)}</time>
								</header>
								<p>{item.body}</p>
							</div>
						))}
					</section>
				)}
				{noting && (
					<form className='mail-note-form' onSubmit={addNote}>
						<textarea className='mail-textarea' value={note} onChange={(e) => setNote(e.target.value)} placeholder='Visible uniquement par l’équipe' maxLength={2000} autoFocus />
						<div className='mail-form-actions'>
							<button type='button' className='btn btn-ghost' onClick={() => setNoting(false)}>
								Annuler
							</button>
							<button className='btn btn-primary' disabled={busy || !note.trim()}>
								Ajouter la note
							</button>
						</div>
					</form>
				)}
				{canReply && (
					<footer className='mail-read-foot'>
						<QuickReplies threadId={thread.id} onPick={(text) => reply(lastIncoming, false, text)} />
						<div className='mail-read-actions'>
							<button className='btn' onClick={() => reply(lastIncoming, false)}>
								<Icon name='reply' size={16} />
								Répondre
							</button>
							<button className='btn btn-ghost' onClick={() => forward(lastMessage)}>
								<Icon name='forward' size={16} />
								Transférer
							</button>
							{!noting && (
								<button className='btn btn-ghost' onClick={() => setNoting(true)}>
									<Icon name='pencil' size={16} />
									Note interne
								</button>
							)}
						</div>
					</footer>
				)}
			</div>
		</div>
	);
}
