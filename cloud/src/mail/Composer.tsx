import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

import type { MailAiInput, MailAiResult, MailboxInfo, MailDraft, MailScheduleInput, MailSendInput, MailThreadDetail, MailUpload } from '../../shared/mail';
import { api, errorText, upload } from '../api';
import { Icon, fileIcon, formatSize, useDismiss } from '../ui';
import { formatAddress, longDate, parseAddresses, snoozeChoices, validAddress } from './format';
import { QuickReplies } from './QuickReplies';
import { Templates } from './Templates';

export type ComposeSeed = {
	id: string;
	mailboxId: string;
	threadId: string | null;
	forwardOf: string | null;
	to: string;
	cc: string;
	bcc: string;
	subject: string;
	text: string;
	attachments: MailUpload[];
	// Déjà enregistré côté serveur.
	saved: boolean;
	sendAt?: number | null;
	// Message cité, transmis à l'assistant de rédaction.
	context?: string;
};

export const newSeed = (patch: Partial<ComposeSeed> & { mailboxId: string }): ComposeSeed => ({
	id: crypto.randomUUID(),
	threadId: null,
	forwardOf: null,
	to: '',
	cc: '',
	bcc: '',
	subject: '',
	text: '',
	attachments: [],
	saved: false,
	...patch,
});

export const seedFromDraft = (draft: MailDraft): ComposeSeed => ({
	id: draft.id,
	mailboxId: draft.mailboxId,
	threadId: draft.threadId,
	forwardOf: draft.forwardOf,
	to: draft.to.map(formatAddress).join(', '),
	cc: draft.cc.map(formatAddress).join(', '),
	bcc: (draft.bcc ?? []).map(formatAddress).join(', '),
	subject: draft.subject,
	text: draft.text,
	attachments: draft.attachments,
	saved: true,
	sendAt: draft.sendAt,
});

const UPLOAD_MAX = 20 * 1024 * 1024;
const AUTOSAVE_MS = 2000;
const TONES: Array<[NonNullable<MailAiInput['tone']>, string]> = [
	['neutre', 'Neutre'],
	['chaleureux', 'Chaleureux'],
	['formel', 'Formel'],
	['bref', 'Bref'],
];

type Pending = { id: string; name: string; ratio: number };

type Props = {
	seed: ComposeSeed;
	boxes: MailboxInfo[];
	minimized: boolean;
	maximized: boolean;
	onMinimize: () => void;
	onMaximize: () => void;
	onClose: (kept: boolean) => void;
	onSent: (detail: MailThreadDetail) => void;
	onScheduled?: (at: number) => void;
	// Reformulation branchée par le parent ; la forme fonction reçoit le texte du message.
	aiSlot?: ReactNode | ((field: ComposerField) => ReactNode);
};

export type ComposerField = { value: string; onChange: (text: string) => void; textarea: RefObject<HTMLTextAreaElement | null> };

