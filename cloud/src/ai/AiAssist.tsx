import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { AiRewriteInput, AiTextResult, RewriteAction } from '../../shared/ai';
import { api, errorText } from '../api';
import { Floating } from '../floating';
import { useDismiss } from '../ui';
import './ai.css';

const ACTIONS: Array<[RewriteAction, string]> = [
	['reformuler', 'Reformuler'],
	['corriger', 'Corriger'],
	['raccourcir', 'Raccourcir'],
	['developper', 'Développer'],
	['formel', 'Plus formel'],
	['chaleureux', 'Plus chaleureux'],
	['traduire_en', 'Traduire en anglais'],
	['traduire_fr', 'Traduire en français'],
	['continuer', 'Continuer'],
];

type Props = {
	textarea: RefObject<HTMLTextAreaElement | null>;
	value: string;
	onChange: (next: string) => void;
	// Texte voisin (fil, mail cité) donné au modèle sans être réécrit.
	context?: string;
	// Popovers alignés à droite (panneau latéral).
	align?: 'end';
};

type Run = { input: AiRewriteInput; range: [number, number] };

export function AiAssist({ textarea, value, onChange, context, align }: Props) {
	const box = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [custom, setCustom] = useState<string | null>(null);
	const [run, setRun] = useState<Run | null>(null);
	const [result, setResult] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const close = useCallback(() => {
		setOpen(false);
		setCustom(null);
		setRun(null);
		setResult(null);
		setError(null);
	}, []);
	useDismiss(box, open || run !== null, close);

	useEffect(() => {
		const el = textarea.current;
		if (!el) {
			return;
		}
		const onKey = (e: globalThis.KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
				e.preventDefault();
				setOpen(true);
			}
		};
		el.addEventListener('keydown', onKey);
		return () => el.removeEventListener('keydown', onKey);
	}, [textarea]);

	const send = (next: Run) => {
		setRun(next);
		setResult(null);
		setError(null);
		api<AiTextResult>('POST', '/ai/rewrite', next.input)
			.then((reply) => setResult(reply.text))
			.catch((e: unknown) => setError(errorText(e)));
	};

	const start = (action: RewriteAction, instruction?: string) => {
		const el = textarea.current;
		const [a, b] = el && el.selectionStart !== el.selectionEnd ? [el.selectionStart, el.selectionEnd] : [0, value.length];
		const text = value.slice(a, b);
		setOpen(false);
		setCustom(null);
		if (!text.trim()) {
			setRun({ input: { action, text }, range: [a, b] });
			setError('Écris d’abord un texte à retravailler.');
			return;
		}
		send({ input: { action, text, ...(context ? { context } : {}), ...(instruction ? { instruction } : {}) }, range: [a, b] });
	};

	const apply = (mode: 'replace' | 'insert') => {
		if (!run || result === null) {
			return;
		}
		const [a, b] = run.range;
		const next = mode === 'replace' ? value.slice(0, a) + result + value.slice(b) : `${value.slice(0, b)}${value.slice(0, b).endsWith(' ') || b === 0 ? '' : ' '}${result}${value.slice(b)}`;
		onChange(next.slice(0, 8000));
		close();
		requestAnimationFrame(() => textarea.current?.focus());
	};

	return (
		<div className={`ai-assist${align === 'end' ? ' ai-assist-end' : ''}`} ref={box}>
			<button type='button' className='icon-btn' aria-label='Assistant IA' title='Assistant IA (Ctrl+J)' aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
				<span aria-hidden className='ai-glyph'>
					✦
				</span>
			</button>
			{open && (
				<Floating anchor={box} placement={align === 'end' ? 'top-end' : 'top-start'} className='popover ai-menu' role='menu' aria-label='Assistant IA'>
					{ACTIONS.map(([action, label]) => (
						<button key={action} type='button' role='menuitem' className='menu-item' onClick={() => start(action)}>
							{label}
						</button>
					))}
					{custom === null ? (
						<button type='button' role='menuitem' className='menu-item' onClick={() => setCustom('')}>
							Consigne libre…
						</button>
					) : (
						<form
							className='ai-custom'
							onSubmit={(e) => {
								e.preventDefault();
								if (custom.trim()) {
									start('reformuler', custom.trim());
								}
							}}
						>
							<input autoFocus value={custom} maxLength={500} placeholder='Ex. : ajoute une formule de politesse' aria-label='Consigne libre' onChange={(e) => setCustom(e.target.value)} />
						</form>
					)}
				</Floating>
			)}
			{run && (
				<Floating anchor={box} placement={align === 'end' ? 'top-end' : 'top-start'} className='popover ai-preview' role='dialog' aria-label='Proposition de l’IA'>
					{error ? (
						<p className='notice notice-error'>{error}</p>
					) : result === null ? (
						<div className='spinner' style={{ minHeight: 48 }} aria-busy />
					) : (
						<div className='ai-result'>{result}</div>
					)}
					<div className='ai-actions'>
						<button type='button' className='btn btn-primary' disabled={result === null} onClick={() => apply('replace')}>
							Remplacer
						</button>
						<button type='button' className='btn' disabled={result === null} onClick={() => apply('insert')}>
							Insérer
						</button>
						<button type='button' className='btn btn-ghost' disabled={!run.input.text.trim() || (result === null && !error)} onClick={() => send(run)}>
							Réessayer
						</button>
						<button type='button' className='btn btn-ghost' onClick={close}>
							Annuler
						</button>
					</div>
				</Floating>
			)}
		</div>
	);
}
