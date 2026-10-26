import { useState, type FormEvent } from 'react';

import { ACCENTS, type Channel, type ChannelKind, type Role, type WorkspaceDetail } from '../../shared/types';
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

function useAction() {
	const [error, setError] = useState<string | null>(null);
	const run = async (fn: () => Promise<unknown>) => {
		setError(null);
		try {
			await fn();
			return true;
		} catch (err) {
			setError(errorText(err));
			return false;
		}
	};
	return { error, run };
}

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
		<Dialog open={open} onClose={onClose} title='Réglages de l’espace' wide>
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

function SpaceTab({ info, myId, onChanged }: { info: WorkspaceDetail; myId: string; onChanged: () => Promise<unknown> }) {
	const { error, run } = useAction();
	const staff = info.role !== 'member';
	const setAccent = (accent: string) =>
		run(async () => {
			await api('PATCH', `/w/${info.id}/info`, { accent });
			await onChanged();
		});
	return (
		<div className='stack' style={{ gap: 22 }}>
			{staff && (
				<form
					className='field'
					onSubmit={(e: FormEvent<HTMLFormElement>) => {
						e.preventDefault();
						const name = new FormData(e.currentTarget).get('name');
						void run(async () => {
							await api('PATCH', `/w/${info.id}/info`, { name });
							await onChanged();
						});
					}}
				>
					Nom de l’espace
					<div className='inline-form'>
						<input name='name' defaultValue={info.name} required maxLength={64} />
						<button className='btn'>Renommer</button>
					</div>
				</form>
			)}
			{staff && (
				<div className='field'>
					Couleur de l’espace
					<span className='field-hint'>Utilisée pour le salon actif, les mentions et les boutons principaux.</span>
					<div className='swatches'>
						{ACCENTS.map((color) => (
							<button key={color} type='button' className='swatch' style={{ background: color }} aria-label={`Couleur ${color}`} aria-pressed={info.accent === color} onClick={() => void setAccent(color)} />
						))}
						<label className='swatch' style={{ display: 'grid', placeItems: 'center', background: 'var(--surface)', cursor: 'pointer' }} title='Couleur personnalisée'>
							<Icon name='plus' size={14} />
							<input type='color' className='sr-only' defaultValue={info.accent} onChange={(e) => void setAccent(e.target.value)} aria-label='Couleur personnalisée' />
						</label>
					</div>
				</div>
			)}
			{info.role === 'owner' ? (
				<button
					type='button'
					className='btn btn-danger'
					style={{ alignSelf: 'flex-start' }}
					onClick={() =>
						window.confirm(`Supprimer « ${info.name} » ? Messages et fichiers seront effacés définitivement.`) &&
						void run(async () => {
							await api('DELETE', `/w/${info.id}/info`);
							await onChanged();
							navigate('/espaces', true);
						})
					}
				>
					Supprimer l’espace
				</button>
			) : (
				<button
					type='button'
					className='btn btn-danger'
					style={{ alignSelf: 'flex-start' }}
					onClick={() =>
						window.confirm(`Quitter « ${info.name} » ?`) &&
						void run(async () => {
							await api('DELETE', `/w/${info.id}/members/${myId}`);
							await onChanged();
							navigate('/espaces', true);
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

export function ChannelForm({ workspaceId, channel, kind, onDone }: { workspaceId: string; channel?: Channel; kind: ChannelKind; onDone: () => void }) {
	const { error, run } = useAction();
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const input = {
			name: data.get('name'),
			kind,
			topic: data.get('topic') ?? '',
			category: data.get('category') ?? '',
			readOnly: data.get('readOnly') === 'on',
			userLimit: Number(data.get('userLimit') ?? 0),
		};
		void run(() => (channel ? api('PATCH', `/w/${workspaceId}/channels/${channel.id}`, input) : api('POST', `/w/${workspaceId}/channels`, input))).then((ok) => ok && onDone());
	};
	return (
		<form className='stack' onSubmit={submit}>
			<label className='field'>
				Nom
				<input name='name' defaultValue={channel?.name} required maxLength={40} placeholder={kind === 'voice' ? 'Salle de réunion' : 'nom-du-salon'} autoFocus />
			</label>
			{kind === 'text' && (
				<label className='field'>
					Sujet
					<input name='topic' defaultValue={channel?.topic} maxLength={200} placeholder='Ce dont on parle ici' />
				</label>
			)}
			<label className='field'>
				Catégorie
				<input name='category' defaultValue={channel?.category} maxLength={32} placeholder={kind === 'voice' ? 'Vocal' : 'Salons'} />
				<span className='field-hint'>Les salons d’une même catégorie sont regroupés dans la barre latérale.</span>
			</label>
			{kind === 'text' ? (
				<label className='check'>
					<input type='checkbox' name='readOnly' defaultChecked={channel?.readOnly} /> Lecture seule : seuls les admins publient
				</label>
			) : (
				<label className='field'>
					Places
					<input name='userLimit' type='number' min={0} max={99} defaultValue={channel?.userLimit ?? 0} style={{ width: 120 }} />
					<span className='field-hint'>0 pour un salon sans limite. Les admins entrent même quand c’est complet.</span>
				</label>
			)}
			{error && <p className='notice notice-error'>{error}</p>}
			<div className='row'>
				<button className='btn btn-primary'>{channel ? 'Enregistrer' : kind === 'voice' ? 'Créer le salon vocal' : 'Créer le salon'}</button>
				<button type='button' className='btn btn-ghost' onClick={onDone}>
					Annuler
				</button>
			</div>
		</form>
	);
}

export function CreateChannelDialog({ workspaceId, kind, onClose }: { workspaceId: string; kind: ChannelKind | null; onClose: () => void }) {
	return (
		<Dialog open={kind !== null} onClose={onClose} title={kind === 'voice' ? 'Nouveau salon vocal' : 'Nouveau salon'}>
			{kind && <ChannelForm workspaceId={workspaceId} kind={kind} onDone={onClose} />}
		</Dialog>
	);
}

function ChannelsTab({ workspaceId, channels }: { workspaceId: string; channels: Channel[] }) {
	const { error, run } = useAction();
	const [editing, setEditing] = useState<string | null>(null);
	const [creating, setCreating] = useState<ChannelKind | null>(null);

	if (creating) {
		return <ChannelForm workspaceId={workspaceId} kind={creating} onDone={() => setCreating(null)} />;
	}
	const edited = channels.find((c) => c.id === editing);
	if (edited) {
		return <ChannelForm workspaceId={workspaceId} channel={edited} kind={edited.kind} onDone={() => setEditing(null)} />;
	}
	return (
		<div className='stack'>
			<div className='row'>
				<button type='button' className='btn' onClick={() => setCreating('text')}>
					<Icon name='hash' size={16} /> Nouveau salon
				</button>
				<button type='button' className='btn' onClick={() => setCreating('voice')}>
					<Icon name='speaker' size={16} /> Nouveau salon vocal
				</button>
			</div>
			<ul className='list'>
				{channels.map((channel) => (
					<li key={channel.id} className='list-row'>
						<Icon name={channel.kind === 'voice' ? 'speaker' : channel.readOnly ? 'megaphone' : 'hash'} size={16} />
						<span className='grow ellipsis'>
							{channel.name}
							{channel.category && <span className='muted'>, {channel.category}</span>}
							{channel.kind === 'voice' && channel.userLimit > 0 && <span className='muted'>, {channel.userLimit} places</span>}
						</span>
						<button type='button' className='icon-btn icon-btn-sm' aria-label={`Modifier ${channel.name}`} onClick={() => setEditing(channel.id)}>
							<Icon name='pencil' size={16} />
						</button>
						<button
							type='button'
							className='icon-btn icon-btn-sm'
							aria-label={`Supprimer ${channel.name}`}
							onClick={() => window.confirm(`Supprimer ${channel.name} avec ses messages et fichiers ?`) && void run(() => api('DELETE', `/w/${workspaceId}/channels/${channel.id}`))}
						>
							<Icon name='trash' size={16} />
						</button>
					</li>
				))}
			</ul>
			{error && <p className='notice notice-error'>{error}</p>}
		</div>
	);
}

const ROLE_LABEL: Record<Role, string> = { owner: 'Propriétaire', admin: 'Admin', member: 'Membre' };

function MembersTab({ info, myId, onChanged }: { info: WorkspaceDetail; myId: string; onChanged: () => Promise<unknown> }) {
	const { error, run } = useAction();
	const canRemove = (role: Role) => (info.role === 'owner' ? role !== 'owner' : info.role === 'admin' && role === 'member');
	return (
		<div className='stack'>
			<ul className='list'>
				{info.members.map((member) => (
					<li key={member.id} className='list-row'>
						<Avatar name={member.name} url={member.avatarUrl} size={30} />
						<span className='grow ellipsis'>
							{member.name}
							{member.id === myId && <span className='muted'> (toi)</span>}
						</span>
						{info.role === 'owner' && member.role !== 'owner' ? (
							<select value={member.role} aria-label={`Rôle de ${member.name}`} onChange={(e) => void run(() => api('PATCH', `/w/${info.id}/members/${member.id}`, { role: e.target.value }).then(onChanged))}>
								<option value='member'>Membre</option>
								<option value='admin'>Admin</option>
							</select>
						) : (
							<span className='muted'>{ROLE_LABEL[member.role]}</span>
						)}
						{member.id !== myId && canRemove(member.role) && (
							<button
								type='button'
								className='icon-btn icon-btn-sm'
								aria-label={`Retirer ${member.name}`}
								onClick={() => window.confirm(`Retirer ${member.name} de l’espace ?`) && void run(() => api('DELETE', `/w/${info.id}/members/${member.id}`).then(onChanged))}
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
				className='btn btn-primary'
				style={{ alignSelf: 'flex-start' }}
				onClick={() =>
					void run(async () => {
						const { code } = await api<{ code: string }>('POST', `/w/${workspaceId}/invites`);
						setLink(`${location.origin}/invite/${code}`);
						setCopied(false);
					})
				}
			>
				<Icon name='link' size={16} /> Générer un lien
			</button>
			{link && (
				<div className='inline-form'>
					<input readOnly value={link} aria-label='Lien d’invitation' onFocus={(e) => e.target.select()} />
					<button type='button' className='btn' onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}>
						{copied ? 'Copié' : 'Copier'}
					</button>
				</div>
			)}
			{error && <p className='notice notice-error'>{error}</p>}
		</div>
	);
}
