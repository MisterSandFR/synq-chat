import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Floating } from '../../floating';
import { Icon, useDismiss } from '../../ui';
import { dayText, presets } from './format';
import { ScheduleDialog } from './ScheduleDialog';
import './drafts.css';

type Props = {
	disabled: boolean;
	onSchedule: (sendAt: number) => Promise<void>;
};

// Moitié droite du bouton d'envoi scindé.
export function ScheduleButton({ disabled, onSchedule }: Props) {
	const box = useRef<HTMLSpanElement>(null);
	const [open, setOpen] = useState(false);
	const [custom, setCustom] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	useDismiss(box, open, close);

	return (
		<span ref={box} className='send-more-box'>
			<button
				type='button'
				className='send-more'
				aria-label='Programmer l’envoi'
				title='Programmer l’envoi'
				aria-haspopup='menu'
				aria-expanded={open}
				disabled={disabled}
				onClick={() => setOpen(!open)}
			>
				<Icon name='chevron' size={14} strokeWidth={2.2} />
			</button>
			{open && (
				<Floating anchor={box} placement='top-end' className='popover schedule-menu' role='menu' aria-label='Programmer l’envoi'>
					<p className='schedule-menu-title'>Programmer l’envoi</p>
					{presets().map((p) => (
						<button
							key={p.label}
							type='button'
							role='menuitem'
							className='menu-item'
							onClick={() => {
								setOpen(false);
								void onSchedule(p.at);
							}}
						>
							<span className='grow'>{p.label}</span>
							<span className='schedule-menu-hint'>{dayText(p.at)}</span>
						</button>
					))}
					<button
						type='button'
						role='menuitem'
						className='menu-item'
						onClick={() => {
							setOpen(false);
							setCustom(true);
						}}
					>
						<Icon name='clock' size={16} />
						<span className='grow'>Date et heure…</span>
					</button>
				</Floating>
			)}
			{/* Hors du <form> du composer : un formulaire imbriqué part en envoi natif. */}
			{custom &&
				createPortal(
					<ScheduleDialog title='Programmer l’envoi' submitLabel='Programmer' initial={presets()[0]!.at} onClose={() => setCustom(false)} onSubmit={onSchedule} />,
					document.body,
				)}
		</span>
	);
}
