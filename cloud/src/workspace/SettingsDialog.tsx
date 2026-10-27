import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';

import { DEFAULT_GRADE, P, has, type Override, type PermGroup } from '../../shared/permissions';
import { type Channel, type ChannelKind, type ChannelOverrides, type Grade, type Member, type WorkspaceDetail } from '../../shared/types';
import { api, errorText } from '../api';
import { navigate } from '../router';
import { Avatar, Dialog, Icon, useDismiss } from '../ui';
import { ChannelPermissions } from './categories/OverridesEditor';
import { CommandsTab } from './commands/CommandsSettings';
import { memberColor, memberGrades, topOf } from './grades';
import { GradesTab } from './settings/GradesSettings';
import { Swatches } from './settings/Swatches';
import { WebhooksTab } from './rc/WebhooksTab';

type Tab = 'space' | 'channels' | 'grades' | 'members' | 'invites' | 'commands' | 'webhooks';

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
	const [tab, setTab] = useState<Tab>('space');
	const tabs: Array<[Tab, string, boolean]> = [
		['space', 'Espace', true],
		['channels', 'Salons', has(info.perms, P.MANAGE_CHANNELS)],
		['grades', 'Grades', has(info.perms, P.MANAGE_GRADES)],
		['members', 'Membres', true],
		['invites', 'Invitations', has(info.perms, P.CREATE_INVITES)],
		['commands', 'Commandes', has(info.perms, P.MANAGE_COMMANDS)],
		['webhooks', 'Webhooks', has(info.perms, P.MANAGE_COMMANDS)],
	];
	const visible = tabs.filter(([, , allowed]) => allowed);
	const current = visible.some(([key]) => key === tab) ? tab : 'space';

	return (
		<Dialog open={open} onClose={onClose} title='Réglages de l’espace' wide>
			<div className='tabs' role='tablist'>
				{visible.map(([key, label]) => (
					<button key={key} type='button' role='tab' aria-selected={current === key} className='tab' onClick={() => setTab(key)}>
						{label}
					</button>
				))}
			</div>
			{current === 'space' && <SpaceTab info={info} myId={myId} onChanged={onChanged} />}
			{current === 'channels' && <ChannelsTab info={info} channels={channels} />}
			{current === 'grades' && <GradesTab info={info} myId={myId} onChanged={onChanged} />}
			{current === 'members' && <MembersTab info={info} myId={myId} onChanged={onChanged} />}
			{current === 'invites' && <InvitesTab workspaceId={info.id} />}
			{current === 'commands' && <CommandsTab workspaceId={info.id} />}
			{current === 'webhooks' && <WebhooksTab workspaceId={info.id} />}
		</Dialog>
	);
}

