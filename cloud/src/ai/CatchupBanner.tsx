import { useEffect, useRef, useState } from 'react';

import type { AiCatchup } from '../../shared/ai-chat';
import { api } from '../api';
import type { ChannelMessages } from '../workspace/useWorkspace';
import { Icon } from '../ui';
import { AiBlock } from './AiBlock';
import { aiErrorText, catchupAfter, isAbort } from './parse';

// Résumé utile seulement à partir de quelques messages.
const MIN_UNREAD = 3;

type Props = { workspaceId: string; channelId: string; unread: number; data: ChannelMessages | undefined; onJump: (id: number) => void };

// Monté par salon : `unread` lu au premier rendu, avant le marquage comme lu.
export function CatchupBanner({ workspaceId, channelId, unread, data, onJump }: Props) {
	const [count, setCount] = useState(unread);
	const [after, setAfter] = useState<number | null>(null);
	const [result, setResult] = useState<AiCatchup | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [state, setState] = useState<'idle' | 'open' | 'closed'>('idle');
	const ctrl = useRef<AbortController | null>(null);

	// Compteur suivi jusqu'au calcul de `after` : il peut arriver après le premier rendu.
	useEffect(() => {
		if (after !== null) {
			return;
		}
		if (unread > count) {
			setCount(unread);
		} else if (data && !data.loading && data.items.length > 0) {
			setAfter(
				catchupAfter(
					data.items.map((m) => m.id),
					count,
				),
			);
		}
	}, [after, unread, count, data]);

	useEffect(() => () => ctrl.current?.abort(), []);

	if (count < MIN_UNREAD || after === null || state === 'closed') {
		return null;
	}

	const load = () => {
		ctrl.current?.abort();
		const next = new AbortController();
		ctrl.current = next;
		setState('open');
		setResult(null);
		setError(null);
		api<AiCatchup>('POST', `/w/${workspaceId}/channels/${channelId}/ai/catchup`, { after }, next.signal)
			.then(setResult)
			.catch((e: unknown) => !isAbort(e) && setError(aiErrorText(e)));
	};

	const cancel = () => {
		ctrl.current?.abort();
		setState('idle');
	};

	if (state === 'idle') {
		return (
			<div className='ai-catchup-bar'>
				<span aria-hidden className='ai-glyph'>
					✦
				</span>
				<span className='grow'>{count > 99 ? '99+' : count} messages non lus depuis ta dernière visite</span>
				<button type='button' className='btn ai-btn-sm' onClick={load}>
					Rattraper
				</button>
				<button type='button' className='icon-btn icon-btn-sm' aria-label='Ignorer' onClick={() => setState('closed')}>
					<Icon name='close' size={14} />
				</button>
			</div>
		);
	}

	return (
		<div className='ai-catchup'>
			<AiBlock
				label={result ? `Rattrapage de ${result.count} messages` : 'Rattrapage'}
				text={result ? '' : null}
				error={error}
				onCancel={cancel}
				onRetry={load}
				onClose={() => setState('closed')}
			>
				{result && result.items.length === 0 ? (
					<p className='muted ai-block-text'>Rien à résumer.</p>
				) : (
					<ul className='ai-bullets'>
						{result?.items.map((item, i) => (
							<li key={i}>
								{item.messageId !== null ? (
									<button type='button' className='ai-bullet-link' title='Voir le message' onClick={() => onJump(item.messageId!)}>
										{item.text}
									</button>
								) : (
									item.text
								)}
							</li>
						))}
					</ul>
				)}
			</AiBlock>
		</div>
	);
}
