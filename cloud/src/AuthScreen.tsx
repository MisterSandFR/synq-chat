import { useEffect, useState, type FormEvent } from 'react';

import type { Notice } from './App';
import { api, errorText } from './api';
import { rememberReturn } from './router';
import { Logo } from './ui';

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
		const form = new FormData(event.currentTarget);
		setBusy(true);
		setError(null);
		try {
			await api('POST', `/auth/${mode}`, Object.fromEntries(form));
			await onSignedIn();
		} catch (err) {
			setError(errorText(err));
			setBusy(false);
		}
	};

	const startRecube = () => {
		rememberReturn();
		window.location.href = '/api/auth/recube/start';
	};

	return (
		<main className='auth'>
			<section className='auth-panel'>
				<Logo height={36} />
				<h1 className='auth-title'>{mode === 'login' ? 'Content de te revoir.' : 'Crée ton compte.'}</h1>
				<p className='auth-lead'>La messagerie d’équipe qui reste chez toi.</p>

				{notice && <p className={`notice notice-${notice.tone}`}>{notice.text}</p>}

				{recube && (
					<>
						<button type='button' className='button button-recube' onClick={startRecube}>
							<img src='https://recube.gg/favicon.svg' alt='' width={20} height={20} />
							Se connecter avec Recube
						</button>
						<div className='auth-or'>
							<span>ou avec ton email</span>
						</div>
					</>
				)}

				<form className='stack' onSubmit={submit}>
					{mode === 'signup' && (
						<label className='field'>
							<span>Nom affiché</span>
							<input name='name' required maxLength={64} autoComplete='nickname' />
						</label>
					)}
					<label className='field'>
						<span>Email</span>
						<input name='email' type='email' required autoComplete='email' />
					</label>
					<label className='field'>
						<span>Mot de passe</span>
						<input name='password' type='password' required minLength={mode === 'signup' ? 8 : undefined} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
					</label>
					{error && (
						<p className='notice notice-error' role='alert'>
							{error}
						</p>
					)}
					<button className='button button-primary' disabled={busy}>
						{mode === 'login' ? 'Se connecter' : 'Créer le compte'}
					</button>
				</form>

				<p className='auth-switch'>
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
			</section>
			<SyncField />
		</main>
	);
}

// Deux ondes qui se recalent : le seul moment animé de l'app.
function SyncField() {
	const rows = Array.from({ length: 9 }, (_, i) => i);
	return (
		<div className='sync-field' aria-hidden>
			<svg viewBox='0 0 600 600' preserveAspectRatio='xMidYMid slice'>
				{rows.map((i) => (
					<path
						key={i}
						className={i % 2 ? 'wave wave-live' : 'wave wave-signal'}
						style={{ animationDelay: `${i * -0.7}s` }}
						d={`M-50 ${80 + i * 55} C 100 ${40 + i * 55}, 200 ${120 + i * 55}, 300 ${80 + i * 55} S 500 ${40 + i * 55}, 650 ${80 + i * 55}`}
					/>
				))}
			</svg>
		</div>
	);
}
