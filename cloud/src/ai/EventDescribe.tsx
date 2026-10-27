import { useEffect, useRef, useState } from 'react';

import { AI_CHAT_LIMITS, type AiParsedEvent } from '../../shared/ai-chat';
import { api } from '../api';
import { userTimeZone } from '../calendar/dates';
import { aiErrorText, isAbort } from './parse';
import './ai.css';

type Props = { workspaceId: string | null; onParsed: (event: AiParsedEvent) => void };

// Champ libre analysé par l'IA pour pré-remplir un formulaire d'événement.
export function EventDescribe({ workspaceId, onParsed }: Props) {
	const [text, setText] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const ctrl = useRef<AbortController | null>(null);

	useEffect(() => () => ctrl.current?.abort(), []);

	const run = () => {
		if (!text.trim()) {
			return;
		}
		ctrl.current?.abort();
		const next = new AbortController();
		ctrl.current = next;
		setBusy(true);
		setError(null);
		api<AiParsedEvent>(
			'POST',
			'/ai/parse-event',
			{ text: text.trim(), timezone: userTimeZone(), now: Date.now(), workspaceId },
			next.signal,
		)
			.then(onParsed)
			.catch((e: unknown) => !isAbort(e) && setError(aiErrorText(e)))
			.finally(() => ctrl.current === next && setBusy(false));
	};

	return (
		<div className='ai-describe'>
			<label className='sr-only' htmlFor='ai-describe'>
				Décris l’événement
			</label>
			<div className='ai-describe-row'>
				<input
					id='ai-describe'
					value={text}
					maxLength={AI_CHAT_LIMITS.eventText}
					placeholder='Décris l’événement : « point produit jeudi 14 h, 45 min, avec Léa »'
					disabled={busy}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => {
						// Entrée remplit le formulaire au lieu de l'envoyer.
						if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
							e.preventDefault();
							run();
						}
					}}
				/>
				{busy ? (
					<button
						type='button'
						className='btn btn-ghost'
						onClick={() => {
							ctrl.current?.abort();
							setBusy(false);
						}}
					>
						Annuler
					</button>
				) : (
					<button
						type='button'
						className='icon-btn'
						aria-label='Remplir avec l’IA'
						title='Remplir avec l’IA'
						disabled={!text.trim()}
						onClick={run}
					>
						<span aria-hidden className='ai-glyph'>
							✦
						</span>
					</button>
				)}
			</div>
			{busy && <div className='ai-describe-progress' aria-label='Analyse en cours' />}
			{error && <p className='notice notice-error'>{error}</p>}
		</div>
	);
}
