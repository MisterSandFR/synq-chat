import { useState, type FormEvent } from 'react';

import type { MailAiInput, MailAiResult } from '../../shared/mail';
import { api, errorText } from '../api';
import { Icon } from '../ui';

export function AiBox({ threadId, onClose }: { threadId: string; onClose: () => void }) {
	const [prompt, setPrompt] = useState('');
	const [answer, setAnswer] = useState<{ title: string; text: string } | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = async (input: MailAiInput, title: string) => {
		setBusy(true);
		setError(null);
		try {
			const result = await api<MailAiResult>('POST', `/mail/threads/${threadId}/ai`, input);
			setAnswer({ title, text: result.text?.trim() || 'Pas de réponse.' });
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	const ask = (event: FormEvent) => {
		event.preventDefault();
		const question = prompt.trim();
		if (question) {
			void run({ action: 'ask', prompt: question }, question);
		}
	};

	return (
		<section className='mail-ai'>
			<form className='mail-ai-ask' onSubmit={ask}>
				<Icon name='sparkle' size={16} />
				<input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder='Demande-moi n’importe quoi sur ce fil' maxLength={500} autoFocus />
				<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => void run({ action: 'summary' }, 'Résumé')}>
					Résumer
				</button>
				<button className='btn btn-primary' disabled={busy || !prompt.trim()}>
					Demander
				</button>
				<button type='button' className='icon-btn icon-btn-sm' onClick={onClose} title='Fermer' aria-label='Fermer'>
					<Icon name='close' size={15} />
				</button>
			</form>
			{busy && <div className='spinner' aria-busy />}
			{error && <p className='notice notice-error'>{error}</p>}
			{answer && !busy && (
				<div className='mail-ai-answer'>
					<strong>{answer.title}</strong>
					<p>{answer.text}</p>
				</div>
			)}
		</section>
	);
}
