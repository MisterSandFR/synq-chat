import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Icon, useDismiss, type IconName } from '../ui';
import './chat/chat.css';

export type ContextMenuItem = { label: string; icon?: IconName; danger?: boolean; disabled?: boolean; onSelect: () => void } | 'sep';

type Props = {
	x: number;
	y: number;
	items: ContextMenuItem[];
	onClose: () => void;
	// Contenu libre au-dessus des actions (réactions rapides).
	header?: ReactNode;
};

const MARGIN = 8;

// Séparateurs en tête, en fin ou doublés retirés.
const tidy = (items: ContextMenuItem[]) =>
	items.filter((item, i, all) => item !== 'sep' || (i > 0 && i < all.length - 1 && all[i - 1] !== 'sep' && all.slice(i + 1).some((next) => next !== 'sep')));

export function ContextMenu({ x, y, items, onClose, header }: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	useDismiss(ref, true, onClose);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const { width, height } = el.getBoundingClientRect();
		setPos({
			left: Math.max(MARGIN, x + width > window.innerWidth - MARGIN ? x - width : x),
			top: Math.max(MARGIN, y + height > window.innerHeight - MARGIN ? y - height : y),
		});
		el.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
	}, [x, y]);

	useEffect(() => {
		window.addEventListener('resize', onClose);
		window.addEventListener('scroll', onClose, true);
		return () => {
			window.removeEventListener('resize', onClose);
			window.removeEventListener('scroll', onClose, true);
		};
	}, [onClose]);

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
			return;
		}
		event.preventDefault();
		const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
		const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
		const step = event.key === 'ArrowDown' ? 1 : buttons.length - 1;
		buttons[(Math.max(index, event.key === 'ArrowDown' ? -1 : 0) + step) % buttons.length]?.focus();
	};

	return (
		<div
			ref={ref}
			className='popover context-menu'
			role='menu'
			style={pos ?? { left: x, top: y, visibility: 'hidden' }}
			onKeyDown={onKeyDown}
			onContextMenu={(e) => e.preventDefault()}
		>
			{header}
			{tidy(items).map((item, i) =>
				item === 'sep' ? (
					<div key={i} className='menu-sep' role='separator' />
				) : (
					<button
						key={i}
						type='button'
						role='menuitem'
						className={`menu-item${item.danger ? ' menu-item-danger' : ''}`}
						disabled={item.disabled}
						onClick={() => {
							onClose();
							item.onSelect();
						}}
					>
						{item.icon && <Icon name={item.icon} size={16} />}
						<span className='grow'>{item.label}</span>
					</button>
				),
			)}
		</div>
	);
}
