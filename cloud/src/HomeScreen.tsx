import { useState, type FormEvent } from 'react';

import type { Me } from '../shared/types';
import type { Notice } from './App';
import { api, errorText } from './api';
import { navigate, rememberReturn } from './router';
import { Avatar, Icon, Logo } from './ui';

const ROLE_LABEL = { owner: 'Propriétaire', admin: 'Admin', member: 'Membre' } as const;

export function HomeScreen({ me, notice, onNotice, onChanged }: { me: Me; notice: Notice; onNotice: (n: Notice) => void; onChanged: () => Promise<unknown> }) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const create = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const name = String(new FormData(event.currentTarget).get('name') ?? '');
		setBusy(true);
		setError(null);
		try {
			const created = await api<{ id: string }>('POST', '/workspaces', { name });
			await onChanged();
			navigate(`/w/${created.id}`);
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(false);
		}
	};

	const rename = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		try {
			await api('PATCH', '/me', { name: new FormData(event.currentTarget).get('name') });
			await onChanged();
			onNotice({ tone: 'ok', text: 'Nom mis à jour.' });
		} catch (err) {
			onNotice({ tone: 'error', text: errorText(err) });
		}
	};

	const unlink = async () => {
		try {
			await api('DELETE', '/me/identities/recube');
			await onChanged();
			onNotice({ tone: 'ok', text: 'Compte Recube délié.' });
		} catch (err) {
			onNotice({ tone: 'error', text: errorText(err) });
		}
	};

	const logout = async () => {
		await api('POST', '/auth/logout');
		window.location.href = '/';
	};

	const linkedRecube = me.identities.includes('recube');

	return (
		<main className='home'>
			<header className='home-head'>
				<Logo />
				<button type='button' className='button button-quiet' onClick={logout}>
					<Icon name='logout' /> Se déconnecter
				</button>
			</header>

			{notice && <p className={`notice notice-${notice.tone}`}>{notice.text}</p>}

			<section className='home-grid'>
				<div className='stack'>
					<h1 className='home-title'>Tes espaces</h1>
					{me.workspaces.length === 0 ? (
						<p className='muted'>Aucun espace pour l’instant. Crée le tien ou ouvre un lien d’invitation.</p>
					) : (
						<ul className='workspace-list'>
							{me.workspaces.map((w) => (
								<li key={w.id}>
									<a
										href={`/w/${w.id}`}
										onClick={(e) => {
											e.preventDefault();
											navigate(`/w/${w.id}`);
										}}
									>
										<Avatar id={w.id} name={w.name} size={40} />
										<span className='workspace-name'>{w.name}</span>
										<span className='muted'>{ROLE_LABEL[w.role]}</span>
									</a>
								</li>
							))}
						</ul>
					)}
					<form className='inline-form' onSubmit={create}>
						<input name='name' placeholder='Nom du nouvel espace' required maxLength={64} aria-label='Nom du nouvel espace' />
						<button className='button button-primary' disabled={busy}>
							Créer l’espace
						</button>
					</form>
					{error && <p className='notice notice-error'>{error}</p>}
				</div>

				<aside className='profile-card stack'>
					<div className='profile-id'>
						<Avatar id={me.user.id} name={me.user.name} url={me.user.avatarUrl} size={48} />
						<div>
							<strong>{me.user.name}</strong>
							{!me.user.email.endsWith('@recube.invalid') && <div className='muted'>{me.user.email}</div>}
						</div>
					</div>
					<form className='inline-form' onSubmit={rename}>
						<input name='name' defaultValue={me.user.name} required maxLength={64} aria-label='Nom affiché' />
						<button className='button'>Renommer</button>
					</form>
					<div className='profile-recube'>
						{linkedRecube ? (
							<>
								<span>Compte Recube lié</span>
								{me.hasPassword && (
									<button type='button' className='link' onClick={unlink}>
										Délier
									</button>
								)}
							</>
						) : (
							<button
								type='button'
								className='button button-recube'
								onClick={() => {
									rememberReturn();
									window.location.href = '/api/auth/recube/start?link=1';
								}}
							>
								<img src='https://recube.gg/favicon.svg' alt='' width={18} height={18} />
								Lier mon compte Recube
							</button>
						)}
					</div>
				</aside>
			</section>
		</main>
	);
}
