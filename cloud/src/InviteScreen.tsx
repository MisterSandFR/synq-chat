import { useEffect, useState } from 'react';

import { api, errorText } from './api';
import { navigate } from './router';
import { Avatar, Logo } from './ui';

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
		<main className='invite'>
			<Logo />
			{error ? (
				<div className='stack invite-card'>
					<p className='notice notice-error'>{error}</p>
					<button type='button' className='button' onClick={() => navigate('/')}>
						Retour à l’accueil
					</button>
				</div>
			) : invite ? (
				<div className='stack invite-card'>
					<Avatar id={invite.workspaceId} name={invite.workspaceName} size={64} />
					<p className='muted'>Tu es invité à rejoindre</p>
					<h1 className='invite-name'>{invite.workspaceName}</h1>
					<button type='button' className='button button-primary' onClick={join} disabled={busy}>
						Rejoindre l’espace
					</button>
				</div>
			) : (
				<div className='splash' aria-busy />
			)}
		</main>
	);
}
