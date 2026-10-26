import { useState, type FormEvent } from 'react';

import { ACCENTS, type Me } from '../shared/types';
import type { Notice } from './App';
import { api, errorText } from './api';
import { navigate, rememberReturn } from './router';
import { Avatar, Icon, Logo } from './ui';

type Props = { me: Me; notice: Notice; onNotice: (n: Notice) => void; onChanged: () => Promise<unknown> };

export function HomeScreen({ me, notice, onNotice, onChanged }: Props) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [accent, setAccent] = useState<string>(ACCENTS[0]);

	const create = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const name = String(new FormData(event.currentTarget).get('name') ?? '');
		setBusy(true);
		setError(null);
		try {
			const created = await api<{ id: string }>('POST', '/workspaces', { name, accent });
			await onChanged();
			navigate(`/w/${created.id}`);
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(false);
		}
	};

	const act = async (task: () => Promise<unknown>, ok: string) => {
		try {
			await task();
			await onChanged();
			onNotice({ tone: 'ok', text: ok });
		} catch (err) {
			onNotice({ tone: 'error', text: errorText(err) });
		}
	};

	const linkedRecube = me.identities.includes('recube');
	const realEmail = !me.user.email.endsWith('@recube.invalid');

	return (
		<main className='page'>
			<header className='page-head'>
				<Logo />
				<button
					type='button'
					className='btn btn-ghost'
					onClick={async () => {
						await api('POST', '/auth/logout');
						window.location.href = '/';
					}}
				>
					<Icon name='logout' /> Se déconnecter
				</button>
			</header>

			{notice && <p className={`notice notice-${notice.tone}`}>{notice.text}</p>}

			<section className='home-grid'>
				<div className='stack' style={{ gap: 20 }}>
					<h1 className='page-title'>Tes espaces</h1>
					{me.workspaces.length === 0 ? (
						<p className='muted'>Aucun espace pour l’instant. Crée le tien ou ouvre un lien d’invitation reçu d’un admin.</p>
					) : (
						<ul className='space-list'>
							{me.workspaces.map((w) => (
								<li key={w.id}>
									<a
										className='space-card'
										href={`/w/${w.id}`}
										onClick={(e) => {
											e.preventDefault();
											navigate(`/w/${w.id}`);
										}}
									>
										<span className='avatar avatar-square' style={{ width: 42, height: 42, fontSize: 16, background: w.accent, color: '#fff' }}>
											{w.name.charAt(0).toUpperCase()}
										</span>
										<span className='grow'>
											<span className='ellipsis' style={{ display: 'block', fontWeight: 600 }}>
												{w.name}
											</span>
											<span className='muted' style={{ fontSize: 13 }}>
												{w.owner ? 'Propriétaire' : 'Membre'}
											</span>
										</span>
										<Icon name='chevron-right' />
									</a>
								</li>
							))}
						</ul>
					)}

					<form className='panel stack' onSubmit={create}>
						<h2>Créer un espace</h2>
						<label className='field'>
							Nom
							<input name='name' placeholder='Équipe support' required maxLength={64} />
						</label>
						<div className='field'>
							Couleur
							<div className='swatches'>
								{ACCENTS.map((color) => (
									<button key={color} type='button' className='swatch' style={{ background: color }} aria-label={`Couleur ${color}`} aria-pressed={accent === color} onClick={() => setAccent(color)} />
								))}
							</div>
						</div>
						{error && <p className='notice notice-error'>{error}</p>}
						<button className='btn btn-primary' style={{ alignSelf: 'flex-start', background: accent }} disabled={busy}>
							Créer l’espace
						</button>
					</form>
				</div>

				<aside className='panel stack' style={{ gap: 18 }}>
					<div className='row' style={{ gap: 12 }}>
						<Avatar name={me.user.name} url={me.user.avatarUrl} size={48} />
						<div style={{ minWidth: 0 }}>
							<strong className='ellipsis' style={{ display: 'block' }}>
								{me.user.name}
							</strong>
							{realEmail && <span className='muted ellipsis' style={{ display: 'block', fontSize: 14 }}>{me.user.email}</span>}
						</div>
					</div>
					<form
						className='field'
						onSubmit={(e) => {
							e.preventDefault();
							const name = new FormData(e.currentTarget).get('name');
							void act(() => api('PATCH', '/me', { name }), 'Nom mis à jour.');
						}}
					>
						Nom affiché
						<div className='inline-form'>
							<input name='name' defaultValue={me.user.name} required maxLength={64} />
							<button className='btn'>Enregistrer</button>
						</div>
					</form>
					<div className='field'>
						Compte Recube
						{linkedRecube ? (
							<div className='row'>
								<span className='grow row' style={{ fontWeight: 400 }}>
									<Icon name='check' size={16} /> Lié
								</span>
								{me.hasPassword && (
									<button type='button' className='link' onClick={() => void act(() => api('DELETE', '/me/identities/recube'), 'Compte Recube délié.')}>
										Délier
									</button>
								)}
							</div>
						) : (
							<button
								type='button'
								className='btn'
								onClick={() => {
									rememberReturn();
									window.location.href = '/api/auth/recube/start?link=1';
								}}
							>
								<Icon name='link' size={16} /> Lier mon compte Recube
							</button>
						)}
					</div>
				</aside>
			</section>
		</main>
	);
}