function SpaceTab({ info, myId, onChanged }: { info: WorkspaceDetail; myId: string; onChanged: () => Promise<unknown> }) {
	const { error, run } = useAction();
	const canEdit = has(info.perms, P.MANAGE_WORKSPACE);
	const setAccent = (accent: string) =>
		run(async () => {
			await api('PATCH', `/w/${info.id}/info`, { accent });
			await onChanged();
		});
	return (
		<div className='stack' style={{ gap: 22 }}>
			{canEdit && (
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
			{canEdit && (
				<div className='field'>
					Couleur de l’espace
					<span className='field-hint'>Utilisée pour le salon actif, les mentions et les boutons principaux.</span>
					<Swatches value={info.accent} onPick={(color) => void setAccent(color)} />
				</div>
			)}
			{info.owner ? (
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
					<input type='checkbox' name='readOnly' defaultChecked={channel?.readOnly} /> Lecture seule pour le grade Membre
				</label>
			) : (
				<label className='field'>
					Places
					<input name='userLimit' type='number' min={0} max={99} defaultValue={channel?.userLimit ?? 0} style={{ width: 120 }} />
					<span className='field-hint'>0 pour un salon sans limite. La permission « Ignorer la limite » permet d’entrer quand c’est complet.</span>
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

function ChannelsTab({ info, channels }: { info: WorkspaceDetail; channels: Channel[] }) {
	const { error, run } = useAction();
	const [editing, setEditing] = useState<{ id: string; view: 'settings' | 'perms' } | null>(null);
	const [creating, setCreating] = useState<ChannelKind | null>(null);

	if (creating) {
		return <ChannelForm workspaceId={info.id} kind={creating} onDone={() => setCreating(null)} />;
	}
	const edited = channels.find((c) => c.id === editing?.id);
	if (edited && editing) {
		return (
			<div className='stack'>
				<div className='row'>
					<button type='button' className='btn btn-ghost' onClick={() => setEditing(null)}>
						<Icon name='chevron-left' size={16} /> Tous les salons
					</button>
					<span className='grow' />
					<div className='segmented' role='tablist'>
						<button type='button' role='tab' aria-selected={editing.view === 'settings'} onClick={() => setEditing({ id: edited.id, view: 'settings' })}>
							Réglages
						</button>
						<button type='button' role='tab' aria-selected={editing.view === 'perms'} onClick={() => setEditing({ id: edited.id, view: 'perms' })}>
							Permissions
						</button>
					</div>
				</div>
				{editing.view === 'settings' ? (
					<ChannelForm workspaceId={info.id} channel={edited} kind={edited.kind} onDone={() => setEditing(null)} />
				) : (
					<ChannelPermissions info={info} channel={edited} />
				)}
			</div>
		);
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
						</span>
						<button type='button' className='btn btn-ghost' style={{ height: 32 }} onClick={() => setEditing({ id: channel.id, view: 'perms' })}>
							Permissions
						</button>
						<button type='button' className='icon-btn icon-btn-sm' aria-label={`Modifier ${channel.name}`} onClick={() => setEditing({ id: channel.id, view: 'settings' })}>
							<Icon name='pencil' size={16} />
						</button>
						<button
							type='button'
							className='icon-btn icon-btn-sm'
							aria-label={`Supprimer ${channel.name}`}
							onClick={() => window.confirm(`Supprimer ${channel.name} avec ses messages et fichiers ?`) && void run(() => api('DELETE', `/w/${info.id}/channels/${channel.id}`))}
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

function MembersTab({ info, myId, onChanged }: { info: WorkspaceDetail; myId: string; onChanged: () => Promise<unknown> }) {
	const { error, run } = useAction();
	const assignable = info.grades.filter((g) => g.id !== DEFAULT_GRADE && (info.owner || (has(info.perms, P.MANAGE_GRADES) && g.position < info.top)));
	const canManage = (member: Member) => !member.owner && (info.owner || (has(info.perms, P.MANAGE_GRADES) && (member.id === myId || topOf(member, info.grades) < info.top)));
	const canKick = (member: Member) => member.id !== myId && !member.owner && (info.owner || (has(info.perms, P.KICK_MEMBERS) && topOf(member, info.grades) < info.top));
	const setGrades = (member: Member, gradeIds: string[]) =>
		run(async () => {
			await api('PUT', `/w/${info.id}/members/${member.id}/grades`, { gradeIds });
			await onChanged();
		});

	return (
		<div className='stack'>
			<ul className='list'>
				{info.members.map((member) => {
					const grades = memberGrades(member, info.grades);
					const editable = canManage(member);
					return (
						<li key={member.id} className='list-row' style={{ flexWrap: 'wrap' }}>
							<Avatar name={member.name} url={member.avatarUrl} size={30} />
							<span className='ellipsis' style={{ fontWeight: 600, color: memberColor(member, info.grades) }}>
								{member.name}
								{member.id === myId && <span className='muted' style={{ fontWeight: 400 }}> (toi)</span>}
							</span>
							<span className='grow row' style={{ flexWrap: 'wrap', gap: 4 }}>
								{member.owner && <span className='grade-chip'>Propriétaire</span>}
								{grades.map((grade) => (
									<span key={grade.id} className='grade-chip' style={{ borderColor: grade.color || undefined }}>
										<span className='grade-dot' style={{ background: grade.color || 'var(--line-strong)' }} aria-hidden />
										{grade.name}
										{editable && assignable.some((g) => g.id === grade.id) && (
											<button type='button' className='chip-x' aria-label={`Retirer ${grade.name} à ${member.name}`} onClick={() => void setGrades(member, member.gradeIds.filter((id) => id !== grade.id))}>
												<Icon name='close' size={12} />
											</button>
										)}
									</span>
								))}
							</span>
							{editable && <GradePicker grades={assignable.filter((g) => !member.gradeIds.includes(g.id))} onPick={(id) => void setGrades(member, [...member.gradeIds, id])} label={`Ajouter un grade à ${member.name}`} />}
							{canKick(member) && (
								<button
									type='button'
									className='icon-btn icon-btn-sm'
									aria-label={`Retirer ${member.name} de l’espace`}
									onClick={() => window.confirm(`Retirer ${member.name} de l’espace ?`) && void run(() => api('DELETE', `/w/${info.id}/members/${member.id}`).then(onChanged))}
								>
									<Icon name='trash' size={16} />
								</button>
							)}
						</li>
					);
				})}
			</ul>
			{error && <p className='notice notice-error'>{error}</p>}
		</div>
	);
}

function GradePicker({ grades, onPick, label }: { grades: Grade[]; onPick: (id: string) => void; label: string }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	if (grades.length === 0) {
		return null;
	}
	return (
		<div ref={ref} style={{ position: 'relative' }}>
			<button type='button' className='icon-btn icon-btn-sm' aria-label={label} title={label} aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<Icon name='plus' size={16} />
			</button>
			{open && (
				<div className='popover' role='menu' style={{ right: 0, top: 'calc(100% + 4px)', minWidth: 200 }}>
					{grades.map((grade) => (
						<button
							key={grade.id}
							type='button'
							role='menuitem'
							className='menu-item'
							onClick={() => {
								setOpen(false);
								onPick(grade.id);
							}}
						>
							<span className='grade-dot' style={{ background: grade.color || 'var(--line-strong)' }} aria-hidden />
							{grade.name}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function InvitesTab({ workspaceId }: { workspaceId: string }) {
	const { error, run } = useAction();
	const [link, setLink] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	return (
		<div className='stack'>
			<p className='muted'>Un lien d’invitation reste valable 7 jours. Toute personne qui l’ouvre peut rejoindre l’espace avec le grade Membre.</p>
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
