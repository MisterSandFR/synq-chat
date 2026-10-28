import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

import { Floating } from '../floating';
import { parseCommand } from '../../shared/commands';
import { searchEmojis } from '../../shared/emoji';
import { LIMITS, type Channel, type Message } from '../../shared/types';
import { AiAssist } from '../ai/AiAssist';
import { AI_REPLY_EVENT, type AiReplyDetail } from '../ai/parse';
import { errorText } from '../api';
import { Avatar, Icon } from '../ui';
import { EmojiPicker, rememberEmoji } from './chat/EmojiPicker';
import { FormatBar } from './chat/FormatBar';
import { applyFormat, type FormatKind } from './chat/format';
import { EphemeralNotes, SlashHint, SlashMenu } from './commands/SlashMenu';
import { EventCardDialog } from './events/EventCardDialog';
import { useSlash } from './commands/useSlash';
import { useOfferedFiles } from './media/bus';
import { PendingFiles } from './media/PendingFiles';
import { RecordButtons } from './media/Recorder';
import { useUploads } from './media/useUploads';
import { ScheduleButton, useDraft } from './drafts';
import { MENTION_EVENT, type MentionDetail } from './members/useMemberMenu';
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

type Suggestion = { key: string; label: string; insert: string; avatar?: { name: string; url: string | null }; glyph?: string };

