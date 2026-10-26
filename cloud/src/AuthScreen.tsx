import { useEffect, useState, type FormEvent } from 'react';

import type { Notice } from './App';
import { api, errorText } from './api';
import { rememberReturn } from './router';
import { Avatar, Icon, Logo } from './ui';

export function AuthScreen({ notice, onSignedIn }: { notice: Notice; onSignedIn: () => Promise<unknown> }) {
	const [mode, setMode] = useState<'login' | 'signup'>('login');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [recube, setRecube] = useState(false);

	useEffect(() => {
		void api<{ recube: boolean }>('GET', '/auth/providers')
			.then((providers) => setRecube(providers.recube))
			.catch(() => setRecube(false));
	}, []);

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await api('POST', `/auth/${mode}`, Object.fromEntries(new FormData(event.currentTarget)));
			await onSignedIn();
		} catch (err) {
			setError(errorText(err));
			setBusy(false);
		}
	};

	return (
		<main className='auth'>
			<section className='auth-form-side'>
				<Logo height={30} />
				<div className='auth-main'>
					<div className='stack' style={{ gap: 8 }}>
						<h1>{mode === 'login' ? 'Connexion' : 'Créer un compte'}</h1>
						<p className='muted'>{mode === 'login' ? 'Retrouve tes espaces et tes salons.' : 'Quelques secondes et tu rejoins ton équipe.'}</p>
					</div>

					{notice && <p className={`notice notice-${notice.tone}`}>{notice.text}</p>}

					{recube && (
						<>
							<button
								type='button'
								className='btn btn-primary btn-lg btn-block'
								onClick={() => {
									rememberReturn();
									window.location.href = '/api/auth/recube/start';
								}}
							>
								<Icon name='login' />
								Se connecter avec Recube
							</button>
							<div className='auth-or'>ou par email</div>
						</>
					)}

					<form className='stack' onSubmit={submit}>
						{mode === 'signup' && (
							<label className='field'>
								Nom affiché
								<input name='name' required maxLength={64} autoComplete='nickname' style={{ height: 44 }} />
							</label>
						)}
						<label className='field'>
							Email
							<input name='email' type='email' required autoComplete='email' style={{ height: 44 }} />
						</label>
						<label className='field'>
							Mot de passe
							<input
								name='password'
								type='password'
								required
								minLength={mode === 'signup' ? 8 : undefined}
								autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
								style={{ height: 44 }}
							/>
						</label>
						{error && (
							<p className='notice notice-error' role='alert'>
								{error}
							</p>
						)}
						<button className='btn btn-dark btn-lg' disabled={busy}>
							{mode === 'login' ? 'Se connecter' : 'Créer le compte'}
						</button>
					</form>

					<p className='muted' style={{ fontSize: 14 }}>
						{mode === 'login' ? 'Pas encore de compte ?' : 'Déjà inscrit ?'}{' '}
						<button
							type='button'
							className='link'
							onClick={() => {
								setMode(mode === 'login' ? 'signup' : 'login');
								setError(null);
							}}
						>
							{mode === 'login' ? 'Créer un compte' : 'Se connecter'}
						</button>
					</p>
				</div>
			</section>
			<Peek />
		</main>
	);
}

const PEEK = [
	{ name: 'Hugo Martin', time: '21:04', text: 'Mise en prod de la 2.4 terminée.' },
	{ name: 'Sarah Benali', time: '21:06', text: 'Le support a la FAQ à jour, on peut annoncer.' },
	{ name: 'Malik Kaci', time: '21:09', text: 'File d’attente stable, rien à signaler.', admin: true },
];

// Aperçu figé d'un salon : montre le produit plutôt qu'une illustration.
function Peek() {
	return (
		<section className='auth-peek' aria-hidden>
			<div className='auth-peek-window'>
				<div className='auth-peek-head'>
					<Icon name='hash' />
					launcher
					<span className='grow' />
					<span className='row muted' style={{ fontSize: 13, fontWeight: 400, gap: 6 }}>
						<span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }} />8 en ligne
					</span>
				</div>
				<div className='auth-peek-body'>
					{PEEK.map((m) => (
						<div key={m.name} className='row' style={{ alignItems: 'flex-start', gap: 14 }}>
							<Avatar name={m.name} size={36} />
							<div>
								<div className='msg-head'>
									<span className='msg-author'>{m.name}</span>
									{m.admin && <span className='tag'>Admin</span>}
									<time>{m.time}</time>
								</div>
								<p>{m.text}</p>
							</div>
						</div>
					))}
					<div className='typing' style={{ padding: '0 0 0 50px' }}>
						<span className='typing-dots'>
							<span />
							<span />
							<span />
						</span>
						Inès écrit
					</div>
				</div>
			</div>
		</section>
	);
}
