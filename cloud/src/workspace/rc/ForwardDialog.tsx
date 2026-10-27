import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type { Channel, Message } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Dialog, Icon } from '../../ui';
import { excerpt, type Lookup } from '../richText';
import './rc.css';

type Props = {
	workspaceId: string;
	message: Message | null;
	targets: Channel[];
	lookup: Lookup;
	onClose: () => void;
	onSent: (message: Message) => void;
};

export const roomLabel = (channel: Channel) => (channel.kind === 'dm' ? channel.name || 'Message direct' : `${channel.kind === 'text' ? '#' : ''}${channel.name}`);

export function ForwardDialog({ workspaceId, message, targets, lookup, onClose, onSent }: Props) {
	const [query, setQuery] = useState('');
	const [target, setTarget] = useState<string | null>(null);
	const [comment, setComment] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		setQuery('');
		setTarget(null);
		setComment('');
		setError('');
	}, [message?.id]);

	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		return targets.filter((c) => !q || roomLabel(c).toLowerCase().includes(q)).slice(0, 50);
	}, [targets, query]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!message || !target) {
			return;
		}
		setBusy(true);
		setError('');
		try {
			onSent(await api<Message>('POST', `/w/${workspaceId}/messages/${message.id}/forward`, { channelId: target, comment }));
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={message !== null} onClose={onClose} title='Transférer le message'>
			{message && (
				<form className='forward-form' onSubmit={(e) => void submit(e)}>
					<blockquote className='forward-card'>
						<span className='forward-meta'>
							<strong>{lookup.members.get(message.userId)?.name ?? 'Ancien membre'}</strong>
						</span>
						<span className='forward-text'>{excerpt(message.forward?.body ?? message.body, lookup, 200) || 'Fichier joint'}</span>
					</blockquote>
					<label className='field'>
						<span>Destination</span>
						<input type='search' value={query} placeholder='Chercher un salon ou une conversation' onChange={(e) => setQuery(e.target.value)} autoFocus />
					</label>
					<ul className='list forward-targets' role='listbox' aria-label='Destinations'>
						{shown.map((c) => (
							<li key={c.id}>
								<button type='button' role='option' aria-selected={target === c.id} className='menu-item' onClick={() => setTarget(c.id)}>
									<Icon name={c.kind === 'dm' ? 'chat' : c.kind === 'voice' ? 'speaker' : 'hash'} size={16} />
									<span className='ellipsis'>{roomLabel(c)}</span>
									{target === c.id && <Icon name='check' size={16} />}
								</button>
							</li>
						))}
						{shown.length === 0 && <li className='muted rc-empty'>Aucune destination.</li>}
					</ul>
					<label className='field'>
						<span>Message (facultatif)</span>
						<textarea rows={2} value={comment} maxLength={4000} onChange={(e) => setComment(e.target.value)} />
					</label>
					{error && <p className='notice notice-error'>{error}</p>}
					<div className='dialog-actions'>
						<button type='button' className='btn' onClick={onClose}>
							Annuler
						</button>
						<button type='submit' className='btn btn-primary' disabled={!target || busy}>
							Transférer
						</button>
					</div>
				</form>
			)}
		</Dialog>
	);
}

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Aperçu figé à l'envoi : lisible même sans accès au salon d'origine.
export function ForwardCard({ workspaceId, message, lookup }: { workspaceId: string; message: Message; lookup: Lookup }) {
	const ref = message.forward!;
	const channel = lookup.channels.find((c) => c.id === ref.channelId);
	return (
		<blockquote className='forward-card'>
			<span className='forward-meta'>
				<Icon name='arrow' size={14} />
				<span>Transféré de</span>
				<strong>{lookup.members.get(ref.userId)?.name ?? 'Ancien membre'}</strong>
				<span className='muted ellipsis'>
					{channel ? `${roomLabel(channel)} · ` : ''}
					{when.format(ref.createdAt)}
				</span>
			</span>
			<span className='forward-text'>{excerpt(ref.body, lookup, 500) || (ref.files ? 'Fichier joint' : '')}</span>
			{channel && (
				<a className='forward-link' href={`/w/${workspaceId}/${ref.channelId}?m=${ref.id}`}>
					Voir l’original
				</a>
			)}
		</blockquote>
	);
}