const TYPING_EVERY = 3000;
const TRIGGER_RE = /(^|\s)([@#])([\p{L}\p{N}_ -]{0,32})$/u;
const EMOJI_TRIGGER_RE = /(^|\s)(:)([a-z0-9_+-]{2,32})$/;

export function Composer({ workspaceId, channel, canPost, canAttach, lookup, replyTo, onCancelReply, onSend, onTyping }: Props) {
	const [text, setText] = useState('');
	const uploads = useUploads(workspaceId);
	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const [caret, setCaret] = useState(0);
	const [selected, setSelected] = useState(0);
	const [dismissed, setDismissed] = useState<string | null>(null);
	const [formatOpen, setFormatOpen] = useState(false);
	const [picker, setPicker] = useState<DOMRect | null>(null);
	// Titre proposé au dialogue d'événement ; null = fermé.
	const [eventDraft, setEventDraft] = useState<string | null>(null);
	const lastTyping = useRef(0);
	const fileInput = useRef<HTMLInputElement>(null);
	const form = useRef<HTMLFormElement>(null);
	const textarea = useRef<HTMLTextAreaElement>(null);
	useOfferedFiles(canAttach ? uploads.add : null);
	const draft = useDraft(workspaceId, channel.id, 0, { body: text, keys: uploads.keys }, (saved) => {
		setText(saved.body);
		setCaret(saved.body.length);
		uploads.restore(saved.attachments);
	});
	const slash = useSlash(workspaceId, channel, text, (next) => {
		setText(next);
		setCaret(next.length);
		requestAnimationFrame(() => {
			textarea.current?.focus();
			textarea.current?.setSelectionRange(next.length, next.length);
		});
	});

	// Mention envoyée par le menu d'un membre.
	useEffect(() => {
		const onMention = (e: Event) => {
			const detail = (e as CustomEvent<MentionDetail>).detail;
			if (detail.channelId !== channel.id) {
				return;
			}
			const next = `${text}${text && !text.endsWith(' ') ? ' ' : ''}${detail.text}`;
			setText(next);
			setCaret(next.length);
			requestAnimationFrame(() => {
				textarea.current?.focus();
				textarea.current?.setSelectionRange(next.length, next.length);
			});
		};
		window.addEventListener(MENTION_EVENT, onMention);
		return () => window.removeEventListener(MENTION_EVENT, onMention);
	}, [text, channel.id]);

	// Réponse rédigée par l'IA depuis le menu d'un message.
	useEffect(() => {
		const onAiReply = (e: Event) => {
			const detail = (e as CustomEvent<AiReplyDetail>).detail;
			if (detail.channelId !== channel.id) {
				return;
			}
			const next = text.trim() ? `${text}${text.endsWith('\n') ? '' : '\n'}${detail.text}` : detail.text;
			setText(next);
			setCaret(next.length);
			requestAnimationFrame(() => {
				textarea.current?.focus();
				textarea.current?.setSelectionRange(next.length, next.length);
			});
		};
		window.addEventListener(AI_REPLY_EVENT, onAiReply);
		return () => window.removeEventListener(AI_REPLY_EVENT, onAiReply);
	}, [text, channel.id]);

	const trigger = useMemo(() => {
		const before = text.slice(0, caret);
		const match = before.match(TRIGGER_RE) ?? before.match(EMOJI_TRIGGER_RE);
		if (!match) {
			return null;
		}
		const [whole, lead, sigil, query] = match as unknown as [string, string, '@' | '#' | ':', string];
		return { sigil, query: query.toLowerCase(), start: caret - whole.length + lead.length };
	}, [text, caret]);

	const suggestions: Suggestion[] = useMemo(() => {
		if (!trigger || dismissed === `${trigger.start}`) {
			return [];
		}
		if (trigger.sigil === ':') {
			return searchEmojis(trigger.query, 8).map((e) => ({ key: e.name, label: `:${e.name}:`, insert: `${e.char} `, glyph: e.char }));
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
		return (
			<p className='composer-locked'>
				{channel.readOnly ? `#${channel.name} est en lecture seule.` : `Ton grade ne permet pas d’écrire dans #${channel.name}.`}
			</p>
		);
	}

	const accept = (suggestion: Suggestion) => {
		if (!trigger) {
			return;
		}
		if (suggestion.glyph) {
			rememberEmoji(suggestion.glyph);
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

	const replaceText = (next: string, start: number, end = start) => {
		setText(next);
		setCaret(end);
		requestAnimationFrame(() => {
			const el = textarea.current;
			if (el) {
				el.focus();
				el.setSelectionRange(start, end);
				el.style.height = 'auto';
				el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
			}
		});
	};

	const format = (kind: FormatKind) => {
		const el = textarea.current;
		const result = applyFormat(text, el?.selectionStart ?? caret, el?.selectionEnd ?? caret, kind);
		replaceText(result.value, result.start, result.end);
	};

	const insertEmoji = (char: string) => {
		const el = textarea.current;
		const start = el?.selectionStart ?? caret;
		replaceText(text.slice(0, start) + char + text.slice(el?.selectionEnd ?? caret), start + char.length);
	};

	const attach = (files: File[]) => {
		setError(null);
		uploads.add(files);
	};

	const submit = async () => {
		if (sending || uploads.blocked || (!text.trim() && !uploads.keys.length)) {
			return;
		}
		const asked = parseCommand(text.trimEnd());
		if (asked?.name === 'evenement') {
			setEventDraft(asked.args);
			setText('');
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
			draft.sent();
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

	const schedule = async (sendAt: number) => {
		setError(null);
		try {
			await draft.schedule(sendAt, toTokens(text, lookup), replyTo?.id);
			setText('');
			uploads.clear();
			onCancelReply();
		} catch (err) {
			setError(errorText(err));
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
		const key = e.key.toLowerCase();
		const shortcut: FormatKind | null =
			(e.ctrlKey || e.metaKey) && !e.altKey
				? key === 'b'
					? 'bold'
					: key === 'i'
						? 'italic'
						: e.shiftKey && key === 'x'
							? 'strike'
							: null
				: null;
		if (shortcut) {
			e.preventDefault();
			format(shortcut);
			return;
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

	const replyAuthor = replyTo ? (lookup.members.get(replyTo.userId)?.name ?? 'Ancien membre') : '';

	return (
		<>
			<form
				ref={form}
				className='composer'
				onSubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				<EphemeralNotes notes={slash.notes} onDismiss={slash.dismissNote} />
				<SlashMenu anchor={form} matches={slash.matches} index={slash.index} onPick={slash.accept} />
				{suggestions.length > 0 && (
					<Floating anchor={form} placement='top-start' className='popover suggest' role='listbox' aria-label='Suggestions'>
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
								{s.avatar ? (
									<Avatar name={s.avatar.name} url={s.avatar.url} size={24} />
								) : s.glyph ? (
									<span className='emoji-glyph'>{s.glyph}</span>
								) : (
									<Icon name='hash' size={16} />
								)}
								<span className='ellipsis'>{s.label}</span>
							</button>
						))}
					</Floating>
				)}
				<div className='composer-box'>
					{slash.active && <SlashHint command={slash.active} />}
					{replyTo && (
						<div className='composer-context'>
							<Icon name='reply' size={14} />
							<span className='grow ellipsis'>
								Réponse à <strong style={{ color: 'var(--text)' }}>{replyAuthor}</strong> :{' '}
								{excerpt(replyTo.body, lookup, 80) || 'fichier joint'}
							</span>
							<button type='button' className='icon-btn icon-btn-sm' aria-label='Annuler la réponse' onClick={onCancelReply}>
								<Icon name='close' size={14} />
							</button>
						</div>
					)}
					{uploads.items.length > 0 && <PendingFiles items={uploads.items} onRemove={uploads.remove} />}
					{formatOpen && <FormatBar onFormat={format} />}
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
						<button
							type='button'
							className='icon-btn fmt-toggle'
							aria-pressed={formatOpen}
							aria-label='Mise en forme'
							title='Mise en forme'
							onClick={() => setFormatOpen(!formatOpen)}
						>
							<span aria-hidden>Aa</span>
						</button>
						<AiAssist
							textarea={textarea}
							value={text}
							onChange={(next) => {
								setText(next);
								setCaret(next.length);
							}}
						/>
						<button
							type='button'
							className='icon-btn'
							aria-label='Emoji'
							title='Emoji'
							onPointerDown={(e) => picker && e.stopPropagation()}
							onClick={(e) => setPicker(picker ? null : e.currentTarget.getBoundingClientRect())}
						>
							<Icon name='smile' />
						</button>
						{canAttach && (
							<button
								type='button'
								className='icon-btn'
								aria-label='Joindre un fichier'
								title='Joindre un fichier'
								onClick={() => fileInput.current?.click()}
							>
								<Icon name='paperclip' />
							</button>
						)}
						{canAttach && <RecordButtons onClip={(file) => attach([file])} />}
						<button
							type='button'
							className='icon-btn'
							aria-label='Événement'
							title='Créer ou partager un événement'
							onClick={() => setEventDraft('')}
						>
							<Icon name='calendar' />
						</button>
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
						{picker && (
							<EmojiPicker
								anchor={picker}
								onClose={() => setPicker(null)}
								onPick={(char) => {
									insertEmoji(char);
									setPicker(null);
								}}
							/>
						)}
						<span className='grow' />
						{error || uploads.notice ? (
							<span className='composer-hint' role='alert' style={{ color: 'var(--danger)', display: 'inline' }}>
								{error ?? uploads.notice}
							</span>
						) : (
							<span className='composer-hint'>Maj + Entrée pour aller à la ligne</span>
						)}
						<button
							className='send-btn'
							aria-label='Envoyer'
							title='Envoyer'
							disabled={sending || uploads.blocked || (!text.trim() && !uploads.keys.length)}
						>
							<Icon name='send' strokeWidth={2} />
						</button>
						<ScheduleButton disabled={sending || uploads.blocked || (!text.trim() && !uploads.keys.length)} onSchedule={schedule} />
					</div>
				</div>
			</form>
			{/* Hors du <form> du composer : un formulaire imbriqué part en envoi natif et recharge la page. */}
			{eventDraft !== null && (
				<EventCardDialog
					workspaceId={workspaceId}
					channel={channel}
					lookup={lookup}
					initialTitle={eventDraft}
					onClose={() => setEventDraft(null)}
				/>
			)}
		</>
	);
}
