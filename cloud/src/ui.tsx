import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	const letters = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? '?').slice(0, 2);
	return letters.toUpperCase();
}

type AvatarProps = { name: string; url?: string | null; size?: number; square?: boolean; online?: boolean; className?: string };

export function Avatar({ name, url, size = 36, square, online, className = '' }: AvatarProps) {
	const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) };
	const cls = `avatar${square ? ' avatar-square' : ''} ${className}`;
	return (
		<span className={cls} style={style} aria-hidden>
			{url ? <img src={url} alt='' style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }} referrerPolicy='no-referrer' /> : initials(name)}
			{online && <span className='presence-dot' />}
		</span>
	);
}

export function Logo({ height = 28 }: { height?: number }) {
	return (
		<picture>
			<source srcSet='/logo.svg' media='(prefers-color-scheme: dark)' />
			<img src='/logo-ink.svg' alt='Synq' className='auth-logo' style={{ height }} />
		</picture>
	);
}

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		if (open && dialog && !dialog.open) {
			dialog.showModal();
		} else if (!open && dialog?.open) {
			dialog.close();
		}
	}, [open]);
	return (
		<dialog ref={ref} className='dialog' style={wide ? { width: 'min(760px, calc(100vw - 32px))' } : undefined} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
			<header className='dialog-head'>
				<h2>{title}</h2>
				<button type='button' className='icon-btn' onClick={onClose} aria-label='Fermer'>
					<Icon name='close' />
				</button>
			</header>
			<div className='dialog-body'>{open && children}</div>
		</dialog>
	);
}

export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
	useEffect(() => {
		if (!open) {
			return;
		}
		const onPointer = (event: PointerEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) {
				onClose();
			}
		};
		const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
		document.addEventListener('pointerdown', onPointer);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onPointer);
			document.removeEventListener('keydown', onKey);
		};
	}, [ref, open, onClose]);
}

const PATHS = {
	hash: 'M5 9h14M5 15h14M10 4L8 20M16 4l-2 16',
	megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6',
	speaker: 'M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
	mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
	'mic-off': 'M9 9V6a3 3 0 0 1 5.6-1.5M15 10v1a3 3 0 0 1-4.5 2.6M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.4 2.3M12 18v3M3 3l18 18',
	headphones: 'M3 14v-2a9 9 0 0 1 18 0v2M3 14a2 2 0 0 1 2-2h1v7H5a2 2 0 0 1-2-2zM21 14a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z',
	'headphones-off': 'M3 14v-2a9 9 0 0 1 14.5-7.1M21 12v2M3 14a2 2 0 0 1 2-2h1v7H5a2 2 0 0 1-2-2zM18 12h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1zM3 3l18 18',
	video: 'M15 10l5-3v10l-5-3zM3 7h12v10H3z',
	'video-off': 'M15 10l5-3v10l-5-3M10 7h5v5M3 7h2M3 7v10h12v-2M3 3l18 18',
	screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
	'screen-off': 'M3 4h18v12H3zM8 20h8M12 16v4M3 3l18 18',
	hangup: 'M3 15.5c5-4.7 13-4.7 18 0l-2.4 2.3-3.6-1.5v-3a12 12 0 0 0-6 0v3l-3.6 1.5z',
	search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
	chevron: 'M6 9l6 6 6-6',
	'chevron-right': 'M9 6l6 6-6 6',
	plus: 'M12 5v14M5 12h14',
	settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
	users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
	folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
	'folder-plus': 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM12 10v6M9 13h6',
	drive: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 10h18',
	file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
	image: 'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15 8.5a1 1 0 1 0 0 .1',
	film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
	music: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
	upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
	download: 'M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
	trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
	pencil: 'M4 20h4L19 9l-4-4L4 16v4z',
	reply: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 6 6v5',
	more: 'M5 12h.01M12 12h.01M19 12h.01',
	close: 'M6 6l12 12M18 6L6 18',
	menu: 'M4 7h16M4 12h16M4 17h10',
	logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
	login: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
	home: 'M3 11l9-7 9 7M5 9.5V20h14V9.5',
	check: 'M5 12l5 5 9-10',
	send: 'M12 19V5M5 12l7-7 7 7',
	paperclip: 'M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
	'user-plus': 'M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M8.5 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM19 8v6M16 11h6',
	compose: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
	arrow: 'M5 12h14M13 6l6 6-6 6',
	link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
	chat: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
	'chevron-left': 'M15 6l-6 6 6 6',
	up: 'M12 19V5M5 12l7-7 7 7',
	down: 'M12 5v14M5 12l7 7 7-7',
	shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
	calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
	clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
	repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
	bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
	pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
	return (
		<svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={name === 'more' ? 3 : strokeWidth} strokeLinecap='round' strokeLinejoin='round' aria-hidden>
			<path d={PATHS[name]} />
		</svg>
	);
}

export const formatSize = (bytes: number) =>
	bytes < 1024 ? `${bytes} o` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} Ko` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;

export function fileIcon(type: string): IconName {
	if (type.startsWith('image/')) {
		return 'image';
	}
	if (type.startsWith('video/')) {
		return 'film';
	}
	if (type.startsWith('audio/')) {
		return 'music';
	}
	return 'file';
}
