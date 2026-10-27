import { useEffect, useState, type FormEvent } from 'react';

import type { MailboxInfo, MailboxInput, MailTestResult } from '../../shared/mail';
import type { Channel, WorkspaceSummary } from '../../shared/types';
import { api, errorText } from '../api';
import { Dialog, Icon } from '../ui';

export function BoxDialog({ box, workspaces, onClose, onSaved }: { box: MailboxInfo | null; workspaces: WorkspaceSummary[]; onClose: () => void; onSaved: () => Promise<void> }) {
	const owner = !box || box.access.owner;
	const [form, setForm] = useState<MailboxInput>(() => ({
		name: box?.name ?? '',
		address: box?.address ?? '',
		imapHost: box?.config?.imapHost ?? '',
		imapPort: 993,
		smtpHost: box?.config?.smtpHost ?? '',
		smtpPort: box?.config?.smtpPort ?? 465,
		username: box?.config?.username ?? '',
		password: '',
	}));
	const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
	const [busy, setBusy] = useState(false);

	const set = <K extends keyof MailboxInput>(key: K, value: MailboxInput[K]) => setForm((current) => ({ ...current, [key]: value }));
	const payload = () => ({ ...form, password: form.password || undefined, id: box?.id });

	const run = async (task: () => Promise<void>) => {
		setBusy(true);
		setStatus(null);
		try {
			await task();
		} catch (e) {
			setStatus({ tone: 'error', text: errorText(e) });
		} finally {
			setBusy(false);
		}
	};

	const save = (event: FormEvent) => {
		event.preventDefault();
		void run(async () => {
			await api(box ? 'PATCH' : 'POST', box ? `/mail/boxes/${box.id}` : '/mail/boxes', payload());
			await onSaved();
			onClose();
		});
	};

	const test = () =>
		run(async () => {
			const result = await api<MailTestResult>('POST', '/mail/test', payload());
			const failures = [result.imap && `IMAP : ${result.imap}`, result.smtp && `SMTP : ${result.smtp}`].filter(Boolean);
			setStatus(failures.length ? { tone: 'error', text: failures.join(' ; ') } : { tone: 'ok', text: 'Connexion IMAP et SMTP réussie.' });
		});

	const remove = () => {
		if (box && confirm(`Supprimer la boîte « ${box.name} » et ses conversations ?`)) {
			void run(async () => {
				await api('DELETE', `/mail/boxes/${box.id}`);
				await onSaved();
				onClose();
			});
		}
	};

	return (
		<Dialog open onClose={onClose} title={box ? box.name : 'Ajouter une boîte mail'} wide>
			{owner && (
				<form className='mail-form' onSubmit={save}>
					<div className='mail-form-row'>
						<label className='field'>
							<span>Nom</span>
							<input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={64} placeholder='Support' required />
						</label>
						<label className='field'>
							<span>Adresse</span>
							<input type='email' value={form.address} onChange={(e) => set('address', e.target.value)} placeholder='support@exemple.fr' required />
						</label>
					</div>
					<div className='mail-form-row'>
						<label className='field'>
							<span>Serveur IMAP</span>
							<input value={form.imapHost} onChange={(e) => set('imapHost', e.target.value)} placeholder='mail.exemple.fr' required />
						</label>
						<label className='field'>
							<span>Port IMAP</span>
							<select value={993} disabled>
								<option value={993}>993 (TLS)</option>
							</select>
						</label>
					</div>
					<div className='mail-form-row'>
						<label className='field'>
							<span>Serveur SMTP</span>
							<input value={form.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} placeholder='mail.exemple.fr' required />
						</label>
						<label className='field'>
							<span>Port SMTP</span>
							<select value={form.smtpPort} onChange={(e) => set('smtpPort', Number(e.target.value))}>
								<option value={465}>465 (TLS)</option>
								<option value={587}>587 (STARTTLS)</option>
							</select>
						</label>
					</div>
					<div className='mail-form-row'>
						<label className='field'>
							<span>Identifiant</span>
							<input value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete='off' required />
						</label>
						<label className='field'>
							<span>Mot de passe d’application</span>
							<input
								type='password'
								value={form.password ?? ''}
								onChange={(e) => set('password', e.target.value)}
								autoComplete='new-password'
								placeholder={box ? 'Inchangé' : ''}
								required={!box}
							/>
						</label>
					</div>
					<p className='field-hint'>Mot de passe chiffré côté serveur, jamais réaffiché. Relève toutes les minutes.</p>
					{status ? (
						<p className={`notice notice-${status.tone}`}>{status.text}</p>
					) : (
						box?.syncError && <p className='notice notice-error'>Dernière relève : {box.syncError}</p>
					)}
					<div className='mail-form-actions'>
						{box && (
							<button type='button' className='btn btn-danger' disabled={busy} onClick={remove}>
								<Icon name='trash' size={16} />
								Supprimer
							</button>
						)}
						<button type='button' className='btn' disabled={busy} onClick={() => void test()}>
							Tester la connexion
						</button>
						<button className='btn btn-primary' disabled={busy}>
							{box ? 'Enregistrer' : 'Ajouter'}
						</button>
					</div>
				</form>
			)}
			{box && <ShareEditor box={box} workspaces={workspaces} onChanged={onSaved} />}
		</Dialog>
	);
}

