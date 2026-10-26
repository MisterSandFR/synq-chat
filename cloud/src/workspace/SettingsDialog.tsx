import { useState, type FormEvent } from 'react';

import type { Channel, Role, WorkspaceDetail } from '../../shared/types';
import { api, errorText } from '../api';
import { navigate } from '../router';
import { Avatar, Dialog, Icon } from '../ui';

type Tab = 'space' | 'channels' | 'members' | 'invites';

type Props = {
	open: boolean;
	onClose: () => void;
	info: WorkspaceDetail;
	channels: Channel[];
	myId: string;
	onChanged: () => Promise<unknown>;
};

export function SettingsDialog({ open, onClose, info, channels, myId, onChanged }: Props) {
	const staff = info.role !== 'member';
	const [tab, setTab] = useState<Tab>('space');
	const tabs: Array<[Tab, string]> = staff
		? [
				['space', 'Espace'],
				['channels', 'Salons'],
				['members', 'Membres'],
				['invites', 'Invitations'],
			]
		: [
				['space', 'Espace'],
				['members', 'Membres'],
			];

	return (
		<Dialog open={open} onClose={onClose} title={info.name}>
			<div className='tabs' role='tablist'>
				{tabs.map(([key, label]) => (
					<button key={key} type='button' role='tab' aria-selected={tab === key} className='tab' onClick={() => setTab(key)}>
						{label}
					</button>
				))}
			</div>
			{tab === 'space' && <SpaceTab info={info} myId={myId} onChanged={onChanged} />}
			{tab === 'channels' && staff && <ChannelsTab workspaceId={info.id} channels={channels} />}
			{tab === 'members' && <MembersTab info={info} myId={myId} onChanged={onChanged} />}
			{tab === 'invites' && staff && <InvitesTab workspaceId={info.id} />}
		</Dialog>
	);
}

function useAction() {
	const [error, setError] = useState<string | null>(null);
	const run = async (fn: () => Promise<unknown>) => {
		setError(null);
		try {
			await fn();
		} catch (err) {
			setError(errorText(err));
		}
	};
	return { error, run };
}

function SpaceTab({ info, myId, onChanged }: { info: WorkspaceDetail; myId: string; onChanged: () => Promise<unknown> }) {
	const { error, run } = useAction();
	const rename = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const name = new FormData(event.currentTarget).get('name');
		void run(async () => {
			await api('PATCH', `/w/${info.id}/info`, { name });
			await onChanged();
		});
	};
	return (
		<div className='stack'>
			{info.role !== 'member' && (
				<form className='inline-form' onSubmit={rename}>
					<input name='name' defaultValue={info.name} required maxLength={64} aria-label='Nom de l’espace' />
					<button className='button'>Renommer</button>
				</form>
			)}
			{info.role === 'owner' ? (
				<button
					type='button'
					className='button button-danger'
					onClick={() =>
						window.confirm(`Supprimer « ${info.name} » ? Messages et fichiers seront effacés définitivement.`) &&
						void run(async () => {
							await api('DELETE', `/w/${info.id}/info`);
							await onChanged();
							navigate('/', true);
						})
					}
				>
					Supprimer l’espace
				</button>
			) : (
				<button
					type='button'
					className='button button-danger'
					onClick={() =>
						window.confirm(`Quitter « ${info.name} » ?`) &&
						void run(async () => {
							await api('DELETE', `/w/${info.id}/members/${myId}`);
							await onChanged();
							navigate('/', true);
						})
					}
				>
					Quitter l’espace
				</button>
			)}
			{error && <p className='notice notice-error'>{error}</p>}
		</div>
	);
}

