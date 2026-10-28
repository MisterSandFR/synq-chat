import { useEffect, useState } from 'react';

import type { InviteJoin, InvitePreview, InviteState } from '../shared/invites';
import { api, errorText } from './api';
import { navigate } from './router';
import { Logo, SpaceLogo } from './ui';

const ENDED: Record<Exclude<InviteState, 'valid'>, string> = {
	expired: 'Ce lien d’invitation a expiré. Demande un nouveau lien à la personne qui te l’a envoyé.',
	revoked: 'Ce lien d’invitation a été révoqué. Demande un nouveau lien à la personne qui te l’a envoyé.',
	exhausted: 'Ce lien d’invitation a atteint son nombre maximal d’utilisations.',
};

const UNTIL = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function InviteScreen({ code, onJoined }: { code: string; onJoined: () => Promise<unknown> }) {
	const [invite, setInvite] = useState<InvitePreview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		api<InvitePreview>('GET', `/invites/${code}`)
			.then(setInvite)
			.catch((err) => setError(errorText(err)));
	}, [code]);

	const join = async () => {
		setBusy(true);
		try {
			const { workspaceId, channelId } = await api<InviteJoin>('POST', `/invites/${code}/accept`);
			await onJoined();
			navigate(channelId ? `/w/${workspaceId}/${channelId}` : `/w/${workspaceId}`, true);
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
						<SpaceLogo name={invite.workspaceName} accent={invite.accent} url={invite.logoUrl} size={64} />
						<p className='muted'>{invite.inviterName ? `${invite.inviterName} t’invite à rejoindre` : 'Tu es invité à rejoindre'}</p>
						<h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>{invite.workspaceName}</h1>
						<p className='muted' style={{ fontSize: 14 }}>
							{invite.memberCount} {invite.memberCount > 1 ? 'membres' : 'membre'}
						</p>
						{invite.state === 'valid' ? (
							<>
								<button type='button' className='btn btn-primary btn-lg btn-block' onClick={join} disabled={busy}>
									{invite.member ? 'Ouvrir l’espace' : 'Rejoindre l’espace'}
								</button>
								{invite.expiresAt !== null && <p className='muted' style={{ fontSize: 14 }}>Lien valable jusqu’au {UNTIL.format(invite.expiresAt)}</p>}
							</>
						) : (
							<>
								<p className='notice notice-error'>{ENDED[invite.state]}</p>
								<button type='button' className='btn btn-block' onClick={() => navigate('/espaces')}>
									Voir mes espaces
								</button>
							</>
						)}
					</>
				) : (
					<div className='spinner' aria-busy />
				)}
			</div>
		</main>
	);
}
