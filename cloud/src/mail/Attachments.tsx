import type { MailAttachment } from '../../shared/mail';
import { Icon, fileIcon, formatSize } from '../ui';

const PREVIEW_MAX = 5 * 1024 * 1024;

const extension = (name: string) => (name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : '');

export function Attachments({ messageId, attachments }: { messageId: string; attachments: MailAttachment[] }) {
	if (attachments.length === 0) {
		return null;
	}
	const total = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
	return (
		<div className='mail-files'>
			<div className='mail-files-grid'>
				{attachments.map((attachment) => {
					const href = `/api/mail/messages/${messageId}/attachments/${attachment.index}`;
					const preview = attachment.type.startsWith('image/') && attachment.size <= PREVIEW_MAX;
					return (
						<a key={attachment.index} className='mail-file' href={href} download={attachment.name} title={attachment.name}>
							<span className='mail-file-thumb'>
								{preview ? <img src={href} alt='' loading='lazy' /> : <Icon name={fileIcon(attachment.type)} size={22} />}
								{!preview && extension(attachment.name) && <small>{extension(attachment.name)}</small>}
							</span>
							<span className='mail-file-name'>{attachment.name}</span>
							<span className='mail-file-size'>{formatSize(attachment.size)}</span>
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
		</div>
	);
}