function ChannelsTab({ workspaceId, channels }: { workspaceId: string; channels: Channel[] }) {
	const { error, run } = useAction();
	const [editing, setEditing] = useState<string | null>(null);

	const save = (event: FormEvent<HTMLFormElement>, channel?: Channel) => {
		event.preventDefault();
		const form = event.currentTarget;
		const data = new FormData(form);
		const input = { name: data.get('name'), topic: data.get('topic'), category: data.get('category'), readOnly: data.get('readOnly') === 'on' };
		void run(async () => {
			await (channel ? api('PATCH', `/w/${workspaceId}/channels/${channel.id}`, input) : api('POST', `/w/${workspaceId}/channels`, input));
			setEditing(null);
			if (!channel) {
				form.reset();
			}
		});
	};

	const fields = (channel?: Channel) => (
		<>
			<input name='name' defaultValue={channel?.name} placeholder='nom-du-salon' required maxLength={40} aria-label='Nom' />
			<input name='topic' defaultValue={channel?.topic} placeholder='Sujet (optionnel)' maxLength={200} aria-label='Sujet' />
			<input name='category' defaultValue={channel?.category} placeholder='Catégorie (optionnel)' maxLength={32} aria-label='Catégorie' />
			<label className='check'>
				<input type='checkbox' name='readOnly' defaultChecked={channel?.readOnly} /> Lecture seule pour les membres
			</label>
		</>
	);

	return (
		<div className='stack'>
			<form className='channel-form' onSubmit={(e) => save(e)}>
				{fields()}
				<button className='button button-primary'>Créer le salon</button>
			</form>
			<ul className='settings-list'>
				{channels.map((channel) =>
					editing === channel.id ? (
						<li key={channel.id}>
							<form className='channel-form' onSubmit={(e) => save(e, channel)}>
								{fields(channel)}
								<div className='row'>
									<button className='button button-primary'>Enregistrer</button>
									<button type='button' className='button button-quiet' onClick={() => setEditing(null)}>
										Annuler
									</button>
								</div>
							</form>
						</li>
					) : (
						<li key={channel.id} className='settings-row'>
							<Icon name={channel.readOnly ? 'megaphone' : 'hash'} />
							<span className='grow'>
								{channel.name}
								{channel.category && <span className='muted'> · {channel.category}</span>}
							</span>
							<button type='button' className='icon-button' aria-label={`Modifier ${channel.name}`} onClick={() => setEditing(channel.id)}>
								<Icon name='pencil' size={16} />
							</button>
							<button
								type='button'
								className='icon-button'
								aria-label={`Supprimer ${channel.name}`}
								onClick={() =>
									window.confirm(`Supprimer #${channel.name} et tout son historique ?`) && void run(() => api('DELETE', `/w/${workspaceId}/channels/${channel.id}`))
								}
							>
								<Icon name='trash' size={16} />
							</button>
						</li>
					),
				)}
			</ul>
			{error && <p className='notice notice-error'>{error}</p>}
		</div>
	);
}

const ROLE_LABEL: Record<Role, string> = { owner: 'Propriétaire', admin: 'Admin', member: 'Membre' };

function MembersTab({ info, myId, onChanged }: { info: WorkspaceDetail; myId: string; onChanged: () => Promise<unknown> }) {
	const { error, run } = useAction();
	const canRemove = (role: Role) => info.role === 'owner' ? role !== 'owner' : info.role === 'admin' && role === 'member';
	return (
		<div className='stack'>
			<ul className='settings-list'>
				{info.members.map((member) => (
					<li key={member.id} className='settings-row'>
						<Avatar id={member.id} name={member.name} url={member.avatarUrl} size={28} />
						<span className='grow'>
							{member.name}
							{member.id === myId && <span className='muted'> (toi)</span>}
						</span>
						{info.role === 'owner' && member.role !== 'owner' ? (
							<select
								value={member.role}
								aria-label={`Rôle de ${member.name}`}
								onChange={(e) => void run(() => api('PATCH', `/w/${info.id}/members/${member.id}`, { role: e.target.value }).then(onChanged))}
							>
								<option value='member'>Membre</option>
								<option value='admin'>Admin</option>
							</select>
						) : (
							<span className='muted'>{ROLE_LABEL[member.role]}</span>
						)}
						{member.id !== myId && canRemove(member.role) && (
							<button
								type='button'
								className='icon-button'
								aria-label={`Retirer ${member.name}`}
								onClick={() =>
									window.confirm(`Retirer ${member.name} de l’espace ?`) && void run(() => api('DELETE', `/w/${info.id}/members/${member.id}`).then(onChanged))
								}
							>
								<Icon name='trash' size={16} />
							</button>
						)}
					</li>
				))}
			</ul>
			{error && <p className='notice notice-error'>{error}</p>}
		</div>
	);
}

function InvitesTab({ workspaceId }: { workspaceId: string }) {
	const { error, run } = useAction();
	const [link, setLink] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	return (
		<div className='stack'>
			<p className='muted'>Un lien d’invitation reste valable 7 jours. Toute personne qui l’ouvre peut rejoindre l’espace.</p>
			<button
				type='button'
				className='button button-primary'
				onClick={() =>
					void run(async () => {
						const { code } = await api<{ code: string }>('POST', `/w/${workspaceId}/invites`);
						setLink(`${location.origin}/invite/${code}`);
						setCopied(false);
					})
				}
			>
				Générer un lien
			</button>
			{link && (
				<div className='inline-form'>
					<input readOnly value={link} aria-label='Lien d’invitation' onFocus={(e) => e.target.select()} />
					<button
						type='button'
						className='button'
						onClick={() =>
							void navigator.clipboard.writeText(link).then(
								() => setCopied(true),
								() => setCopied(false),
							)
						}
					>
						{copied ? 'Copié' : 'Copier'}
					</button>
				</div>
			)}
			{error && <p className='notice notice-error'>{error}</p>}
		</div>
	);
}
