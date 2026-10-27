import { useEffect, useState, type FormEvent } from 'react';

import { DM_MAX_MEMBERS } from '../../../shared/dm-threads';
import type { Member } from '../../../shared/types';
import { errorText } from '../../api';
import { Avatar, Dialog, Icon } from '../../ui';
import './dm-threads.css';

type Props = {
	open: boolean;
	members: Map<string, Member>;
	myId: string;
	online: Set<string>;
	onClose: () => void;
	onSubmit: (userIds: string[], name: string) => Promise<void>;
};

const MAX = DM_MAX_MEMBERS - 1;

export function NewDirectDialog({ open, members, myId, online, onClose, onSubmit }: Props) {
	const [query, setQuery] = useState('');
	const [name, setName] = useState('');
	const [picked, setPicked] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setQuery('');
			setName('');
			setPicked([]);
			setError(null);
		}
	}, [open]);

	const needle = query.trim().toLowerCase();
	const candidates = [...members.values()].filter((m) => m.id !== myId && m.name.toLowerCase().includes(needle)).sort((a, b) => a.name.localeCompare(b.name));

	const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length < MAX ? [...current, id] : current));

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!picked.length || busy) {
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await onSubmit(picked, picked.length > 1 ? name.trim() : '');
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onClose={onClose} title='Nouveau message'>
			<form onSubmit={submit}>
				<label className='field'>
					<span>Destinataires</span>
					<input autoFocus type='search' placeholder='Rechercher un membre' value={query} onChange={(e) => setQuery(e.target.value)} />
				</label>
				{picked.length > 0 && (
					<div className='dm-chips'>
						{picked.map((id) => (
							<button key={id} type='button' className='dm-chip' aria-label={`Retirer ${members.get(id)?.name ?? 'ce membre'}`} onClick={() => toggle(id)}>
								{members.get(id)?.name ?? 'Membre'}
								<Icon name='close' size={12} />
							</button>
						))}
					</div>
				)}
				<ul className='list dm-pick-list'>
					{candidates.map((member) => {
						const checked = picked.includes(member.id);
						return (
							<li key={member.id}>
								<label className='list-row dm-pick'>
									<input type='checkbox' checked={checked} disabled={!checked && picked.length >= MAX} onChange={() => toggle(member.id)} />
									<Avatar name={member.name} url={member.avatarUrl} size={28} online={online.has(member.id)} />
									<span className='grow ellipsis'>{member.name}</span>
								</label>
							</li>
						);
					})}
					{candidates.length === 0 && <li className='muted dm-pick-empty'>Aucun membre trouvé.</li>}
				</ul>
				{picked.length > 1 && (
					<label className='field'>
						<span>Nom du groupe</span>
						<input maxLength={64} placeholder='Facultatif' value={name} onChange={(e) => setName(e.target.value)} />
					</label>
				)}
				<p className='field-hint'>{picked.length > 1 ? 'Conversation de groupe' : 'Conversation privée'}, {MAX} personnes maximum.</p>
				{error && <p className='notice notice-error'>{error}</p>}
				<div className='dm-dialog-actions'>
					<button type='button' className='btn' onClick={onClose}>
						Annuler
					</button>
					<button type='submit' className='btn btn-primary' disabled={!picked.length || busy}>
						Ouvrir la conversation
					</button>
				</div>
			</form>
		</Dialog>
	);
}
