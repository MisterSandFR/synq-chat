import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

import { ABSENCE_KINDS, type AbsenceKind } from '../../../shared/absences';
import type { AiAction, AiConversation, AiConversationDetail, AiDone, AiIntent, AiSource, AiTurn, AiTurnReply } from '../../../shared/ai-hub';
import type { ListSummary } from '../../../shared/lists';
import { api } from '../../api';
import { navigate, usePath } from '../../router';
import { Icon, type IconName } from '../../ui';
import { aiErrorText, splitCitations } from '../parse';
import { PLACEHOLDER, readContext, suggestionsFor, type Suggestion } from './context';
import './hub.css';

const SOURCE_ICON: Record<AiSource['kind'], IconName> = { message: 'chat', mail: 'mail', event: 'calendar', page: 'file', item: 'list' };
const SOURCE_LABEL: Record<AiSource['kind'], string> = { message: 'Message', mail: 'Mail', event: 'Événement', page: 'Page', item: 'Élément de base' };
const WIDTH_KEY = 'synq:ai-hub-width';

const savedWidth = () => {
	try {
		return Math.min(640, Math.max(320, Number(localStorage.getItem(WIDTH_KEY)) || 400));
	} catch {
		return 400;
	}
};

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Ctrl J ou Cmd J hors champ de saisie.
export function useAiShortcut(toggle: () => void): void {
	useEffect(() => {
		const onKey = (event: globalThis.KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j' && !typing) {
				event.preventDefault();
				toggle();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [toggle]);
}

export function SynqAiPanel({ workspaceId, onClose }: { workspaceId: string | null; onClose: () => void }) {
	usePath();
	const here = readContext(workspaceId);
	const [width, setWidth] = useState(savedWidth);
	const [conversation, setConversation] = useState<AiConversationDetail | null>(null);
	const [history, setHistory] = useState<AiConversation[] | null>(null);
	const [text, setText] = useState('');
	const [mode, setMode] = useState<Suggestion | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const body = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLTextAreaElement>(null);

	useEffect(() => input.current?.focus(), []);
	useEffect(() => {
		body.current?.scrollTo({ top: body.current.scrollHeight });
	}, [conversation?.turns.length, busy]);

	const send = async (intent: AiIntent, value: string) => {
		setBusy(true);
		setError('');
		try {
			const reply = await api<AiTurnReply>('POST', '/ai/hub/turns', {
				conversationId: conversation?.id ?? null,
				text: value,
				intent,
				context: readContext(workspaceId).ctx,
				timezone: zone(),
				listId: null,
			});
			setConversation((current) => ({ ...reply.conversation, turns: [...(current?.id === reply.conversation.id ? current.turns : []), ...reply.turns] }));
			setText('');
			setMode(null);
		} catch (e) {
			setError(aiErrorText(e));
		} finally {
			setBusy(false);
		}
	};

	const submit = () => {
		const value = text.trim();
		if (!busy && (value || (mode && !mode.needsText))) {
			void send(mode?.intent ?? 'ask', value);
		}
	};

	const pick = (s: Suggestion) => {
		if (s.needsText) {
			setMode(s);
			input.current?.focus();
		} else {
			void send(s.intent, '');
		}
	};

	const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submit();
		} else if (event.key === 'Escape') {
			mode ? setMode(null) : onClose();
		}
	};

	const openHistory = async () => {
		setError('');
		try {
			setHistory(await api<AiConversation[]>('GET', '/ai/hub/conversations'));
		} catch (e) {
			setError(aiErrorText(e));
		}
	};

	const resume = async (id: string) => {
		try {
			setConversation(await api<AiConversationDetail>('GET', `/ai/hub/conversations/${id}`));
			setHistory(null);
		} catch (e) {
			setError(aiErrorText(e));
		}
	};

	const remove = async (id: string) => {
		await api('DELETE', `/ai/hub/conversations/${id}`).catch(() => undefined);
		setHistory((list) => list?.filter((c) => c.id !== id) ?? null);
		if (conversation?.id === id) {
			setConversation(null);
		}
	};

	const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		let last = width;
		const move = (e: PointerEvent) => {
			last = Math.min(640, Math.max(320, window.innerWidth - e.clientX));
			setWidth(last);
		};
		const up = () => {
			handle.removeEventListener('pointermove', move);
			try {
				localStorage.setItem(WIDTH_KEY, String(last));
			} catch {
				// Stockage indisponible : largeur oubliée.
			}
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up, { once: true });
	};

	const done = (turnId: number, action: AiAction, result: AiDone) =>
		setConversation((c) => (c ? { ...c, turns: c.turns.map((t) => (t.id === turnId ? { ...t, action, done: result } : t)) } : c));

	const turns = conversation?.turns ?? [];
	return (
		<aside className='hub' style={{ width }} aria-label='Synq IA'>
			<div className='hub-resize' role='separator' aria-orientation='vertical' aria-label='Redimensionner le panneau' onPointerDown={resize} />
			<header className='hub-head'>
				<span className='hub-title'>
					<Icon name='sparkle' size={18} /> Synq IA
				</span>
				<span className='grow' />
				<button type='button' className='icon-btn' title='Historique' aria-label='Historique des conversations' aria-pressed={history !== null} onClick={() => (history ? setHistory(null) : void openHistory())}>
					<Icon name='clock' />
				</button>
				<button
					type='button'
					className='icon-btn'
					title='Nouvelle conversation'
					aria-label='Nouvelle conversation'
					onClick={() => {
						setConversation(null);
						setHistory(null);
						setMode(null);
						input.current?.focus();
					}}
				>
					<Icon name='compose' />
				</button>
				<button type='button' className='icon-btn' title='Fermer (Ctrl J)' aria-label='Fermer Synq IA' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<div ref={body} className='hub-body'>
				{history ? (
					<History items={history} onOpen={(id) => void resume(id)} onDelete={(id) => void remove(id)} />
				) : turns.length === 0 ? (
					<div className='hub-welcome'>
						<h2>Que veux-tu savoir ?</h2>
						<p>Je cherche dans les messages, mails, événements, pages et bases que tu peux voir, et je cite mes sources.</p>
						<div className='hub-suggest'>
							{suggestionsFor(here.kind).map((s) => (
								<button key={s.label} type='button' disabled={busy} onClick={() => pick(s)}>
									<Icon name={s.needsText ? 'pencil' : 'sparkle'} size={16} />
									{s.label}
								</button>
							))}
						</div>
					</div>
				) : (
					turns.map((turn) => (turn.role === 'user' ? <p key={turn.id} className='hub-q'>{turn.text}</p> : <Answer key={turn.id} turn={turn} conversationId={conversation!.id} onDone={done} />))
				)}
				{busy && <div className='hub-thinking' aria-live='polite'>Synq IA réfléchit…</div>}
				{error && (
					<p className='notice notice-error' role='alert'>
						{error}
					</p>
				)}
			</div>
			<footer className='hub-foot'>
				<div className='hub-ctx'>
					<span className='hub-ctx-chip' title='Contexte transmis avec ta demande'>
						<Icon name='pin' size={13} /> {here.label}
					</span>
					{mode && (
						<button type='button' className='hub-mode' onClick={() => setMode(null)} aria-label={`Annuler : ${mode.label}`}>
							{mode.label} <Icon name='close' size={12} />
						</button>
					)}
				</div>
				<div className='hub-input'>
					<textarea
						ref={input}
						rows={1}
						value={text}
						maxLength={1000}
						placeholder={(mode && PLACEHOLDER[mode.intent]) || 'Pose une question, Entrée pour envoyer'}
						aria-label='Message pour Synq IA'
						onChange={(e) => setText(e.target.value)}
						onKeyDown={onKey}
					/>
					<button type='button' className='icon-btn hub-send' aria-label='Envoyer' disabled={busy || !(text.trim() || (mode && !mode.needsText))} onClick={submit}>
						<Icon name='send' size={16} />
					</button>
				</div>
			</footer>
		</aside>
	);
}

