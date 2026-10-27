import { useEffect, useState } from 'react';

import { DM_MAX_MEMBERS, type DirectConversation } from '../../../shared/dm-threads';
import type { Member } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Avatar, Dialog } from '../../ui';
import { GuestBadge, GuestInvites } from '../guests/GuestInvites';
import './dm-threads.css';

type Props = {
	open: boolean;
	workspaceId: string;
	conversation: DirectConversation;
	members: Map<string, Member>;
	myId: string;
	online: Set<string>;
	onClose: () => void;
	// Null après départ du groupe.
	onChanged: (conversation: DirectConversation | null) => void;
};

export function GroupDialog({ open, workspaceId, conversation, members, myId, online, onClose, onChanged }: Props) {
	const [name, setName] = useState(conversation.name);
	const [adding, setAdding] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setName(conversation.name);
			setAdding([]);
			setError(null);
		}
	}, [open, conversation.name]);

	const base = `/w/${workspaceId}/dms/${conversation.id}`;
	const room = DM_MAX_MEMBERS - conversation.memberIds.length;
	const candidates = [...members.values()].filter((m) => !conversation.memberIds.includes(m.id)).sort((a, b) => a.name.localeCompare(b.name));

	const run = async (action: () => Promise<DirectConversation | null>) => {
		setError(null);
		try {
			onChanged(await action());
		} catch (e) {
			setError(errorText(e));
		}
	};

	return (
		<Dialog open={open} onClose={onClose} title='Participants du groupe'>
			<form
				className='dm-group-name'
				onSubmit={(e) => {
					e.preventDefault();
					void run(() => api<DirectConversation>('PATCH', base, { name }));
				}}
			>
				<label className='field grow'>
					<span>Nom du groupe</span>
					<input maxLength={64} placeholder='Facultatif' value={name} onChange={(e) => setName(e.target.value)} />
				</label>
				<button type='submit' className='btn' disabled={name.trim() === conversation.name}>
					Renommer
				</button>
			</form>
			<h3 className='dm-group-title'>Participants : {conversation.memberIds.length}</h3>
			<ul className='list'>
				{conversation.memberIds.map((id) => {
					const member = members.get(id);
					return (
						<li key={id} className='list-row'>
							<Avatar name={member?.name ?? '?'} url={member?.avatarUrl} size={28} online={online.has(id)} />
							<span className='grow ellipsis'>
								{member?.name ?? 'Ancien membre'}
								{member?.guest && <GuestBadge />}
								{id === myId && <span className='muted'> (toi)</span>}
							</span>
							{id !== myId && (
								<button type='button' className='btn' onClick={() => void run(() => api<DirectConversation>('DELETE', `${base}/members/${id}`))}>
									Retirer
								</button>
							)}
						</li>
					);
				})}
			</ul>
			{!members.get(myId)?.guest && <GuestInvites workspaceId={workspaceId} conversationId={conversation.id} full={room <= 0} />}
			{room > 0 && candidates.length > 0 && (
				<>
					<h3 className='dm-group-title'>Ajouter des participants</h3>
					<ul className='list dm-pick-list'>
						{candidates.map((member) => {
							const checked = adding.includes(member.id);
							return (
								<li key={member.id}>
									<label className='list-row dm-pick'>
										<input
											type='checkbox'
											checked={checked}
											disabled={!checked && adding.length >= room}
											onChange={() => setAdding((current) => (checked ? current.filter((x) => x !== member.id) : [...current, member.id]))}
										/>
										<Avatar name={member.name} url={member.avatarUrl} size={28} online={online.has(member.id)} />
										<span className='grow ellipsis'>{member.name}</span>
									</label>
								</li>
							);
						})}
					</ul>
					<button
						type='button'
						className='btn btn-primary'
						disabled={!adding.length}
						onClick={() =>
							void run(async () => {
								const updated = await api<DirectConversation>('POST', `${base}/members`, { userIds: adding });
								setAdding([]);
								return updated;
							})
						}
					>
						Ajouter au groupe
					</button>
				</>
			)}
			{error && <p className='notice notice-error'>{error}</p>}
			<div className='dm-dialog-actions'>
				<button
					type='button'
					className='btn dm-leave'
					onClick={() => window.confirm('Quitter ce groupe ? Tu n’y auras plus accès.') && void run(() => api<null>('DELETE', `${base}/members/${myId}`))}
				>
					Quitter le groupe
				</button>
			</div>
		</Dialog>
	);
}
