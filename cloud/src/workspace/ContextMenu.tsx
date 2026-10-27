import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';

import { Icon, useDismiss, type IconName } from '../ui';
import './chat/chat.css';

export type ContextMenuItem = { label: string; icon?: IconName; danger?: boolean; disabled?: boolean; onSelect: () => void } | 'sep';

// `header` : contenu libre au-dessus des actions (réactions rapides).
type Opened = { x: number; y: number; items: ContextMenuItem[]; header?: ReactNode };

const LONG_PRESS = 500;

// Séparateurs en tête, en fin ou doublés retirés.
const tidy = (items: ContextMenuItem[]) =>
	items.filter((item, i, all) => item !== 'sep' || (i > 0 && i < all.length - 1 && all[i - 1] !== 'sep' && all.slice(i + 1).some((next) => next !== 'sep')));

export function ContextMenu({ x, y, items, header, onClose }: Opened & { onClose: () => void }) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ left: x, top: y });
	useDismiss(ref, true, onClose);

	// Recadré dans la fenêtre une fois sa taille connue.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const { width, height } = el.getBoundingClientRect();
		setPos({ left: Math.max(8, Math.min(x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - height - 8)) });
		el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
	}, [x, y]);

	useEffect(() => {
		window.addEventListener('resize', onClose);
		window.addEventListener('blur', onClose);
		return () => {
			window.removeEventListener('resize', onClose);
			window.removeEventListener('blur', onClose);
		};
	}, [onClose]);

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key === 'Escape' || e.key === 'Tab') {
			e.preventDefault();
			onClose();
			return;
		}
		if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
			return;
		}
		e.preventDefault();
		const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
		const n = buttons.length;
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const down = e.key === 'ArrowDown';
		const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : index < 0 ? (down ? 0 : n - 1) : (index + (down ? 1 : -1) + n) % n;
		buttons[next]?.focus();
	};

	return createPortal(
		<div ref={ref} className='popover ctx-menu context-menu' role='menu' style={{ position: 'fixed', left: pos.left, top: pos.top }} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
			{header}
			{tidy(items).map((item, index) =>
				item === 'sep' ? (
					<div key={`sep-${index}`} className='menu-sep' role='separator' />
				) : (
					<button
						key={index}
						type='button'
						role='menuitem'
						className={`menu-item${item.danger ? ' menu-item-danger' : ''}`}
						disabled={item.disabled}
						onClick={() => {
							onClose();
							item.onSelect();
						}}
					>
						{item.icon && <Icon name={item.icon} size={16} />} {item.label}
					</button>
				),
			)}
		</div>,
		document.body,
	);
}

// `bind(() => items)` sur l'élément cible : clic droit, ou appui long au doigt (iOS n'émet pas contextmenu).
export function useContextMenu() {
	const [opened, setOpened] = useState<Opened | null>(null);
	const timer = useRef<number | null>(null);
	const close = useCallback(() => setOpened(null), []);
	const open = useCallback((x: number, y: number, items: ContextMenuItem[]) => {
		if (items.length) {
			setOpened({ x, y, items });
		}
	}, []);
	const cancel = () => {
		if (timer.current !== null) {
			window.clearTimeout(timer.current);
			timer.current = null;
		}
	};
	const bind = (items: () => ContextMenuItem[]) => ({
		onContextMenu: (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			cancel();
			open(e.clientX, e.clientY, items());
		},
		onTouchStart: (e: TouchEvent) => {
			e.stopPropagation();
			const touch = e.touches[0];
			cancel();
			if (touch) {
				const { clientX, clientY } = touch;
				timer.current = window.setTimeout(() => {
					timer.current = null;
					open(clientX, clientY, items());
				}, LONG_PRESS);
			}
		},
		onTouchEnd: cancel,
		onTouchMove: cancel,
	});
	const menu: ReactNode = opened ? <ContextMenu {...opened} onClose={close} /> : null;
	return { bind, open, close, menu };
}
