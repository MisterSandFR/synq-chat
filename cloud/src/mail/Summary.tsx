import { useRef, useState } from 'react';

import type { MailAiInput, MailAiResult } from '../../shared/mail';
import { ApiError, api, errorText } from '../api';
import { Icon } from '../ui';

// Limite et indisponibilité de l'IA dites en clair.
export function aiErrorText(error: unknown): string {
	if (error instanceof ApiError && error.status === 429) {
		return 'Trop de demandes à l’IA. Réessaie dans une minute.';
	}
	if (error instanceof ApiError && error.status === 503) {
		return 'IA indisponible pour le moment.';
	}
	return errorText(error);
}

const bullets = (text: string) =>
	text
		.split('\n')
		.map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
		.filter(Boolean);

export function ThreadSummary({ threadId }: { threadId: string }) {
	const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
	const [points, setPoints] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const run = useRef(0);

	const start = async () => {
		const id = ++run.current;
		setState('busy');
		setError(null);
		try {
			const result = await api<MailAiResult>('POST', `/mail/threads/${threadId}/ai`, { action: 'summary' } satisfies MailAiInput);
			if (id === run.current) {
				setPoints(bullets(result.text ?? ''));
				setState('done');
			}
		} catch (e) {
			if (id === run.current) {
				setError(aiErrorText(e));
				setState('idle');
			}
		}
	};

	const close = () => {
		run.current++;
		setState('idle');
		setPoints([]);
		setError(null);
	};

	if (state === 'idle') {
		return (
			<div className='mail-summary-cta'>
				<button className='btn btn-ghost' onClick={() => void start()}>
					<Icon name='sparkle' size={15} />
					Résumer le fil
				</button>
				{error && <span className='mail-summary-error'>{error}</span>}
			</div>
		);
	}
	return (
		<section className='mail-summary' aria-busy={state === 'busy'}>
			<header>
				<Icon name='sparkle' size={15} />
				<strong>Résumé du fil</strong>
				<button className='icon-btn icon-btn-sm' onClick={close} title={state === 'busy' ? 'Annuler' : 'Fermer'} aria-label={state === 'busy' ? 'Annuler' : 'Fermer'}>
					<Icon name='close' size={14} />
				</button>
			</header>
			{state === 'busy' ? (
				<div className='mail-skeleton'>
					<span />
					<span />
					<span />
				</div>
			) : points.length ? (
				<ul>
					{points.map((point, i) => (
						<li key={i}>{point}</li>
					))}
				</ul>
			) : (
				<p className='muted'>Pas de résumé.</p>
			)}
		</section>
	);
}
