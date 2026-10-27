import { useEffect, useRef, useState } from 'react';

import { AI_CHAT_LIMITS, type AiAnswer } from '../../shared/ai-chat';
import type { Channel, Message } from '../../shared/types';
import { api } from '../api';
import { excerpt, type Lookup } from '../workspace/richText';
import { AiBlock } from './AiBlock';
import { aiErrorText, isAbort, splitCitations } from './parse';

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

type Props = { workspaceId: string; channels: Channel[]; lookup: Lookup; onOpenMessage: (message: Message) => void };

export function AskPanel({ workspaceId, channels, lookup, onOpenMessage }: Props) {
	const [question, setQuestion] = useState('');
	const [asked, setAsked] = useState('');
	const [answer, setAnswer] = useState<AiAnswer | null>(null);
	const [error, setError] = useState<string | null>(null);
	const ctrl = useRef<AbortController | null>(null);

	useEffect(() => () => ctrl.current?.abort(), []);

	const ask = (q: string) => {
		if (q.trim().length < 3) {
			setError('Pose une question un peu plus longue.');
			setAsked(q);
			return;
		}
		ctrl.current?.abort();
		const next = new AbortController();
		ctrl.current = next;
		setAsked(q);
		setAnswer(null);
		setError(null);
		api<AiAnswer>('POST', `/w/${workspaceId}/ai/ask`, { question: q.trim() }, next.signal)
			.then(setAnswer)
			.catch((e: unknown) => !isAbort(e) && setError(aiErrorText(e)));
	};

	const cancel = () => {
		ctrl.current?.abort();
		setAsked('');
	};

	const where = (m: Message) => channels.find((c) => c.id === m.channelId)?.name ?? '?';

	return (
		<>
			<form
				className='palette-input'
				onSubmit={(e) => {
					e.preventDefault();
					ask(question);
				}}
			>
				<span aria-hidden className='ai-glyph'>
					✦
				</span>
				<input
					autoFocus
					value={question}
					maxLength={AI_CHAT_LIMITS.question}
					placeholder='Pose une question sur tes conversations'
					aria-label='Question pour Synq'
					onChange={(e) => setQuestion(e.target.value)}
				/>
				<kbd>Entrée</kbd>
			</form>
			<div className='palette-results'>
				{!asked && <p className='drive-empty'>Synq répond à partir des messages que tu peux voir, avec ses sources.</p>}
				{asked && (
					<AiBlock label={asked} text={answer ? answer.text : null} error={error} onCancel={cancel} onRetry={() => ask(asked)}>
						{answer && (
							<div className='ai-answer'>
								<p className='ai-block-text'>
									{splitCitations(answer.text, answer.sources.length).map((part, i) =>
										'cite' in part ? (
											<button
												key={i}
												type='button'
												className='ai-cite'
												title='Ouvrir le message'
												onClick={() => onOpenMessage(answer.sources[part.cite - 1]!)}
											>
												{part.cite}
											</button>
										) : (
											<span key={i}>{part.text}</span>
										),
									)}
								</p>
								{answer.sources.length > 0 && (
									<ol className='ai-sources'>
										{answer.sources.map((m, i) => (
											<li key={m.id}>
												<button type='button' className='menu-item ai-source' onClick={() => onOpenMessage(m)}>
													<span className='ai-cite' aria-hidden>
														{i + 1}
													</span>
													<span className='grow' style={{ minWidth: 0 }}>
														<span className='row muted' style={{ gap: 6, fontSize: 12 }}>
															<strong style={{ fontWeight: 600, color: 'var(--text)' }}>
																{lookup.members.get(m.userId)?.name ?? 'Ancien membre'}
															</strong>
															#{where(m)}, {when.format(m.createdAt)}
														</span>
														<span className='ellipsis' style={{ display: 'block', fontSize: 13 }}>
															{excerpt(m.body, lookup, 120) || 'Fichier joint'}
														</span>
													</span>
												</button>
											</li>
										))}
									</ol>
								)}
							</div>
						)}
					</AiBlock>
				)}
			</div>
		</>
	);
}
