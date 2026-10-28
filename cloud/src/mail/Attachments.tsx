import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { MailAttachment } from '../../shared/mail';
import { Dialog, Icon, fileIcon, formatSize } from '../ui';

const PREVIEW_MAX = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const extension = (name: string) => (name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : '');

const isImage = (attachment: MailAttachment) => IMAGE_TYPES.has(attachment.type);
const isPdf = (attachment: MailAttachment) => attachment.type === 'application/pdf' || /\.pdf$/i.test(attachment.name);

export function Attachments({ messageId, attachments }: { messageId: string; attachments: MailAttachment[] }) {
	const [viewing, setViewing] = useState<number | null>(null);
	const [pdf, setPdf] = useState<MailAttachment | null>(null);
	if (attachments.length === 0) {
		return null;
	}
	const href = (attachment: MailAttachment) => `/api/mail/messages/${messageId}/attachments/${attachment.index}`;
	const images = attachments.filter(isImage);
	const total = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
	return (
		<div className='mail-files'>
			<div className='mail-files-grid'>
				{attachments.map((attachment) => {
					const preview = isImage(attachment) && attachment.size <= PREVIEW_MAX;
					const body = (
						<>
							<span className='mail-file-thumb'>
								{preview ? <img src={href(attachment)} alt='' loading='lazy' /> : <Icon name={fileIcon(attachment.type)} size={22} />}
								{!preview && extension(attachment.name) && <small>{extension(attachment.name)}</small>}
							</span>
							<span className='mail-file-name'>{attachment.name}</span>
							<span className='mail-file-size'>{formatSize(attachment.size)}</span>
						</>
					);
					if (isImage(attachment) || isPdf(attachment)) {
						return (
							<button
								key={attachment.index}
								type='button'
								className='mail-file'
								title={`Aperçu de ${attachment.name}`}
								onClick={() => (isImage(attachment) ? setViewing(images.indexOf(attachment)) : setPdf(attachment))}
							>
								{body}
							</button>
						);
					}
					return (
						<a key={attachment.index} className='mail-file' href={href(attachment)} download={attachment.name} title={attachment.name}>
							{body}
						</a>
					);
				})}
			</div>
			{attachments.length > 1 && (
				<a className='btn btn-ghost mail-files-all' href={`/api/mail/messages/${messageId}/attachments.zip`} download>
					<Icon name='download' size={16} />
					Enregistrer tout ({formatSize(total)})
				</a>
			)}
			{viewing !== null && images[viewing] && <Viewer images={images} index={viewing} href={href} onIndex={setViewing} onClose={() => setViewing(null)} />}
			{pdf && (
				<Dialog open onClose={() => setPdf(null)} title={pdf.name} wide>
					<div className='mail-pdf'>
						{/* Sans sandbox : Chrome bloque sa visionneuse PDF dans une iframe sandboxée. Type forcé et nosniff côté serveur. */}
						<iframe title={pdf.name} src={`${href(pdf)}?inline=1`} referrerPolicy='no-referrer' />
						<div className='mail-form-actions'>
							<a className='btn' href={href(pdf)} download={pdf.name}>
								<Icon name='download' size={16} />
								Télécharger
							</a>
						</div>
					</div>
				</Dialog>
			)}
		</div>
	);
}

type ViewerProps = { images: MailAttachment[]; index: number; href: (attachment: MailAttachment) => string; onIndex: (index: number) => void; onClose: () => void };

// Dialogue natif : Échap ferme, et le raccourci « retour » du fil l'ignore.
function Viewer({ images, index, href, onIndex, onClose }: ViewerProps) {
	const ref = useRef<HTMLDialogElement>(null);
	const current = images[index]!;

	useEffect(() => {
		const dialog = ref.current;
		if (dialog && !dialog.open) {
			dialog.showModal();
		}
	}, []);

	const go = (step: number) => onIndex((index + step + images.length) % images.length);

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			go(1);
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			go(-1);
		}
	};

	return (
		<dialog ref={ref} className='mail-viewer' onClose={onClose} onKeyDown={onKeyDown} onClick={(e) => e.target === e.currentTarget && onClose()} aria-label={current.name}>
			<header className='mail-viewer-bar'>
				<span className='mail-viewer-name'>{current.name}</span>
				<small>
					{index + 1} / {images.length} · {formatSize(current.size)}
				</small>
				<a className='icon-btn' href={href(current)} download={current.name} title='Télécharger' aria-label='Télécharger'>
					<Icon name='download' />
				</a>
				<button className='icon-btn' onClick={onClose} title='Fermer' aria-label='Fermer'>
					<Icon name='close' />
				</button>
			</header>
			<div className='mail-viewer-stage' onClick={(e) => e.target === e.currentTarget && onClose()}>
				{images.length > 1 && (
					<button className='icon-btn mail-viewer-nav' onClick={() => go(-1)} title='Précédente' aria-label='Image précédente'>
						<Icon name='chevron-left' />
					</button>
				)}
				<img src={href(current)} alt={current.name} />
				{images.length > 1 && (
					<button className='icon-btn mail-viewer-nav' onClick={() => go(1)} title='Suivante' aria-label='Image suivante'>
						<Icon name='chevron-right' />
					</button>
				)}
			</div>
		</dialog>
	);
}