function ShareEditor({ box, workspaces, onChanged }: { box: MailboxInfo; workspaces: WorkspaceSummary[]; onChanged: () => Promise<void> }) {
	const [shares, setShares] = useState(box.shares);
	const [workspaceId, setWorkspaceId] = useState('');
	const [channels, setChannels] = useState<Channel[]>([]);
	const [picked, setPicked] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setPicked(shares.find((share) => share.workspaceId === workspaceId)?.channelIds ?? []);
		if (!workspaceId) {
			setChannels([]);
			return;
		}
		let cancelled = false;
		void api<Channel[]>('GET', `/w/${workspaceId}/channels`)
			.then((list) => !cancelled && setChannels(list.filter((channel) => channel.kind !== 'voice')))
			.catch(() => !cancelled && setChannels([]));
		return () => {
			cancelled = true;
		};
	}, [workspaceId, shares]);

	const share = async () => {
		setError(null);
		try {
			const updated = await api<MailboxInfo>('PUT', `/mail/boxes/${box.id}/shares/${workspaceId}`, { channelIds: picked });
			setShares(updated.shares);
			setWorkspaceId('');
			await onChanged();
		} catch (e) {
			setError(errorText(e));
		}
	};

	const unshare = async (wid: string) => {
		setError(null);
		try {
			await api('DELETE', `/mail/boxes/${box.id}/shares/${wid}`);
			setShares((current) => current.filter((item) => item.workspaceId !== wid));
			await onChanged();
		} catch (e) {
			setError(errorText(e));
		}
	};

	const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

	return (
		<section className='mail-share'>
			<h3>Partage</h3>
			<p className='field-hint'>Sans partage, la boîte reste personnelle. Dans un espace, l’accès suit les grades : voir, répondre, gérer.</p>
			{shares.map((item) => (
				<div key={item.workspaceId} className='mail-share-item'>
					<Icon name='users' size={16} />
					<span>
						{item.workspaceName} <small>{item.channelIds.length ? `${item.channelIds.length} salon${item.channelIds.length > 1 ? 's' : ''}` : 'tout l’espace'}</small>
					</span>
					<button className='btn btn-ghost' onClick={() => setWorkspaceId(item.workspaceId)}>
						Salons
					</button>
					<button className='btn btn-ghost' onClick={() => void unshare(item.workspaceId)}>
						Retirer
					</button>
				</div>
			))}
			<select className='mail-select' value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} aria-label='Espace de partage'>
				<option value=''>Choisir un espace…</option>
				{workspaces.map((workspace) => (
					<option key={workspace.id} value={workspace.id}>
						{workspace.name}
					</option>
				))}
			</select>
			{workspaceId && (
				<>
					{channels.length > 0 && (
						<div className='mail-channels'>
							{channels.map((channel) => (
								<label key={channel.id}>
									<input type='checkbox' checked={picked.includes(channel.id)} onChange={() => toggle(channel.id)} />#{channel.name}
								</label>
							))}
						</div>
					)}
					<div className='mail-form-actions'>
						<button className='btn btn-primary' onClick={() => void share()}>
							{shares.some((item) => item.workspaceId === workspaceId) ? 'Mettre à jour' : 'Partager'}
						</button>
					</div>
				</>
			)}
			{error && <p className='notice notice-error'>{error}</p>}
		</section>
	);
}
