import { Icon, fileIcon, formatSize } from '../../ui';
import type { Upload } from './useUploads';
import './media.css';

export function PendingFiles({ items, onRemove }: { items: Upload[]; onRemove: (id: string) => void }) {
	return (
		<div className='composer-chips media-pending' aria-label='Fichiers joints'>
			{items.map((u) => (
				<div key={u.id} className={`pending-file${u.error ? ' is-error' : ''}`} title={u.error ?? u.file.name}>
					{u.preview ? (
						<img src={u.preview} alt='' />
					) : (
						<span className='file-icon'>
							<Icon name={fileIcon(u.file.type)} size={16} />
						</span>
					)}
					<span className='file-meta'>
						<span>{u.file.name}</span>
						<span role={u.error ? 'alert' : undefined}>{u.error ?? (u.attachment ? formatSize(u.file.size) : `Envoi : ${Math.round(u.ratio * 100)} %`)}</span>
					</span>
					<button type='button' className='icon-btn icon-btn-sm' aria-label={`Retirer ${u.file.name}`} title='Retirer' onClick={() => onRemove(u.id)}>
						<Icon name='close' size={14} />
					</button>
					{!u.attachment && !u.error && <span className='pending-bar' style={{ width: `${Math.round(u.ratio * 100)}%` }} />}
				</div>
			))}
		</div>
	);
}