export function Composer({ seed, boxes, minimized, maximized, onMinimize, onMaximize, onClose, onSent, onScheduled, aiSlot }: Props) {
	const [form, setForm] = useState(() => ({ ...seed }));
	const [showCc, setShowCc] = useState(Boolean(seed.cc || seed.bcc));
	const [scheduled, setScheduled] = useState(seed.sendAt ?? null);
	const [pending, setPending] = useState<Pending[]>([]);
	const [tone, setTone] = useState<NonNullable<MailAiInput['tone']>>('neutre');
	const [status, setStatus] = useState<string | null>(seed.sendAt ? `Envoi prévu ${longDate(seed.sendAt)}` : seed.saved ? 'Brouillon' : null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<'send' | 'ai' | null>(null);
	const state = useRef(form);
	const dirty = useRef(false);
	const saved = useRef(seed.saved);
	const saving = useRef<Promise<void> | null>(null);
	const sending = useRef(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const textArea = useRef<HTMLTextAreaElement>(null);
	state.current = form;

	const set = (patch: Partial<typeof form>) => {
		dirty.current = true;
		setForm((current) => ({ ...current, ...patch }));
	};

	const empty = () => {
		const f = state.current;
		return !f.to.trim() && !f.cc.trim() && !f.bcc.trim() && !f.text.trim() && f.attachments.length === 0;
	};

	const save = async (): Promise<boolean> => {
		if (!dirty.current || sending.current) {
			return !dirty.current;
		}
		if (saving.current) {
			await saving.current;
		}
		const f = state.current;
		dirty.current = false;
		let ok = false;
		const body = {
			mailboxId: f.mailboxId,
			threadId: f.threadId,
			forwardOf: f.forwardOf,
			to: parseAddresses(f.to),
			cc: parseAddresses(f.cc),
			bcc: parseAddresses(f.bcc),
			subject: f.subject,
			text: f.text,
			attachments: f.attachments,
		};
		saving.current = api<MailDraft>('PUT', `/mail/drafts/${f.id}`, body)
			.then(() => {
				ok = true;
				saved.current = true;
				setStatus((current) => (current?.startsWith('Envoi prévu') ? current : 'Brouillon enregistré'));
			})
			.catch((e) => {
				dirty.current = true;
				setStatus(`Brouillon non enregistré : ${errorText(e)}`);
			})
			.finally(() => {
				saving.current = null;
			});
		await saving.current;
		return ok;
	};

	useEffect(() => {
		const timer = setInterval(() => !empty() && void save(), AUTOSAVE_MS);
		return () => clearInterval(timer);
	}, []);

	useEffect(() => {
		if (!minimized) {
			textArea.current?.focus();
		}
	}, [minimized]);

	const close = async () => {
		if (empty()) {
			if (saved.current) {
				await api('DELETE', `/mail/drafts/${form.id}`).catch(() => undefined);
			}
			onClose(false);
			return;
		}
		await save();
		onClose(true);
	};

	const discard = async () => {
		sending.current = true;
		await saving.current;
		if (saved.current) {
			await api('DELETE', `/mail/drafts/${form.id}`).catch(() => undefined);
		}
		onClose(false);
	};

	const attach = (files: FileList | null) => {
		for (const file of Array.from(files ?? [])) {
			if (file.size > UPLOAD_MAX) {
				setError(`${file.name} dépasse 20 Mo.`);
				continue;
			}
			const id = crypto.randomUUID();
			setPending((current) => [...current, { id, name: file.name, ratio: 0 }]);
			upload<MailUpload>('/mail/uploads', file, (ratio) => setPending((current) => current.map((item) => (item.id === id ? { ...item, ratio } : item))))
				.then((uploaded) => {
					dirty.current = true;
					setForm((current) => ({ ...current, attachments: [...current.attachments, uploaded] }));
				})
				.catch((e) => setError(errorText(e)))
				.finally(() => setPending((current) => current.filter((item) => item.id !== id)));
		}
	};

	const generate = async () => {
		if (!form.threadId) {
			return;
		}
		setBusy('ai');
		setError(null);
		try {
			const result = await api<MailAiResult>('POST', `/mail/threads/${form.threadId}/ai`, { action: 'reply', tone } satisfies MailAiInput);
			if (result.text) {
				set({ text: state.current.text.trim() ? `${result.text.trim()}\n\n${state.current.text}` : result.text.trim() });
			}
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(null);
		}
	};

	const check = (): string | null => {
		const to = parseAddresses(form.to);
		const invalid = [...to, ...parseAddresses(form.cc), ...parseAddresses(form.bcc)].find((address) => !validAddress(address.addr));
		if (to.length === 0) {
			return 'Ajoute au moins un destinataire.';
		}
		if (invalid) {
			return `Adresse invalide : ${invalid.addr}`;
		}
		return pending.length ? 'Envoi des pièces jointes en cours.' : null;
	};

	const insert = (body: string) => {
		const area = textArea.current;
		const text = state.current.text;
		const start = area?.selectionStart ?? text.length;
		const end = area?.selectionEnd ?? text.length;
		set({ text: text.slice(0, start) + body + text.slice(end) });
		requestAnimationFrame(() => {
			area?.focus();
			area?.setSelectionRange(start + body.length, start + body.length);
		});
	};

	// Brouillon enregistré d'abord : le cron envoie ce que le serveur a.
	const schedule = async (at: number | null) => {
		const problem = at === null ? null : check();
		if (problem) {
			setError(problem);
			return;
		}
		setBusy('send');
		setError(null);
		dirty.current = true;
		if (!(await save())) {
			setBusy(null);
			setError('Brouillon non enregistré : envoi non programmé.');
			return;
		}
		try {
			await api<MailDraft>('POST', `/mail/drafts/${form.id}/schedule`, { sendAt: at } satisfies MailScheduleInput);
			setScheduled(at);
			if (at === null) {
				setStatus('Envoi prévu annulé');
				setBusy(null);
				return;
			}
			sending.current = true;
			onScheduled?.(at);
			onClose(true);
		} catch (e) {
			setError(errorText(e));
			setBusy(null);
		}
	};

	const send = async () => {
		const problem = check();
		if (problem) {
			setError(problem);
			return;
		}
		const to = parseAddresses(form.to);
		const cc = parseAddresses(form.cc);
		const bcc = parseAddresses(form.bcc);
		setBusy('send');
		setError(null);
		sending.current = true;
		await saving.current;
		const input: MailSendInput = {
			mailboxId: form.mailboxId,
			threadId: form.threadId,
			forwardOf: form.forwardOf,
			to: to.map((address) => address.addr),
			cc: cc.map((address) => address.addr),
			bcc: bcc.map((address) => address.addr),
			subject: form.subject,
			text: form.text,
			attachments: form.attachments.map((attachment) => attachment.key),
			draftId: saved.current ? form.id : null,
		};
		try {
			onSent(await api<MailThreadDetail>('POST', '/mail/send', input));
		} catch (e) {
			sending.current = false;
			setError(errorText(e));
			setBusy(null);
		}
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.stopPropagation();
			onMinimize();
		} else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void send();
		}
	};

	const title = form.subject.trim() || 'Nouveau message';
	const senders = boxes.filter((box) => box.access.reply || box.id === form.mailboxId);
	const signature = boxes.find((box) => box.id === form.mailboxId)?.signature?.trim();

	return (
		<section className={`mail-composer${minimized ? ' is-min' : ''}${maximized ? ' is-max' : ''}`} onKeyDown={onKeyDown} aria-label={title}>
			<header className='mail-composer-head' onClick={minimized ? onMinimize : undefined}>
				<strong>{title}</strong>
				{status && !minimized && <span className='mail-composer-status'>{status}</span>}
				<button
					type='button'
					className='icon-btn icon-btn-sm'
					onClick={(e) => {
						e.stopPropagation();
						onMinimize();
					}}
					title={minimized ? 'Ouvrir' : 'Réduire'}
					aria-label={minimized ? 'Ouvrir' : 'Réduire'}
				>
					<Icon name={minimized ? 'up' : 'minus'} size={15} />
				</button>
				{!minimized && (
					<button type='button' className='icon-btn icon-btn-sm mail-composer-max' onClick={onMaximize} title={maximized ? 'Rétrécir' : 'Agrandir'} aria-label={maximized ? 'Rétrécir' : 'Agrandir'}>
						<Icon name='expand' size={15} />
					</button>
				)}
				<button
					type='button'
					className='icon-btn icon-btn-sm'
					onClick={(e) => {
						e.stopPropagation();
						void close();
					}}
					title='Fermer'
					aria-label='Fermer'
				>
					<Icon name='close' size={15} />
				</button>
			</header>
			{!minimized && (
				<>
					<div className='mail-composer-fields'>
						<label className='mail-composer-field'>
							<span>À</span>
							<input value={form.to} onChange={(e) => set({ to: e.target.value })} placeholder='nom@exemple.fr' autoComplete='off' />
							{!showCc && (
								<button type='button' className='link' onClick={() => setShowCc(true)}>
									Cc Cci
								</button>
							)}
						</label>
						{showCc && (
							<>
								<label className='mail-composer-field'>
									<span>Cc</span>
									<input value={form.cc} onChange={(e) => set({ cc: e.target.value })} autoComplete='off' />
								</label>
								<label className='mail-composer-field'>
									<span>Cci</span>
									<input value={form.bcc} onChange={(e) => set({ bcc: e.target.value })} autoComplete='off' />
								</label>
							</>
						)}
						<label className='mail-composer-field'>
							<span>Objet</span>
							<input value={form.subject} onChange={(e) => set({ subject: e.target.value })} maxLength={300} />
						</label>
					</div>
					<textarea ref={textArea} className='mail-composer-text' value={form.text} onChange={(e) => set({ text: e.target.value })} placeholder='Écris ton message' maxLength={20_000} />
					{signature && (
						<p className='mail-composer-sign' title={signature}>
							Signature ajoutée à l’envoi
						</p>
					)}
					{form.threadId && !form.text.trim() && <QuickReplies threadId={form.threadId} onPick={(text) => set({ text })} />}
					{(form.attachments.length > 0 || pending.length > 0) && (
						<div className='mail-composer-files'>
							{form.attachments.map((attachment) => (
								<span key={attachment.key} className='mail-composer-file'>
									<Icon name={fileIcon(attachment.type)} size={14} />
									<span>{attachment.name}</span>
									<small>{formatSize(attachment.size)}</small>
									<button type='button' className='icon-btn icon-btn-sm' onClick={() => set({ attachments: form.attachments.filter((item) => item.key !== attachment.key) })} aria-label={`Retirer ${attachment.name}`}>
										<Icon name='close' size={13} />
									</button>
								</span>
							))}
							{pending.map((item) => (
								<span key={item.id} className='mail-composer-file is-pending'>
									<Icon name='upload' size={14} />
									<span>{item.name}</span>
									<small>{Math.round(item.ratio * 100)} %</small>
								</span>
							))}
						</div>
					)}
					{error && <p className='notice notice-error'>{error}</p>}
					<footer className='mail-composer-bar'>
						<button type='button' className='icon-btn icon-btn-sm' onClick={() => fileInput.current?.click()} title='Joindre des fichiers' aria-label='Joindre des fichiers'>
							<Icon name='paperclip' size={16} />
						</button>
						<input ref={fileInput} type='file' multiple hidden onChange={(e) => (attach(e.target.files), (e.target.value = ''))} />
						<Templates text={form.text} onInsert={insert} />
						{aiSlot && <span className='mail-composer-slot'>{typeof aiSlot === 'function' ? aiSlot({ value: form.text, onChange: (text) => set({ text }), textarea: textArea }) : aiSlot}</span>}
						{form.threadId && (
							<span className='mail-composer-ai'>
								<button type='button' className='btn btn-ghost' disabled={busy !== null} onClick={() => void generate()}>
									<Icon name='sparkle' size={15} />
									{busy === 'ai' ? 'Rédaction…' : 'Générer une réponse'}
								</button>
								<select className='mail-select' value={tone} onChange={(e) => setTone(e.target.value as typeof tone)} aria-label='Ton'>
									{TONES.map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</span>
						)}
						<span className='mail-composer-spacer' />
						<button type='button' className='icon-btn icon-btn-sm' onClick={() => void discard()} title='Supprimer le brouillon' aria-label='Supprimer le brouillon'>
							<Icon name='trash' size={16} />
						</button>
						<select className='mail-select mail-composer-from' value={form.mailboxId} disabled={Boolean(form.threadId)} onChange={(e) => set({ mailboxId: e.target.value })} aria-label='Expéditeur'>
							{senders.map((box) => (
								<option key={box.id} value={box.id}>
									{box.address}
								</option>
							))}
						</select>
						<SchedulePop disabled={busy !== null} scheduled={scheduled} onPick={(at) => void schedule(at)} onCancel={() => void schedule(null)} />
						<button type='button' className='btn btn-primary' disabled={busy !== null} onClick={() => void send()}>
							<Icon name='send' size={16} />
							{busy === 'send' ? 'Envoi…' : 'Envoyer'}
						</button>
					</footer>
				</>
			)}
		</section>
	);
}

function SchedulePop({ disabled, scheduled, onPick, onCancel }: { disabled: boolean; scheduled: number | null; onPick: (at: number) => void; onCancel: () => void }) {
	const [open, setOpen] = useState(false);
	const [date, setDate] = useState('');
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	const label = scheduled ? `Envoi prévu ${longDate(scheduled)}` : 'Envoyer plus tard';
	return (
		<div className='mail-pop-anchor' ref={ref}>
			<button type='button' className='icon-btn icon-btn-sm' aria-pressed={Boolean(scheduled)} disabled={disabled} onClick={() => setOpen(!open)} title={label} aria-label={label} aria-expanded={open}>
				<Icon name='clock' size={16} />
			</button>
			{open && (
				<div className='popover mail-pop mail-pop-up mail-pop-right'>
					<div className='menu-label'>Envoyer plus tard</div>
					{snoozeChoices().map((choice) => (
						<button key={choice.key} type='button' className='menu-item' onClick={() => (setOpen(false), onPick(choice.at))}>
							<span className='mail-pop-grow'>{choice.label}</span>
							<small className='muted'>{longDate(choice.at)}</small>
						</button>
					))}
					<form
						className='mail-pop-date'
						onSubmit={(e: FormEvent) => {
							e.preventDefault();
							const at = new Date(date).getTime();
							if (at > Date.now() + 60_000) {
								setOpen(false);
								onPick(at);
							}
						}}
					>
						<input type='datetime-local' value={date} onChange={(e) => setDate(e.target.value)} aria-label='Date d’envoi' />
						<button className='btn' disabled={!date}>
							Programmer
						</button>
					</form>
					{scheduled && (
						<>
							<div className='menu-sep' />
							<button type='button' className='menu-item' onClick={() => (setOpen(false), onCancel())}>
								Annuler l’envoi prévu
							</button>
						</>
					)}
				</div>
			)}
		</div>
	);
}
