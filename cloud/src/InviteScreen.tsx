import { useEffect, useState } from 'react';

import { api, errorText } from './api';
import { navigate } from './router';
import { Logo } from './ui';

export function InviteScreen({ code, onJoined }: { code: string; onJoined: () => Promise<unknown> }) {
	const [invite, setInvite] = useState<{ workspaceId: string; workspaceName: string } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		api<{ workspaceId: string; workspaceName: string }>('GET', `/invites/${code}`)
			.then(setInvite)
			.catch((err) => setError(errorText(err)));
	}, [code]);

	const join = async () => {
		setBusy(true);
		try {
			const { workspaceId } = await api<{ workspaceId: string }>('POST', `/invites/${code}/accept`);
			await onJoined();
			navigate(`/w/${workspaceId}`, true);
		} catch (err) {
			setError(errorText(err));
			setBusy(false);
		}
	};

	return (
		<main className='center-screen'>
			<Logo />
			<div className='center-card'>
				{error ? (
					<>
						<p className='notice notice-error'>{error}</p>
						<button type='button' className='btn' onClick={() => navigate('/espaces')}>
							Voir mes espaces
						</button>
					</>
				) : invite ? (
					<>
						<span className='avatar avatar-square' style={{ width: 64, height: 64, fontSize: 26, background: 'var(--text)', color: 'var(--bg)' }}>
							{invite.workspaceName.charAt(0).toUpperCase()}
						</span>
						<p className='muted'>Tu es invité à rejoindre</p>
						<h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>{invite.workspaceName}</h1>
						<button type='button' className='btn btn-primary btn-lg btn-block' onClick={join} disabled={busy}>
							Rejoindre l’espace
						</button>
					</>
				) : (
					<div className='spinner' aria-busy />
				)}
			</div>
		</main>
	);
}
