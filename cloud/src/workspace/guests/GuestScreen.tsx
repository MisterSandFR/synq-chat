import { useEffect, useState } from 'react';

import type { GuestJoined, GuestLanding } from '../../../shared/guests';
import { api, errorText } from '../../api';
import { navigate } from '../../router';
import { Logo } from '../../ui';
import './guests.css';

export function GuestScreen({ token, onJoined }: { token: string; onJoined: () => Promise<unknown> }) {
	const [landing, setLanding] = useState<GuestLanding | null>(null);
	const [name, setName] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		api<GuestLanding>('GET', `/guest/${token}`)
			.then(setLanding)
			.catch((err) => setError(errorText(err)));
	}, [token]);

	const join = async () => {
		setBusy(true);
		try {
			const { workspaceId, channelId } = await api<GuestJoined>('POST', `/guest/${token}`, { name });
			await onJoined();
			navigate(`/w/${workspaceId}/${channelId}`, true);
		} catch (err) {
			setError(errorText(err));
			setBusy(false);
		}
	};

	return (
		<main className='center-screen'>
			<Logo />
			<div className='center-card'>
				{error && !landing ? (
					<p className='notice notice-error'>{error}</p>
				) : landing ? (
					<form
						className='guest-landing'
						onSubmit={(e) => {
							e.preventDefault();
							void join();
						}}
					>
						<p className='muted'>
							{landing.inviterName} t’invite dans la conversation
						</p>
						<h1 className='guest-landing-title'>{landing.conversationName}</h1>
						<p className='muted guest-hint'>{landing.workspaceName} · invité externe</p>
						{!landing.joined && (
							<label className='field'>
								<span>Ton nom</span>
								<input autoFocus required maxLength={64} placeholder='Prénom Nom' value={name} onChange={(e) => setName(e.target.value)} />
							</label>
						)}
						{error && <p className='notice notice-error'>{error}</p>}
						<button type='submit' className='btn btn-primary btn-lg btn-block' disabled={busy || (!landing.joined && !name.trim())}>
							Rejoindre la conversation
						</button>
					</form>
				) : (
					<div className='spinner' aria-busy />
				)}
			</div>
		</main>
	);
}
