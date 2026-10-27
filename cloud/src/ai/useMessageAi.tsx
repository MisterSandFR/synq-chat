import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { AiTextResult } from '../../shared/ai';
import type { AiMessageAction } from '../../shared/ai-chat';
import type { Message } from '../../shared/types';
import { api } from '../api';
import type { ContextMenuItem } from '../workspace/ContextMenu';
import { AiBlock } from './AiBlock';
import { AI_REPLY_EVENT, aiErrorText, isAbort, type AiReplyDetail } from './parse';

const LONG = 280;

type Kind = Exclude<AiMessageAction, 'thread-summary'>;
type Entry = { kind: Kind; text: string | null; error: string | null; original: boolean };

const LABELS: Record<Kind, string> = { translate: 'Traduction', summary: 'Résumé', reply: 'Réponse proposée' };

// Actions IA d'un message : entrées de menu et encart affiché sous le message.
export function useMessageAi(workspaceId: string, channelId: string, onReply: (message: Message) => void) {
	const [entries, setEntries] = useState<Record<number, Entry>>({});
	const calls = useRef(new Map<number, AbortController>());

	useEffect(() => {
		const pending = calls.current;
		return () => pending.forEach((ctrl) => ctrl.abort());
	}, []);

	const patch = useCallback((id: number, next: Partial<Entry> | null) => {
		setEntries((current) => {
			if (next === null) {
				const { [id]: _gone, ...rest } = current;
				return rest;
			}
			return current[id] ? { ...current, [id]: { ...current[id], ...next } } : current;
		});
	}, []);

	const cancel = useCallback(
		(id: number) => {
			calls.current.get(id)?.abort();
			calls.current.delete(id);
			patch(id, null);
		},
		[patch],
	);

	const run = useCallback(
		(message: Message, kind: Kind) => {
			calls.current.get(message.id)?.abort();
			const ctrl = new AbortController();
			calls.current.set(message.id, ctrl);
			setEntries((current) => ({ ...current, [message.id]: { kind, text: null, error: null, original: false } }));
			if (kind === 'reply') {
				onReply(message);
			}
			api<AiTextResult>('POST', `/w/${workspaceId}/messages/${message.id}/ai/${kind}`, {}, ctrl.signal)
				.then(({ text }) => {
					if (kind === 'reply') {
						window.dispatchEvent(new CustomEvent<AiReplyDetail>(AI_REPLY_EVENT, { detail: { channelId, text } }));
						patch(message.id, null);
					} else {
						patch(message.id, { text });
					}
				})
				.catch((e: unknown) => !isAbort(e) && patch(message.id, { error: aiErrorText(e) }))
				.finally(() => calls.current.get(message.id) === ctrl && calls.current.delete(message.id));
		},
		[workspaceId, channelId, onReply, patch],
	);

	const items = (message: Message): ContextMenuItem[] => {
		if (!message.body.trim()) {
			return [];
		}
		const list: ContextMenuItem[] = [{ label: 'Traduire', icon: 'sparkle', onSelect: () => run(message, 'translate') }];
		if (message.body.length >= LONG) {
			list.push({ label: 'Résumer', icon: 'sparkle', onSelect: () => run(message, 'summary') });
		}
		list.push({ label: 'Répondre avec l’IA', icon: 'sparkle', onSelect: () => run(message, 'reply') });
		return list;
	};

	// Traduction affichée à la place du texte tant que l'original n'est pas demandé.
	const hidesBody = (id: number) => {
		const entry = entries[id];
		return entry?.kind === 'translate' && entry.text !== null && !entry.original;
	};

	const render = (message: Message): ReactNode => {
		const entry = entries[message.id];
		if (!entry) {
			return null;
		}
		const label = entry.kind === 'reply' ? 'Rédaction de la réponse…' : LABELS[entry.kind];
		if (entry.kind === 'translate' && entry.original && entry.text !== null) {
			return (
				<button type='button' className='ai-toggle' onClick={() => patch(message.id, { original: false })}>
					Voir la traduction
				</button>
			);
		}
		return (
			<AiBlock
				label={label}
				text={entry.text}
				error={entry.error}
				onCancel={() => cancel(message.id)}
				onClose={() => cancel(message.id)}
				onRetry={() => run(message, entry.kind)}
				actions={
					entry.kind === 'translate' && (
						<button type='button' className='ai-toggle' onClick={() => patch(message.id, { original: true })}>
							Voir l’original
						</button>
					)
				}
			/>
		);
	};

	return { items, hidesBody, render };
}
