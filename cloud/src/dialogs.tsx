import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';

import { Dialog } from './ui';

type ConfirmOptions = { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type AlertOptions = { title: string; message?: string };
type PromptOptions = { title: string; label?: string; initial?: string; placeholder?: string; confirmLabel?: string; maxLength?: number };

type Request = { id: number } & (
	| ({ kind: 'confirm'; resolve: (ok: boolean) => void } & ConfirmOptions)
	| ({ kind: 'alert'; resolve: () => void } & AlertOptions)
	| ({ kind: 'prompt'; resolve: (value: string | null) => void } & PromptOptions)
);
type Pending = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never;

// File d'attente : deux demandes simultanées s'affichent l'une après l'autre.
let queue: Request[] = [];
let nextId = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function push(request: Pending): void {
	queue = [...queue, { ...request, id: ++nextId } as Request];
	emit();
}

function shift(): void {
	queue = queue.slice(1);
	emit();
}

export const confirmDialog = (options: ConfirmOptions) => new Promise<boolean>((resolve) => push({ kind: 'confirm', resolve, ...options }));

export const alertDialog = (options: AlertOptions) => new Promise<void>((resolve) => push({ kind: 'alert', resolve, ...options }));

export const promptDialog = (options: PromptOptions) => new Promise<string | null>((resolve) => push({ kind: 'prompt', resolve, ...options }));

// Remplace window.confirm, alert et prompt : monté une fois à la racine.
export function DialogHost() {
	const current = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => queue[0] ?? null,
	);
	if (!current) {
		return null;
	}
	return <HostDialog key={current.id} request={current} />;
}

function HostDialog({ request }: { request: Request }) {
	const [value, setValue] = useState(request.kind === 'prompt' ? (request.initial ?? '') : '');
	const primary = useRef<HTMLButtonElement>(null);
	const field = useRef<HTMLInputElement>(null);
	const settled = useRef(false);

	const finish = (answer: boolean) => {
		if (settled.current) {
			return;
		}
		settled.current = true;
		if (request.kind === 'confirm') {
			request.resolve(answer);
		} else if (request.kind === 'prompt') {
			request.resolve(answer ? value.trim() || null : null);
		} else {
			request.resolve();
		}
		shift();
	};

	useEffect(() => {
		// Suppression : focus sur Annuler, une validation au clavier ne détruit rien par mégarde.
		if (request.kind === 'prompt') {
			field.current?.select();
		} else if (!(request.kind === 'confirm' && request.danger)) {
			primary.current?.focus();
		}
	}, [request]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		finish(true);
	};

	const message = request.kind === 'prompt' ? null : request.message;
	return (
		<Dialog open onClose={() => finish(false)} title={request.title}>
			<form className='app-dialog' onSubmit={submit}>
				{message && <p className='app-dialog-message'>{message}</p>}
				{request.kind === 'prompt' && (
					<label className='field'>
						{request.label && <span>{request.label}</span>}
						<input ref={field} value={value} maxLength={request.maxLength ?? 120} placeholder={request.placeholder} onChange={(e) => setValue(e.target.value)} autoFocus />
					</label>
				)}
				<div className='app-dialog-actions'>
					{request.kind !== 'alert' && (
						<button type='button' className='btn' onClick={() => finish(false)} autoFocus={request.kind === 'confirm' && request.danger}>
							{request.kind === 'confirm' ? (request.cancelLabel ?? 'Annuler') : 'Annuler'}
						</button>
					)}
					<button
						ref={primary}
						type='submit'
						className={request.kind === 'confirm' && request.danger ? 'btn btn-danger' : 'btn btn-primary'}
						disabled={request.kind === 'prompt' && !value.trim()}
					>
						{request.kind === 'alert' ? 'OK' : request.kind === 'confirm' ? (request.confirmLabel ?? 'Confirmer') : (request.confirmLabel ?? 'Valider')}
					</button>
				</div>
			</form>
		</Dialog>
	);
}
