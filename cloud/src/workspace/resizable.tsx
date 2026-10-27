import { useCallback, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

import { readPref, writePref } from '../router';

type Options = { pref: string; min: number; max: number; initial: number; edge: 'start' | 'end' };

// edge = côté de la poignée : 'end' grandit vers la droite, 'start' vers la gauche.
export function useResizable({ pref, min, max, initial, edge }: Options) {
	const [width, setWidth] = useState(() => {
		const saved = Number(readPref(pref));
		return saved >= min && saved <= max ? saved : initial;
	});
	const [dragging, setDragging] = useState(false);
	const direction = edge === 'end' ? 1 : -1;
	const clamp = (value: number) => Math.round(Math.min(max, Math.max(min, value)));

	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			const startX = event.clientX;
			const startWidth = width;
			let latest = startWidth;
			setDragging(true);
			const move = (e: PointerEvent) => {
				latest = clamp(startWidth + (e.clientX - startX) * direction);
				setWidth(latest);
			};
			const up = () => {
				setDragging(false);
				writePref(pref, String(latest));
				window.removeEventListener('pointermove', move);
				window.removeEventListener('pointerup', up);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
			};
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
			window.addEventListener('pointermove', move);
			window.addEventListener('pointerup', up);
		},
		[width, pref, min, max, direction],
	);

	const onKeyDown = (event: ReactKeyboardEvent) => {
		const step = event.shiftKey ? 40 : 10;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			const next = clamp(width + (event.key === 'ArrowRight' ? step : -step) * direction);
			setWidth(next);
			writePref(pref, String(next));
		}
	};

	const reset = () => {
		setWidth(initial);
		writePref(pref, String(initial));
	};

	return { width, min, max, dragging, onPointerDown, onKeyDown, reset };
}

export type Resizable = ReturnType<typeof useResizable>;

export function ResizeHandle({ resize, label }: { resize: Resizable; label: string }) {
	return (
		<div
			className='resize-handle'
			role='separator'
			aria-orientation='vertical'
			aria-label={label}
			aria-valuemin={resize.min}
			aria-valuemax={resize.max}
			aria-valuenow={resize.width}
			tabIndex={0}
			data-active={resize.dragging}
			onPointerDown={resize.onPointerDown}
			onKeyDown={resize.onKeyDown}
			onDoubleClick={resize.reset}
			title='Glisser pour redimensionner, double-clic pour réinitialiser'
		/>
	);
}
