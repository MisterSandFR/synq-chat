import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

import { LIMITS, type Channel, type Message } from '../../shared/types';
import { errorText } from '../api';
import { Avatar, Icon } from '../ui';
import { EphemeralNotes, SlashHint, SlashMenu } from './commands/SlashMenu';
import { useSlash } from './commands/useSlash';
import { useOfferedFiles } from './media/bus';
import { PendingFiles } from './media/PendingFiles';
import { RecordButtons } from './media/Recorder';
import { useUploads } from './media/useUploads';
import { excerpt, toTokens, type Lookup } from './richText';

type Props = {
	workspaceId: string;
	channel: Channel;
	canPost: boolean;
	canAttach: boolean;
	lookup: Lookup;
	replyTo: Message | null;
	onCancelReply: () => void;
	onSend: (body: string, attachmentKeys: string[], replyTo?: number) => Promise<void>;
	onTyping: () => void;
};

type Suggestion = { key: string; label: string; insert: string; avatar?: { name: string; url: string | null } };

const TYPING_EVERY = 3000;
const TRIGGER_RE = /(^|\s)([@#])([\p{L}\p{N}_ -]{0,32})$/u;

export function Composer({ workspaceId, channel, canPost, canAttach, lookup, replyTo, onCancelReply, onSend, onTyping }: Props) {
	const [text, setText] = useState('');
	const uploads = useUploads(workspaceId);
	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [caret, setCaret] = useState(0);
	const [selected, setSelected] = useState(0);
	const [dismissed, setDismissed] = useState<string | null>(null);
	const lastTyping = useRef(0);
	const fileInput = useRef<HTMLInputElement>(null);
	const textarea = useRef<HTMLTextAreaElement>(null);
	useOfferedFiles(canAttach ? uploads.add : null);
	const slash = useSlash(workspaceId, channel, text, (next) => {
		setText(next);
		setCaret(next.length);
		requestAnimationFrame(() => {
			textarea.current?.focus();
			textarea.current?.setSelectionRange(next.length, next.length);
		});
	});

	const trigger = useMemo(() => {
		const match = text.slice(0, caret).match(TRIGGER_RE);
		if (!match) {
			return null;
		}
		const [whole, lead, sigil, query] = match as unknown as [string, string, '@' | '#', string];
		return { sigil, query: query.toLowerCase(), start: caret - whole.length + lead.length };
	}, [text, caret]);

	const suggestions: Suggestion[] = useMemo(() => {
		if (!trigger || dismissed === `${trigger.start}`) {
			return [];
		}
		if (trigger.sigil === '@') {
			return [...lookup.members.values()]
				.filter((m) => m.name.toLowerCase().includes(trigger.query))
				.slice(0, 8)
				.map((m) => ({ key: m.id, label: m.name, insert: `@${m.name} `, avatar: { name: m.name, url: m.avatarUrl } }));
		}
		return lookup.channels
			.filter((c) => c.kind === 'text' && c.name.includes(trigger.query))
			.slice(0, 8)
			.map((c) => ({ key: c.id, label: `#${c.name}`, insert: `#${c.name} ` }));
	}, [trigger, dismissed, lookup]);

	if (!canPost) {
		return <p className='composer-locked'>{channel.readOnly ? `#${channel.name} est en lecture seule.` : `Ton grade ne permet pas d’écrire dans #${channel.name}.`}</p>;
	}

	const accept = (suggestion: Suggestion) => {
		if (!trigger) {
			return;
		}
		const next = text.slice(0, trigger.start) + suggestion.insert + text.slice(caret);
		const position = trigger.start + suggestion.insert.length;
		setText(next);
		setCaret(position);
		requestAnimationFrame(() => {
			textarea.current?.focus();
			textarea.current?.setSelectionRange(position, position);
		});
	};

	const attach = (files: File[]) => {
		setError(null);
		uploads.add(files);
	};

	const submit = async () => {
		if (sending || uploads.blocked || (!text.trim() && !uploads.keys.length)) {
			return;
		}
		setSending(true);
		setError(null);
		try {
			const command = await slash.run(text);
			if (command === 'done') {
				setText('');
				return;
			}
			await onSend(toTokens(command ?? text, lookup), uploads.keys, replyTo?.id);
			setText('');
			uploads.clear();
			onCancelReply();
			lastTyping.current = 0;
			if (textarea.current) {
				textarea.current.style.height = 'auto';
			}
		} catch (err) {
			setError(errorText(err));
		} finally {
			setSending(false);
			textarea.current?.focus();
		}
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (slash.onKeyDown(e)) {
			return;
		}
		if (suggestions.length) {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				setSelected((s) => (s + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
				return;
			}
			if (e.key === 'Enter' || e.key === 'Tab') {
				e.preventDefault();
				accept(suggestions[Math.min(selected, suggestions.length - 1)]!);
				return;
			}
			if (e.key === 'Escape') {
				setDismissed(`${trigger?.start}`);
				return;
			}
		}
		if (e.key === 'Escape' && replyTo) {
			onCancelReply();
		} else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			void submit();
		}
	};

	const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = [...event.clipboardData.files];
		if (files.length && canAttach) {
			event.preventDefault();
			attach(files);
		}
	};

	const replyAuthor = replyTo ? lookup.members.get(replyTo.userId)?.name ?? 'Ancien membre' : '';

	return (
		<form
			className='composer'
			onSubmit={(e) => {
				e.preventDefault();
				void submit();
			}}
		>
			<EphemeralNotes notes={slash.notes} onDismiss={slash.dismissNote} />
			<SlashMenu matches={slash.matches} index={slash.index} onPick={slash.accept} />
			{suggestions.length > 0 && (
				<div className='popover suggest' role='listbox' aria-label='Suggestions'>
					{suggestions.map((s, i) => (
						<button
							key={s.key}
							type='button'
							role='option'
							aria-selected={i === Math.min(selected, suggestions.length - 1)}
							className='menu-item'
							onMouseDown={(e) => {
								e.preventDefault();
								accept(s);
							}}
						>
							{s.avatar ? <Avatar name={s.avatar.name} url={s.avatar.url} size={24} /> : <Icon name='hash' size={16} />}
							<span className='ellipsis'>{s.label}</span>
						</button>
					))}
				</div>
			)}
			<div className='composer-box'>
				{slash.active && <SlashHint command={slash.active} />}
				{replyTo && (
					<div className='composer-context'>
						<Icon name='reply' size={14} />
						<span className='grow ellipsis'>
							Réponse à <strong style={{ color: 'var(--text)' }}>{replyAuthor}</strong> : {excerpt(replyTo.body, lookup, 80) || 'fichier joint'}
						</span>
						<button type='button' className='icon-btn icon-btn-sm' aria-label='Annuler la réponse' onClick={onCancelReply}>
							<Icon name='close' size={14} />
						</button>
					</div>
				)}
				{uploads.items.length > 0 && <PendingFiles items={uploads.items} onRemove={uploads.remove} />}
				<label className='sr-only' htmlFor='composer'>
					Message pour #{channel.name}
				</label>
				<textarea
					id='composer'
					ref={textarea}
					value={text}
					rows={1}
					maxLength={LIMITS.messageLength}
					placeholder={`Écrire dans #${channel.name}`}
					onPaste={onPaste}
					onKeyDown={onKeyDown}
					onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
					onChange={(e) => {
						setText(e.target.value);
						setCaret(e.target.selectionStart);
						setSelected(0);
						setDismissed(null);
						e.target.style.height = 'auto';
						e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
						if (Date.now() - lastTyping.current > TYPING_EVERY) {
							lastTyping.current = Date.now();
							onTyping();
						}
					}}
				/>
				<div className='composer-tools'>
					{canAttach && (
						<button type='button' className='icon-btn' aria-label='Joindre un fichier' title='Joindre un fichier' onClick={() => fileInput.current?.click()}>
							<Icon name='paperclip' />
						</button>
					)}
					{canAttach && <RecordButtons onClip={(file) => attach([file])} />}
					<input
						ref={fileInput}
						type='file'
						multiple
						hidden
						onChange={(e) => {
							const files = [...(e.target.files ?? [])];
							e.target.value = '';
							if (files.length) {
								attach(files);
							}
						}}
					/>
					<span className='grow' />
					{error || uploads.notice ? (
						<span className='composer-hint' role='alert' style={{ color: 'var(--danger)', display: 'inline' }}>
							{error ?? uploads.notice}
						</span>
					) : (
						<span className='composer-hint'>Maj + Entrée pour aller à la ligne</span>
					)}
					<button className='send-btn' aria-label='Envoyer' title='Envoyer' disabled={sending || uploads.blocked || (!text.trim() && !uploads.keys.length)}>
						<Icon name='send' strokeWidth={2} />
					</button>
				</div>
			</div>
		</form>
	);
}
