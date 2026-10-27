import type { ReactNode } from 'react';

import { Icon } from '../ui';
import { toBullets } from './parse';
import './ai.css';

type Props = {
	label: string;
	text: string | null;
	error: string | null;
	onCancel?: () => void;
	onClose?: () => void;
	onRetry?: () => void;
	actions?: ReactNode;
	children?: ReactNode;
};

// Encart IA : squelette pendant le chargement, erreur lisible, puces si le modèle en rend.
export function AiBlock({ label, text, error, onCancel, onClose, onRetry, actions, children }: Props) {
	const loading = text === null && !error;
	const bullets = text ? toBullets(text) : null;
	return (
		<div className='ai-block' aria-busy={loading} aria-live='polite'>
			<div className='ai-block-head'>
				<span aria-hidden className='ai-glyph'>
					✦
				</span>
				<span className='grow'>{label}</span>
				{loading && onCancel && (
					<button type='button' className='btn btn-ghost ai-btn-sm' onClick={onCancel}>
						Annuler
					</button>
				)}
				{!loading && actions}
				{onClose && !loading && (
					<button type='button' className='icon-btn icon-btn-sm' aria-label='Fermer' onClick={onClose}>
						<Icon name='close' size={14} />
					</button>
				)}
			</div>
			{loading ? (
				<div className='ai-skeleton' aria-label='Chargement'>
					<span />
					<span />
					<span />
				</div>
			) : error ? (
				<div className='notice notice-error ai-block-error'>
					<span className='grow'>{error}</span>
					{onRetry && (
						<button type='button' className='btn ai-btn-sm' onClick={onRetry}>
							Réessayer
						</button>
					)}
				</div>
			) : (
				(children ??
				(bullets ? (
					<ul className='ai-bullets'>
						{bullets.map((b, i) => (
							<li key={i}>{b}</li>
						))}
					</ul>
				) : (
					<div className='ai-block-text'>{text}</div>
				)))
			)}
		</div>
	);
}
