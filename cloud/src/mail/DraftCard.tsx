import { useState } from 'react';

import type { MailDraft, MailScheduleInput, MailSendInput, MailThreadDetail } from '../../shared/mail';
import { api, errorText } from '../api';
import { Icon } from '../ui';
import { addressLabel, longDate, relativeDate } from './format';

type Props = { draft: MailDraft; onEdit: () => void; onChanged: () => void; onSent: (detail: MailThreadDetail) => void };

export function DraftCard({ draft, onEdit, onChanged, onSent }: Props) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const run = async (task: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await task();
		} catch (e) {
			setError(errorText(e));
			setBusy(false);
		}
	};

	const remove = () =>
		run(async () => {
			await api('DELETE', `/mail/drafts/${draft.id}`);
			onChanged();
		});

	const send = () =>
		run(async () => {
			const input: MailSendInput = {
				mailboxId: draft.mailboxId,
				threadId: draft.threadId,
				forwardOf: draft.forwardOf,
				to: draft.to.map((address) => address.addr),
				cc: draft.cc.map((address) => address.addr),
				bcc: (draft.bcc ?? []).map((address) => address.addr),
				subject: draft.subject,
				text: draft.text,
				attachments: draft.attachments.map((attachment) => attachment.key),
				draftId: draft.id,
			};
			onSent(await api<MailThreadDetail>('POST', '/mail/send', input));
		});

	const unschedule = () =>
		run(async () => {
			await api<MailDraft>('POST', `/mail/drafts/${draft.id}/schedule`, { sendAt: null } satisfies MailScheduleInput);
			setBusy(false);
			onChanged();
		});

	return (
		<article className='mail-draft'>
			<header>
				<span className='mail-draft-tag'>Brouillon</span>
				<span className='mail-message-to'>à {draft.to.map(addressLabel).join(', ') || 'personne'}</span>
				<time>{relativeDate(draft.updatedAt)}</time>
			</header>
			<p className='mail-draft-text'>{draft.text.trim() || 'Message vide'}</p>
			{draft.attachments.length > 0 && (
				<span className='mail-draft-files'>
					<Icon name='paperclip' size={14} />
					{draft.attachments.length} pièce{draft.attachments.length > 1 ? 's' : ''} jointe{draft.attachments.length > 1 ? 's' : ''}
				</span>
			)}
			{draft.sendAt && (
				<span className='mail-thread-snooze'>
					<Icon name='clock' size={12} />
					Envoi prévu {longDate(draft.sendAt)}
				</span>
			)}
			{draft.sendError && <p className='notice notice-error'>Envoi prévu en échec : {draft.sendError}</p>}
			{error && <p className='notice notice-error'>{error}</p>}
			<footer className='mail-draft-actions'>
				{draft.sendAt && (
					<button className='btn btn-ghost' disabled={busy} onClick={() => void unschedule()}>
						Annuler l’envoi
					</button>
				)}
				<button className='btn btn-ghost' disabled={busy} onClick={() => void remove()}>
					Supprimer
				</button>
				<button className='btn' disabled={busy} onClick={onEdit}>
					Modifier
				</button>
				<button className='btn btn-primary' disabled={busy || draft.to.length === 0} onClick={() => void send()}>
					<Icon name='send' size={16} />
					Envoyer
				</button>
			</footer>
		</article>
	);
}
