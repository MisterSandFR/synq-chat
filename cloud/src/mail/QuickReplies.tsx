import { useState } from 'react';

import type { MailAiResult } from '../../shared/mail';
import { api, errorText } from '../api';
import { Icon } from '../ui';

type Suggestion = { label: string; text: string };

export const DEFAULT_REPLIES: Suggestion[] = [
	{ label: 'Intéressé', text: 'Bonjour,\n\nMerci pour votre message, cela m’intéresse. Pouvez-vous m’en dire plus ?\n\nCordialement' },
	{ label: 'Pas intéressé', text: 'Bonjour,\n\nMerci pour votre message, mais ce n’est pas pour moi en ce moment.\n\nCordialement' },
	{ label: 'Merci', text: 'Bonjour,\n\nMerci beaucoup !\n\nCordialement' },
];

export function QuickReplies({ threadId, onPick }: { threadId: string; onPick: (text: string) => void }) {
	const [suggestions, setSuggestions] = useState(DEFAULT_REPLIES);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const suggest = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await api<MailAiResult>('POST', `/mail/threads/${threadId}/ai`, { action: 'quick' });
			if (result.suggestions?.length) {
				setSuggestions(result.suggestions.slice(0, 3));
			}
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className='mail-quick'>
			{suggestions.map((suggestion) => (
				<button key={suggestion.label} type='button' className='mail-chip' title={suggestion.text} onClick={() => onPick(suggestion.text)}>
					{suggestion.label}
				</button>
			))}
			<button type='button' className='mail-chip mail-chip-ai' disabled={busy} onClick={() => void suggest()} title='Suggestions adaptées au message'>
				<Icon name='sparkle' size={14} />
				{busy ? 'Réflexion…' : 'Suggérer'}
			</button>
			{error && <span className='mail-quick-error'>{error}</span>}
		</div>
	);
}
