import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { Attachment } from '../../../shared/types';
import { fileUrl } from '../../api';
import { Icon, formatSize } from '../../ui';
import './media.css';

type Props = { workspaceId: string; items: Attachment[]; start: number; onClose: () => void };

export function Lightbox({ workspaceId, items, start, onClose }: Props) {
	const [index, setIndex] = useState(start);
	const closeButton = useRef<HTMLButtonElement>(null);
	// Ref : un nouveau rendu du parent ne doit pas réarmer le focus.
	const close = useRef(onClose);
	close.current = onClose;
	const count = items.length;
	const go = (step: number) => setIndex((i) => (i + step + count) % count);

	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		closeButton.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				close.current();
			} else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
				setIndex((i) => (i + (e.key === 'ArrowRight' ? 1 : -1) + count) % count);
			}
		};
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('keydown', onKey);
			previous?.focus();
		};
	}, [count]);

	const item = items[Math.min(index, count - 1)];
	if (!item) {
		return null;
	}
	const url = fileUrl(workspaceId, item.key);
	return createPortal(
		<div className='lightbox' role='dialog' aria-modal='true' aria-label={item.name}>
			<header className='lightbox-bar'>
				<span className='lightbox-title'>
					<span>{item.name}</span>
					<span>
						{formatSize(item.size)}
						{count > 1 && ` · ${index + 1} sur ${count}`}
					</span>
				</span>
				<a className='icon-btn' href={url} download={item.name} aria-label='Télécharger' title='Télécharger'>
					<Icon name='download' />
				</a>
				<a className='icon-btn' href={url} target='_blank' rel='noopener noreferrer' aria-label='Ouvrir dans un onglet' title='Ouvrir dans un onglet'>
					<Icon name='link' />
				</a>
				<button ref={closeButton} type='button' className='icon-btn' aria-label='Fermer' title='Fermer (Échap)' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<div className='lightbox-stage' onClick={(e) => e.target === e.currentTarget && onClose()}>
				<img key={item.key} src={url} alt={item.name} />
				{count > 1 && (
					<>
						<button type='button' className='icon-btn lightbox-nav lightbox-prev' aria-label='Image précédente' onClick={() => go(-1)}>
							<Icon name='arrow' />
						</button>
						<button type='button' className='icon-btn lightbox-nav lightbox-next' aria-label='Image suivante' onClick={() => go(1)}>
							<Icon name='arrow' />
						</button>
					</>
				)}
			</div>
		</div>,
		document.body,
	);
}
