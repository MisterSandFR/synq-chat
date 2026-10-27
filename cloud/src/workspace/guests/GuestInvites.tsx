import { useCallback, useEffect, useState } from 'react';

import type { GuestInvite, GuestInviteCreated, GuestInviteList } from '../../../shared/guests';
import { api, errorText } from '../../api';
import './guests.css';

export function GuestBadge() {
	return <span className='guest-badge'>Invité</span>;
}

const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

type Props = { workspaceId: string; conversationId: string; full: boolean };

export function GuestInvites({ workspaceId, conversationId, full }: Props) {
	const base = `/w/${workspaceId}/dms/${conversationId}/guests`;
	const [list, setList] = useState<GuestInviteList | null>(null);
	const [email, setEmail] = useState('');
	const [send, setSend] = useState(true);
	const [created, setCreated] = useState<GuestInviteCreated | null>(null);
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(() => api<GuestInviteList>('GET', base).then(setList, (e) => setError(errorText(e))), [base]);

	useEffect(() => {
		void load();
	}, [load]);

	const create = async () => {
		setBusy(true);
		setError(null);
		try {
			const next = await api<GuestInviteCreated>('POST', base, { email, send: Boolean(list?.canEmail && send) });
			setCreated(next);
			setCopied(false);
			setEmail('');
			await load();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	const copy = async (link: string) => {
		try {
			await navigator.clipboard.writeText(link);
			setCopied(true);
		} catch {
			setError('Copie impossible : sélectionne le lien');
		}
	};

	const revoke = (invite: GuestInvite) =>
		void api('DELETE', `${base}/${invite.id}`)
			.then(load)
			.catch((e) => setError(errorText(e)));

	const pending = list?.invites.filter((invite) => invite.status === 'pending') ?? [];

	return (
		<section className='guest-invites'>
			<h3 className='dm-group-title'>Inviter une personne externe</h3>
			<p className='muted guest-hint'>Elle ne verra que ce groupe : ses participants, ses fichiers et ses appels.</p>
			<form
				className='guest-form'
				onSubmit={(e) => {
					e.preventDefault();
					void create();
				}}
			>
				<label className='field grow'>
					<span>Adresse email</span>
					<input type='email' required maxLength={254} placeholder='prenom@entreprise.fr' value={email} onChange={(e) => setEmail(e.target.value)} />
				</label>
				<button type='submit' className='btn btn-primary' disabled={busy || full || !email.trim()}>
					Créer le lien
				</button>
			</form>
			{list?.canEmail && (
				<label className='guest-send'>
					<input type='checkbox' checked={send} onChange={(e) => setSend(e.target.checked)} />
					Envoyer le lien depuis ma boîte mail
				</label>
			)}
			{full && <p className='muted guest-hint'>Groupe complet.</p>}
			{created && (
				<>
					<div className='guest-link'>
						<input readOnly value={created.link} aria-label='Lien d’invitation' onFocus={(e) => e.currentTarget.select()} />
						<button type='button' className='btn' onClick={() => void copy(created.link)}>
							{copied ? 'Copié' : 'Copier le lien'}
						</button>
					</div>
					<p className='muted guest-hint'>
						{created.emailed ? `Lien envoyé à ${created.invite.email}. ` : created.mailError ? `${created.mailError}. ` : ''}
						Copie-le maintenant : il ne sera plus affiché.
					</p>
				</>
			)}
			{pending.length > 0 && (
				<ul className='list'>
					{pending.map((invite) => (
						<li key={invite.id} className='list-row'>
							<span className='grow ellipsis'>{invite.email}</span>
							<span className='muted guest-expiry'>Expire le {day.format(invite.expiresAt)}</span>
							<button type='button' className='btn' onClick={() => revoke(invite)}>
								Révoquer
							</button>
						</li>
					))}
				</ul>
			)}
			{error && <p className='notice notice-error'>{error}</p>}
		</section>
	);
}
