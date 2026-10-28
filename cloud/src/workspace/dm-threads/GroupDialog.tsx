import { useEffect, useState } from 'react';

import { DM_MAX_MEMBERS, type DirectConversation } from '../../../shared/dm-threads';
import type { Grade, Member } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Avatar, Dialog, Icon } from '../../ui';
import { GradeDot, PeoplePicker, gradeLabel, holdsGrade } from '../grade-access/PeoplePicker';
import { GuestBadge, GuestInvites } from '../guests/GuestInvites';
import './dm-threads.css';

type Props = {
	open: boolean;
	workspaceId: string;
	conversation: DirectConversation;
	members: Map<string, Member>;
	grades: Grade[];
	myId: string;
	online: Set<string>;
	onClose: () => void;
	// Null après départ du groupe.
	onChanged: (conversation: DirectConversation | null) => void;
};

export function GroupDialog({ open, workspaceId, conversation, members, grades, myId, online, onClose, onChanged }: Props) {
	const [name, setName] = useState(conversation.name);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setName(conversation.name);
			setError(null);
		}
	}, [open, conversation.name]);

	const base = `/w/${workspaceId}/dms/${conversation.id}`;
	const guest = members.get(myId)?.guest === true;
	const full = conversation.addedIds.length >= DM_MAX_MEMBERS;
	const viaGrades = (id: string) =>
		conversation.gradeIds
			.filter((gradeId) => holdsGrade(members.get(id), gradeId))
			.map((gradeId) => gradeLabel(grades.find((g) => g.id === gradeId)))
			.join(', ');

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
			{!guest && (
				<div className='field'>
					<span>Ajouter des personnes</span>
					<PeoplePicker
						grades={grades}
						members={[...members.values()].filter((m) => !m.guest && !conversation.memberIds.includes(m.id))}
						everyone={[...members.values()]}
						online={online}
						pickedGrades={conversation.gradeIds}
						pickedMembers={conversation.memberIds}
						membersFull={full}
						onGrade={(id) => void run(() => api<DirectConversation>('POST', `${base}/grades`, { gradeIds: [id] }))}
						onMember={(id) => void run(() => api<DirectConversation>('POST', `${base}/members`, { userIds: [id] }))}
					/>
				</div>
			)}
			{conversation.gradeIds.length > 0 && (
				<>
					<h3 className='dm-group-title'>Grades liés</h3>
					<div className='dm-chips'>
						{conversation.gradeIds.map((id) => {
							const grade = grades.find((g) => g.id === id);
							return guest ? (
								<span key={id} className='dm-chip'>
									<GradeDot grade={grade} />
									{gradeLabel(grade)}
								</span>
							) : (
								<button key={id} type='button' className='dm-chip' aria-label={`Retirer le grade ${gradeLabel(grade)}`} onClick={() => void run(() => api<DirectConversation>('DELETE', `${base}/grades/${id}`))}>
									<GradeDot grade={grade} />
									{gradeLabel(grade)}
									<Icon name='close' size={12} />
								</button>
							);
						})}
					</div>
				</>
			)}
			<h3 className='dm-group-title'>Participants : {conversation.memberIds.length}</h3>
			<ul className='list'>
				{conversation.memberIds.map((id) => {
					const member = members.get(id);
					const added = conversation.addedIds.includes(id);
					return (
						<li key={id} className='list-row'>
							<Avatar name={member?.name ?? '?'} url={member?.avatarUrl} size={28} online={online.has(id)} />
							<span className='grow ellipsis'>
								{member?.name ?? 'Ancien membre'}
								{member?.guest && <GuestBadge />}
								{id === myId && <span className='muted'> (toi)</span>}
								{!added && <span className='ga-via'> · via {viaGrades(id) || 'un grade'}</span>}
							</span>
							{added && id !== myId && (
								<button type='button' className='btn' onClick={() => void run(() => api<DirectConversation>('DELETE', `${base}/members/${id}`))}>
									Retirer
								</button>
							)}
						</li>
					);
				})}
			</ul>
			{!guest && <GuestInvites workspaceId={workspaceId} conversationId={conversation.id} full={full} />}
			{error && <p className='notice notice-error'>{error}</p>}
			<div className='dm-dialog-actions'>
				{conversation.addedIds.includes(myId) ? (
					<button
						type='button'
						className='btn dm-leave'
						onClick={() => window.confirm('Quitter ce groupe ? Tu n’y auras plus accès.') && void run(() => api<null>('DELETE', `${base}/members/${myId}`))}
					>
						Quitter le groupe
					</button>
				) : (
					<p className='field-hint'>Tu fais partie du groupe par ton grade.</p>
				)}
			</div>
		</Dialog>
	);
}
