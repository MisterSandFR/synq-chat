import { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'right-end';

type Props = HTMLAttributes<HTMLDivElement> & {
	anchor: RefObject<HTMLElement | null>;
	placement?: Placement;
	offset?: number;
	// Même largeur que l'ancre (suggestions sous un champ).
	matchWidth?: boolean;
	children: ReactNode;
};

const MARGIN = 8;

type Position = { top: number; left: number; maxHeight: number };

// Hors du flux : aucun parent en overflow ne peut couper le menu. Dans une <dialog>, rendu dedans (couche supérieure).
export function Floating({ anchor, placement = 'bottom-start', offset = 6, matchWidth = false, children, style, ...rest }: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<Position | null>(null);
	const container = anchor.current?.closest('dialog') ?? document.body;

	useLayoutEffect(() => {
		const el = ref.current;
		const target = anchor.current;
		if (!el || !target) {
			return;
		}
		let frame = 0;
		const place = () => {
			const a = target.getBoundingClientRect();
			// Hauteur naturelle, sans la limite posée au passage précédent.
			el.style.maxHeight = 'none';
			if (matchWidth) {
				el.style.width = `${a.width}px`;
			}
			const { width, height } = el.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const [side, align] = placement.split('-') as ['bottom' | 'top' | 'right', 'start' | 'end'];
			let top: number;
			let left: number;
			let maxHeight = vh - 2 * MARGIN;
			if (side === 'right') {
				left = a.right + offset;
				if (left + width > vw - MARGIN) {
					left = Math.max(MARGIN, a.left - offset - width);
				}
				top = align === 'end' ? a.bottom - height : a.top;
			} else {
				const below = vh - a.bottom - offset - MARGIN;
				const above = a.top - offset - MARGIN;
				const down = side === 'bottom' ? height <= below || below >= above : !(height <= above || above >= below);
				maxHeight = down ? below : above;
				top = down ? a.bottom + offset : a.top - offset - Math.min(height, above);
				left = align === 'end' ? a.right - width : a.left;
			}
			top = Math.min(Math.max(MARGIN, top), vh - MARGIN - Math.min(height, maxHeight));
			left = Math.min(Math.max(MARGIN, left), vw - MARGIN - width);
			// Dialog transformée : `fixed` y devient relatif à elle.
			if (container !== document.body && getComputedStyle(container).transform !== 'none') {
				const c = container.getBoundingClientRect();
				top -= c.top;
				left -= c.left;
			}
			el.style.maxHeight = `${maxHeight}px`;
			setPosition((prev) => (prev && prev.top === top && prev.left === left && prev.maxHeight === maxHeight ? prev : { top, left, maxHeight }));
		};
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(place);
		};
		place();
		const observer = new ResizeObserver(schedule);
		observer.observe(el);
		window.addEventListener('resize', schedule);
		window.addEventListener('scroll', schedule, true);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			window.removeEventListener('resize', schedule);
			window.removeEventListener('scroll', schedule, true);
		};
	}, [anchor, placement, offset, matchWidth, container]);

	const placed: CSSProperties = {
		...style,
		position: 'fixed',
		top: position?.top ?? 0,
		left: position?.left ?? 0,
		right: 'auto',
		bottom: 'auto',
		transform: 'none',
		margin: 0,
		zIndex: 1000,
		maxHeight: position ? position.maxHeight : undefined,
		overflowY: 'auto',
		visibility: position ? undefined : 'hidden',
	};

	return createPortal(
		<div {...rest} ref={ref} data-floating='' style={placed}>
			{children}
		</div>,
		container,
	);
}
