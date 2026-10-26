import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

const hue = (seed: string) => [...seed].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 7);

export function Avatar({ id, name, url, size = 36 }: { id: string; name: string; url?: string | null; size?: number }) {
	const style = { width: size, height: size, fontSize: size * 0.42, '--avatar-hue': hue(id) } as CSSProperties;
	if (url) {
		return <img className='avatar' src={url} alt='' style={style} referrerPolicy='no-referrer' />;
	}
	return (
		<span className='avatar' style={style} aria-hidden>
			{name.trim().charAt(0).toUpperCase() || '?'}
		</span>
	);
}

export function Logo({ height = 28 }: { height?: number }) {
	return (
		<picture>
			<source srcSet='/logo-ink.svg' media='(prefers-color-scheme: light)' />
			<img src='/logo.svg' alt='Synq' height={height} style={{ height, width: 'auto' }} />
		</picture>
	);
}

export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		if (!dialog) {
			return;
		}
		if (open && !dialog.open) {
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	}, [open]);
	return (
		<dialog ref={ref} className='dialog' onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
			<header className='dialog-head'>
				<h2>{title}</h2>
				<button type='button' className='icon-button' onClick={onClose} aria-label='Fermer'>
					<Icon name='close' />
				</button>
			</header>
			<div className='dialog-body'>{open && children}</div>
		</dialog>
	);
}

const ICONS = {
	close: 'M6 6l12 12M18 6L6 18',
	hash: 'M9 4L7 20M17 4l-2 16M4 9h16M3 15h16',
	megaphone: 'M4 10v4h3l6 4V6L7 10H4zm13-1a4 4 0 010 6',
	paperclip: 'M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7',
	send: 'M4 12l16-8-6 16-2.5-6.5L4 12z',
	settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-2.2-1.3L14.4 3h-4l-.4 2.4a7.6 7.6 0 00-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.6l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 002.2 1.3l.4 2.4h4l.4-2.4a7.6 7.6 0 002.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z',
	users: 'M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm13 9v-1a4 4 0 00-3-3.9M16 3.1a3.5 3.5 0 010 6.8',
	menu: 'M4 6h16M4 12h16M4 18h16',
	plus: 'M12 5v14M5 12h14',
	pencil: 'M4 20h4L19 9l-4-4L4 16v4z',
	trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
	logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
	file: 'M14 3H6v18h12V7l-4-4zm0 0v4h4',
} as const;

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) {
	return (
		<svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
			<path d={ICONS[name]} />
		</svg>
	);
}

export const formatSize = (bytes: number) =>
	bytes < 1024 ? `${bytes} o` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
