import { useRef, useState, type ClipboardEvent, type FormEvent } from 'react';

import { LIMITS, type Attachment, type Channel } from '../../shared/types';
import { errorText, uploadFile } from '../api';
import { Icon, formatSize } from '../ui';

type Props = {
	workspaceId: string;
	channel: Channel;
	canPost: boolean;
	onSend: (body: string, attachmentKey?: string) => Promise<void>;
	onTyping: () => void;
};

const TYPING_EVERY = 3000;

export function Composer({ workspaceId, channel, canPost, onSend, onTyping }: Props) {
	const [text, setText] = useState('');
	const [attachment, setAttachment] = useState<Attachment | null>(null);
	const [uploading, setUploading] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const lastTyping = useRef(0);
	const fileInput = useRef<HTMLInputElement>(null);
	const textarea = useRef<HTMLTextAreaElement>(null);

	if (!canPost) {
		return <p className='composer-locked'>Seuls les admins publient dans #{channel.name}.</p>;
	}

	const attach = async (file: File) => {
		setError(null);
		if (file.size > LIMITS.fileSize) {
			setError(`${file.name} dépasse 10 Mo.`);
			return;
		}
		setUploading(file.name);
		try {
			setAttachment(await uploadFile(workspaceId, file));
		} catch (err) {
			setError(errorText(err));
		} finally {
			setUploading(null);
		}
	};

	const submit = async (event?: FormEvent) => {
		event?.preventDefault();
		if (sending || uploading || (!text.trim() && !attachment)) {
			return;
		}
		setSending(true);
		setError(null);
		try {
			await onSend(text, attachment?.key);
			setText('');
			setAttachment(null);
			lastTyping.current = 0;
		} catch (err) {
			setError(errorText(err));
		} finally {
			setSending(false);
			textarea.current?.focus();
		}
	};

	const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
		const file = event.clipboardData.files[0];
		if (file) {
			event.preventDefault();
			void attach(file);
		}
	};

	return (
		<form className='composer' onSubmit={submit}>
			{(attachment || uploading || error) && (
				<div className='composer-meta'>
					{uploading && <span className='chip'>Envoi de {uploading}…</span>}
					{attachment && (
						<span className='chip'>
							<Icon name='file' size={14} /> {attachment.name} · {formatSize(attachment.size)}
							<button type='button' className='chip-remove' aria-label='Retirer le fichier' onClick={() => setAttachment(null)}>
								<Icon name='close' size={12} />
							</button>
						</span>
					)}
					{error && (
						<span className='notice notice-error' role='alert'>
							{error}
						</span>
					)}
				</div>
			)}
			<div className='composer-box'>
				<button type='button' className='icon-button' aria-label='Joindre un fichier' title='Joindre un fichier' onClick={() => fileInput.current?.click()}>
					<Icon name='paperclip' />
				</button>
				<input
					ref={fileInput}
					type='file'
					hidden
					onChange={(e) => {
						const file = e.target.files?.[0];
						e.target.value = '';
						if (file) {
							void attach(file);
						}
					}}
				/>
				<textarea
					ref={textarea}
					value={text}
					rows={1}
					maxLength={LIMITS.messageLength}
					placeholder={`Écrire dans #${channel.name}`}
					aria-label={`Écrire dans #${channel.name}`}
					onPaste={onPaste}
					onChange={(e) => {
						setText(e.target.value);
						e.target.style.height = 'auto';
						e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
						if (Date.now() - lastTyping.current > TYPING_EVERY) {
							lastTyping.current = Date.now();
							onTyping();
						}
					}}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault();
							void submit();
						}
					}}
				/>
				<button className='icon-button icon-button-send' aria-label='Envoyer' title='Envoyer' disabled={sending || Boolean(uploading) || (!text.trim() && !attachment)}>
					<Icon name='send' />
				</button>
			</div>
		</form>
	);
}
