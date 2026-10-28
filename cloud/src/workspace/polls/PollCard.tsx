import { useEffect, useState, type FormEvent } from 'react';

import { POLL_LIMITS, pollClosed, pollWinners, type Poll } from '../../../shared/polls';
import type { Message } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Avatar, Icon } from '../../ui';
import { CustomEmojiImg, customOf } from '../emojis/customEmojis';
import type { Lookup } from '../richText';
import { POLL_EVENT, publishPoll, rememberMine, type PollEventDetail } from './store';
import './polls.css';

type Props = { workspaceId: string; message: Message; lookup: Lookup; canManage?: boolean };

const SHOWN_AVATARS = 3;

function remaining(closesAt: number, now: number): string {
	const minutes = Math.max(1, Math.round((closesAt - now) / 60_000));
	if (minutes < 60) {
		return `Se termine dans ${minutes} min`;
	}
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `Se termine dans ${hours} h` : `Se termine dans ${Math.round(hours / 24)} jours`;
}

const endedAt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function PollCard({ workspaceId, message, lookup, canManage = false }: Props) {
	const [live, setLive] = useState<Poll | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [adding, setAdding] = useState(false);
	const [draft, setDraft] = useState('');
	const [now, setNow] = useState(() => Date.now());
	const poll = live ?? message.poll!;

	// Message rafraîchi par le salon : il fait foi.
	useEffect(() => setLive(null), [message.poll]);

	useEffect(() => {
		const onPoll = (e: Event) => {
			const detail = (e as CustomEvent<PollEventDetail>).detail;
			if (detail.messageId === message.id) {
				setLive(detail.poll);
			}
		};
		window.addEventListener(POLL_EVENT, onPoll);
		return () => window.removeEventListener(POLL_EVENT, onPoll);
	}, [message.id]);

	const closed = pollClosed(poll, now);
	useEffect(() => {
		if (closed || poll.closesAt === null) {
			return;
		}
		const timer = window.setInterval(() => setNow(Date.now()), 30_000);
		return () => window.clearInterval(timer);
	}, [closed, poll.closesAt]);

	const known = rememberMine(message.id, poll);
	const mine = new Set(poll.anonymous ? (known ?? []) : poll.options.filter((o) => o.voters?.includes(lookup.myId)).map((o) => o.id));
	const total = poll.options.reduce((sum, o) => sum + o.count, 0);
	const winners = new Set(closed ? pollWinners(poll) : []);
	const author = message.userId === lookup.myId;
	const canAdd = !closed && (poll.allowAdd || author) && poll.options.length < POLL_LIMITS.maxOptions;

	const run = async (method: string, path: string, body?: unknown) => {
		setBusy(true);
		setError('');
		try {
			const next = await api<Poll>(method, `/w/${workspaceId}/polls/${message.id}${path}`, body);
			setLive(next);
			publishPoll({ messageId: message.id, poll: next });
			return true;
		} catch (e) {
			setError(errorText(e));
			return false;
		} finally {
			setBusy(false);
		}
	};

	const choose = (id: string) => {
		const next = poll.multiple ? (mine.has(id) ? [...mine].filter((o) => o !== id) : [...mine, id]) : mine.has(id) ? [] : [id];
		void run('PUT', '/votes', { optionIds: next });
	};

	const addOption = async (e: FormEvent) => {
		e.preventDefault();
		if (draft.trim() && (await run('POST', '/options', { text: draft }))) {
			setDraft('');
			setAdding(false);
		}
	};

	const hint = closed ? 'Résultats finaux' : poll.multiple ? 'Plusieurs choix possibles' : 'Un seul choix';

	return (
		<section className={`poll${closed ? ' poll-closed' : ''}`} aria-label={`Sondage : ${poll.question}`}>
			<header className='poll-head'>
				<span className='poll-icon' aria-hidden>
					<Icon name='poll' size={16} />
				</span>
				<div className='poll-title'>
					<strong>{poll.question}</strong>
					<span className='poll-hint'>
						{hint}
						{poll.anonymous && <span className='poll-anon'>Vote anonyme</span>}
					</span>
				</div>
			</header>
			<ul className='poll-options'>
				{poll.options.map((option) => {
					const pct = total ? Math.round((option.count / total) * 100) : 0;
					const chosen = mine.has(option.id);
					const custom = option.emoji ? customOf(option.emoji, lookup.emojis) : null;
					const voters = option.voters ?? [];
					const names = voters.map((id) => lookup.members.get(id)?.name ?? 'Ancien membre');
					return (
						<li key={option.id}>
							<button
								type='button'
								className={`poll-option${chosen ? ' is-mine' : ''}${winners.has(option.id) ? ' is-winner' : ''}`}
								aria-pressed={chosen}
								disabled={closed || busy}
								onClick={() => choose(option.id)}
							>
								<span className='poll-fill' style={{ width: `${pct}%` }} aria-hidden />
								<span className={`poll-mark${poll.multiple ? ' poll-mark-square' : ''}`} aria-hidden>
									{chosen && <Icon name='check' size={12} strokeWidth={3} />}
								</span>
								{option.emoji && <span className='poll-emoji'>{custom ? <CustomEmojiImg emoji={custom} /> : option.emoji}</span>}
								<span className='poll-text'>{option.text}</span>
								{winners.has(option.id) && <span className='poll-badge'>{winners.size > 1 ? 'Ex aequo' : 'Gagnant'}</span>}
								{voters.length > 0 && (
									<span className='poll-voters' title={names.join(', ')}>
										{voters.slice(0, SHOWN_AVATARS).map((id) => {
											const member = lookup.members.get(id);
											return <Avatar key={id} name={member?.name ?? '?'} url={member?.avatarUrl ?? null} size={20} />;
										})}
										{option.count > SHOWN_AVATARS && <span className='poll-more'>+{option.count - SHOWN_AVATARS}</span>}
									</span>
								)}
								<span className='poll-pct'>
									{pct} %<span className='sr-only'>, {option.count} vote{option.count > 1 ? 's' : ''}</span>
								</span>
							</button>
						</li>
					);
				})}
			</ul>
			{adding && (
				<form className='poll-add' onSubmit={addOption}>
					<input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={POLL_LIMITS.option} placeholder='Nouvelle option' aria-label='Nouvelle option' autoFocus />
					<button className='btn btn-primary' disabled={busy || !draft.trim()}>
						Ajouter
					</button>
					<button type='button' className='btn' onClick={() => (setAdding(false), setDraft(''))}>
						Annuler
					</button>
				</form>
			)}
			<footer className='poll-foot'>
				<span className='poll-meta'>
					<span>
						{poll.voters} votant{poll.voters > 1 ? 's' : ''}
					</span>
					<span>{closed ? `Terminé le ${endedAt.format(poll.closedAt ?? poll.closesAt ?? now)}` : poll.closesAt === null ? 'Sans fin' : remaining(poll.closesAt, now)}</span>
				</span>
				<span className='poll-actions'>
					{!closed && mine.size > 0 && (
						<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => void run('DELETE', '/votes')}>
							Retirer mon vote
						</button>
					)}
					{canAdd && !adding && (
						<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => setAdding(true)}>
							Ajouter une option
						</button>
					)}
					{!closed && (author || canManage) && (
						<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => void run('POST', '/close')}>
							Clore le sondage
						</button>
					)}
				</span>
			</footer>
			{error && (
				<p className='notice notice-error' role='alert'>
					{error}
				</p>
			)}
		</section>
	);
}