function History({ items, onOpen, onDelete }: { items: AiConversation[]; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
	if (!items.length) {
		return <p className='hub-empty'>Aucune conversation pour l’instant. Pose une question pour en commencer une.</p>;
	}
	const date = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
	return (
		<ul className='hub-history'>
			{items.map((c) => (
				<li key={c.id}>
					<button type='button' className='hub-history-open' onClick={() => onOpen(c.id)}>
						<span className='ellipsis'>{c.title}</span>
						<span className='hub-history-date'>{date.format(c.updatedAt)}</span>
					</button>
					<button type='button' className='icon-btn' aria-label={`Supprimer « ${c.title} »`} title='Supprimer' onClick={() => onDelete(c.id)}>
						<Icon name='trash' size={16} />
					</button>
				</li>
			))}
		</ul>
	);
}

function Answer({ turn, conversationId, onDone }: { turn: AiTurn; conversationId: string; onDone: (turnId: number, action: AiAction, done: AiDone) => void }) {
	const open = (source: AiSource) => navigate(source.href);
	return (
		<div className='hub-a'>
			<p className='hub-a-text'>
				{splitCitations(turn.text, turn.sources.length).map((part, i) =>
					'cite' in part ? (
						<button key={i} type='button' className='hub-cite' title={turn.sources[part.cite - 1]!.title} onClick={() => open(turn.sources[part.cite - 1]!)}>
							{part.cite}
						</button>
					) : (
						<span key={i}>{part.text}</span>
					),
				)}
			</p>
			{turn.sources.length > 0 && (
				<ol className='hub-sources' aria-label='Sources'>
					{turn.sources.map((s, i) => (
						<li key={`${s.kind}-${s.id}`}>
							<button type='button' className='hub-source' onClick={() => open(s)} title={`${SOURCE_LABEL[s.kind]} : ${s.title}`}>
								<span className={`hub-source-icon hub-kind-${s.kind}`}>
									<Icon name={SOURCE_ICON[s.kind]} size={14} />
								</span>
								<span className='hub-source-text'>
									<span className='hub-source-title ellipsis'>
										<span className='hub-source-n'>{i + 1}</span> {s.title}
									</span>
									{s.snippet && <span className='hub-source-snippet ellipsis'>{s.snippet}</span>}
								</span>
							</button>
						</li>
					))}
				</ol>
			)}
			{turn.action && <ActionCard turn={turn} action={turn.action} conversationId={conversationId} onDone={onDone} />}
		</div>
	);
}

const ACTION_TITLE: Record<AiAction['kind'], string> = { cards: 'Créer des cartes', event: 'Créer un événement', page: 'Créer une page', mail_reply: 'Enregistrer le brouillon', absence: 'Poser une absence' };

const localInput = (ms: number | undefined) => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '');

