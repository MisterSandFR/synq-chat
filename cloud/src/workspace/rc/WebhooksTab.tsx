import { useEffect, useState, type FormEvent } from 'react';

import type { Webhook, WebhookWithUrl } from '../../../shared/rc';
import type { Channel } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Icon } from '../../ui';
import './rc.css';

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function WebhooksTab({ workspaceId }: { workspaceId: string }) {
	const [channels, setChannels] = useState<Channel[]>([]);
	const [channelId, setChannelId] = useState('');
	const [hooks, setHooks] = useState<Webhook[]>([]);
	const [name, setName] = useState('');
	const [fresh, setFresh] = useState<WebhookWithUrl | null>(null);
	const [error, setError] = useState('');

	useEffect(() => {
		void api<Channel[]>('GET', `/w/${workspaceId}/channels`)
			.then((list) => {
				const rooms = list.filter((c) => c.kind !== 'dm');
				setChannels(rooms);
				setChannelId((current) => current || rooms[0]?.id || '');
			})
			.catch((e) => setError(errorText(e)));
	}, [workspaceId]);

	useEffect(() => {
		setFresh(null);
		if (channelId) {
			void api<Webhook[]>('GET', `/w/${workspaceId}/channels/${channelId}/webhooks`)
				.then(setHooks)
				.catch((e) => setError(errorText(e)));
		}
	}, [workspaceId, channelId]);

	const run = async (action: () => Promise<void>) => {
		setError('');
		try {
			await action();
		} catch (e) {
			setError(errorText(e));
		}
	};

	const create = (event: FormEvent) => {
		event.preventDefault();
		void run(async () => {
			const hook = await api<WebhookWithUrl>('POST', `/w/${workspaceId}/channels/${channelId}/webhooks`, { name });
			setHooks((list) => [...list, hook]);
			setFresh(hook);
			setName('');
		});
	};

	return (
		<div className='webhooks'>
			<p className='muted'>Une URL secrète par webhook. Un POST JSON {'{ "text": "…", "username": "…" }'} publie un message d’app dans le salon.</p>
			<label className='field'>
				<span>Salon</span>
				<select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
					{channels.map((c) => (
						<option key={c.id} value={c.id}>
							{c.kind === 'text' ? '#' : ''}
							{c.name}
						</option>
					))}
				</select>
			</label>
			{fresh && (
				<div className='notice webhook-url'>
					<span>URL de « {fresh.name} », affichée une seule fois :</span>
					<code className='ellipsis'>{fresh.url}</code>
					<button type='button' className='btn btn-sm' onClick={() => void navigator.clipboard.writeText(fresh.url).catch(() => undefined)}>
						<Icon name='copy' size={14} /> Copier
					</button>
				</div>
			)}
			<ul className='list'>
				{hooks.map((hook) => (
					<li key={hook.id} className='directory-item'>
						<Icon name='link' size={16} />
						<span className='directory-main'>
							<strong className='ellipsis'>{hook.name}</strong>
							<span className='muted'>{hook.lastUsedAt ? `Utilisé le ${when.format(hook.lastUsedAt)}` : 'Jamais utilisé'}</span>
						</span>
						<button
							type='button'
							className='btn btn-sm'
							title='Invalide l’ancienne URL'
							onClick={() => void run(async () => setFresh(await api<WebhookWithUrl>('POST', `/w/${workspaceId}/webhooks/${hook.id}/rotate`)))}
						>
							Régénérer l’URL
						</button>
						<button
							type='button'
							className='icon-btn icon-btn-sm'
							aria-label={`Supprimer ${hook.name}`}
							title='Supprimer'
							onClick={() =>
								void run(async () => {
									await api('DELETE', `/w/${workspaceId}/webhooks/${hook.id}`);
									setHooks((list) => list.filter((h) => h.id !== hook.id));
									setFresh((f) => (f?.id === hook.id ? null : f));
								})
							}
						>
							<Icon name='trash' size={14} />
						</button>
					</li>
				))}
				{hooks.length === 0 && <li className='muted rc-empty'>Aucun webhook dans ce salon.</li>}
			</ul>
			<form className='webhook-new' onSubmit={create}>
				<input value={name} maxLength={32} placeholder='Nom du webhook, ex. CI' onChange={(e) => setName(e.target.value)} aria-label='Nom du webhook' />
				<button type='submit' className='btn btn-primary' disabled={!name.trim() || !channelId}>
					Créer
				</button>
			</form>
			{error && <p className='notice notice-error'>{error}</p>}
		</div>
	);
}