function ActionCard({ turn, action: initial, conversationId, onDone }: { turn: AiTurn; action: AiAction; conversationId: string; onDone: (turnId: number, action: AiAction, done: AiDone) => void }) {
	const [action, setAction] = useState<AiAction>(initial);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [lists, setLists] = useState<ListSummary[]>([]);
	const [dismissed, setDismissed] = useState(false);
	const workspaceId = action.kind === 'cards' ? action.workspaceId : null;

	useEffect(() => {
		if (workspaceId && !turn.done) {
			void api<ListSummary[]>('GET', `/w/${workspaceId}/lists`)
				.then(setLists)
				.catch(() => undefined);
		}
	}, [workspaceId, turn.done]);

	if (turn.done) {
		return (
			<div className='hub-done'>
				<Icon name='check' size={16} /> <span className='grow'>{turn.done.label}</span>
				{turn.done.href && (
					<button type='button' className='btn' onClick={() => navigate(turn.done!.href!)}>
						Ouvrir
					</button>
				)}
			</div>
		);
	}
	if (dismissed) {
		return <p className='hub-empty'>Action annulée.</p>;
	}
	const confirm = async () => {
		setBusy(true);
		setError('');
		try {
			onDone(turn.id, action, await api<AiDone>('POST', '/ai/hub/execute', { conversationId, turnId: turn.id, action }));
		} catch (e) {
			setError(aiErrorText(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className='hub-action'>
			<div className='hub-action-head'>
				<Icon name='pencil' size={14} /> Aperçu, modifiable avant confirmation
			</div>
			{action.kind === 'cards' && (
				<>
					<label className='hub-field'>
						<span>Base</span>
						<select
							value={action.listId}
							onChange={(e) => setAction({ ...action, listId: e.target.value, listTitle: lists.find((l) => l.id === e.target.value)?.title ?? action.listTitle })}
						>
							{!lists.some((l) => l.id === action.listId) && <option value={action.listId}>{action.listTitle}</option>}
							{lists.map((l) => (
								<option key={l.id} value={l.id}>
									{l.title}
								</option>
							))}
						</select>
					</label>
					<ul className='hub-cards'>
						{action.cards.map((card, i) => (
							<li key={i}>
								<input
									value={card.title}
									aria-label={`Carte ${i + 1}`}
									onChange={(e) => setAction({ ...action, cards: action.cards.map((c, j) => (j === i ? { ...c, title: e.target.value } : c)) })}
								/>
								<button type='button' className='icon-btn' aria-label={`Retirer la carte ${i + 1}`} onClick={() => setAction({ ...action, cards: action.cards.filter((_, j) => j !== i) })}>
									<Icon name='close' size={14} />
								</button>
							</li>
						))}
					</ul>
				</>
			)}
			{action.kind === 'event' && (
				<>
					<label className='hub-field'>
						<span>Titre</span>
						<input value={action.event.title ?? ''} onChange={(e) => setAction({ ...action, event: { ...action.event, title: e.target.value } })} />
					</label>
					<div className='hub-row'>
						<label className='hub-field'>
							<span>Début</span>
							<input
								type='datetime-local'
								value={localInput(action.event.startsAt)}
								onChange={(e) => {
									const startsAt = new Date(e.target.value).getTime();
									const length = (action.event.endsAt ?? 0) - (action.event.startsAt ?? 0);
									setAction({ ...action, event: { ...action.event, startsAt, endsAt: startsAt + (length > 0 ? length : 1_800_000) } });
								}}
							/>
						</label>
						<label className='hub-field'>
							<span>Fin</span>
							<input type='datetime-local' value={localInput(action.event.endsAt)} onChange={(e) => setAction({ ...action, event: { ...action.event, endsAt: new Date(e.target.value).getTime() } })} />
						</label>
					</div>
					<label className='hub-field'>
						<span>Lieu</span>
						<input value={action.event.location ?? ''} onChange={(e) => setAction({ ...action, event: { ...action.event, location: e.target.value } })} />
					</label>
				</>
			)}
			{action.kind === 'page' && (
				<>
					<label className='hub-field'>
						<span>Titre</span>
						<input value={action.title} onChange={(e) => setAction({ ...action, title: e.target.value })} />
					</label>
					<label className='hub-field'>
						<span>Contenu</span>
						<textarea rows={8} value={action.body} onChange={(e) => setAction({ ...action, body: e.target.value })} />
					</label>
				</>
			)}
			{action.kind === 'mail_reply' && (
				<>
					<label className='hub-field'>
						<span>À</span>
						<input value={action.to} onChange={(e) => setAction({ ...action, to: e.target.value })} />
					</label>
					<label className='hub-field'>
						<span>Objet</span>
						<input value={action.subject} onChange={(e) => setAction({ ...action, subject: e.target.value })} />
					</label>
					<label className='hub-field'>
						<span>Message</span>
						<textarea rows={7} value={action.text} onChange={(e) => setAction({ ...action, text: e.target.value })} />
					</label>
				</>
			)}
			{action.kind === 'absence' && (
				<>
					<label className='hub-field'>
						<span>Type</span>
						<select value={action.absence.kind ?? 'leave'} onChange={(e) => setAction({ ...action, absence: { ...action.absence, kind: e.target.value as AbsenceKind } })}>
							{ABSENCE_KINDS.map((k) => (
								<option key={k.value} value={k.value}>
									{k.label}
								</option>
							))}
						</select>
					</label>
					<div className='hub-row'>
						<label className='hub-field'>
							<span>Du</span>
							<input type='date' value={action.absence.startDay ?? ''} onChange={(e) => setAction({ ...action, absence: { ...action.absence, startDay: e.target.value } })} />
						</label>
						<label className='hub-field'>
							<span>Au</span>
							<input type='date' value={action.absence.endDay ?? ''} onChange={(e) => setAction({ ...action, absence: { ...action.absence, endDay: e.target.value } })} />
						</label>
					</div>
					<label className='hub-field'>
						<span>Note</span>
						<input value={action.absence.note ?? ''} onChange={(e) => setAction({ ...action, absence: { ...action.absence, note: e.target.value } })} />
					</label>
				</>
			)}
			{error && (
				<p className='notice notice-error' role='alert'>
					{error}
				</p>
			)}
			<div className='hub-action-foot'>
				<button type='button' className='btn' disabled={busy} onClick={() => setDismissed(true)}>
					Annuler
				</button>
				<button type='button' className='btn btn-primary' disabled={busy || (action.kind === 'cards' && !action.cards.some((c) => c.title.trim()))} onClick={() => void confirm()}>
					{busy ? 'En cours…' : ACTION_TITLE[action.kind]}
				</button>
			</div>
		</div>
	);
}
