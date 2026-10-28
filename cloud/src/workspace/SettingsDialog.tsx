import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';

import { Floating } from '../floating';
import { DEFAULT_GRADE, P, has, type Override, type PermGroup } from '../../shared/permissions';
import { AVATAR_TYPES } from '../../shared/rc';
import { type Channel, type ChannelKind, type ChannelOverrides, type Grade, type Member, type WorkspaceDetail } from '../../shared/types';
import { api, errorText, upload } from '../api';
import { navigate } from '../router';
import { Avatar, Dialog, Icon, SpaceLogo, useDismiss, type IconName } from '../ui';
import { ChannelPermissions } from './categories/OverridesEditor';
import { CommandsTab } from './commands/CommandsSettings';
import { memberColor, memberGrades, topOf } from './grades';
import { AuditTab } from './settings/AuditTab';
import { GradesTab } from './settings/GradesSettings';
import { InvitesTab } from './settings/InvitesSettings';
import { MailTab } from './settings/MailSettings';
import { Swatches } from './settings/Swatches';
import { WebhooksTab } from './rc/WebhooksTab';
import './settings/settings.css';

type Tab = 'space' | 'channels' | 'grades' | 'members' | 'invites' | 'commands' | 'webhooks' | 'mail' | 'audit';

type Props = {
	open: boolean;
	onClose: () => void;
	info: WorkspaceDetail;
	channels: Channel[];
	myId: string;
	onChanged: () => Promise<unknown>;
};

type NavItem = { key: Tab; label: string; icon: IconName; allowed: boolean };

const LOGO_SIZE = 256;

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
	const ref = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const dialog = ref.current;
		if (open && dialog && !dialog.open) {
			dialog.showModal();
		} else if (!open && dialog?.open) {
			dialog.close();
		}
	}, [open]);
	return (
		<dialog ref={ref} className='dialog settings-dialog' aria-label='Réglages de l’espace' onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
			{open && <SettingsShell info={info} channels={channels} myId={myId} onChanged={onChanged} onClose={onClose} />}
		</dialog>
	);
}

function SettingsShell({ info, channels, myId, onChanged, onClose }: Omit<Props, 'open'>) {
	const [tab, setTab] = useState<Tab>('space');
	// Mobile seulement : liste des sections, puis page plein écran.
	const [view, setView] = useState<'nav' | 'page'>('nav');
	const groups: Array<[string, NavItem[]]> = [
		[
			'Espace',
			[
				{ key: 'space', label: 'Vue d’ensemble', icon: 'settings', allowed: true },
				{ key: 'channels', label: 'Salons', icon: 'hash', allowed: has(info.perms, P.MANAGE_CHANNELS) },
			],
		],
		[
			'Membres',
			[
				{ key: 'members', label: 'Membres', icon: 'users', allowed: true },
				{ key: 'grades', label: 'Grades', icon: 'shield', allowed: has(info.perms, P.MANAGE_GRADES) },
				{ key: 'invites', label: 'Invitations', icon: 'user-plus', allowed: has(info.perms, P.CREATE_INVITES) },
			],
		],
		[
			'Intégrations',
			[
				{ key: 'commands', label: 'Commandes', icon: 'slash', allowed: has(info.perms, P.MANAGE_COMMANDS) },
				{ key: 'webhooks', label: 'Webhooks', icon: 'link', allowed: has(info.perms, P.MANAGE_COMMANDS) },
				{ key: 'mail', label: 'Boîtes mail', icon: 'mail', allowed: has(info.perms, P.MANAGE_WORKSPACE) },
			],
		],
		['Modération', [{ key: 'audit', label: 'Journal', icon: 'list', allowed: has(info.perms, P.MANAGE_WORKSPACE) }]],
	];
	const visible = groups.map(([label, items]) => [label, items.filter((item) => item.allowed)] as const).filter(([, items]) => items.length > 0);
	const items = visible.flatMap(([, list]) => list);
	const current = items.find((item) => item.key === tab) ?? items[0]!;

	return (
		<div className='settings-shell' data-view={view}>
			<nav className='settings-nav' aria-label='Sections des réglages'>
				<div className='settings-nav-head'>
					<SpaceLogo name={info.name} accent={info.accent} url={info.logoUrl} size={32} />
					<span className='settings-nav-title'>
						<strong className='ellipsis'>{info.name}</strong>
						<span>Réglages de l’espace</span>
					</span>
					<button type='button' className='icon-btn settings-nav-close' onClick={onClose} aria-label='Fermer'>
						<Icon name='close' />
					</button>
				</div>
				{visible.map(([label, list]) => (
					<div key={label} className='settings-nav-group' role='group' aria-label={label}>
						<h3>{label}</h3>
						{list.map((item) => (
							<button
								key={item.key}
								type='button'
								className='settings-nav-item'
								aria-current={item.key === current.key ? 'page' : undefined}
								onClick={() => {
									setTab(item.key);
									setView('page');
								}}
							>
								<Icon name={item.icon} size={16} />
								<span className='grow ellipsis'>{item.label}</span>
								<Icon name='chevron-right' size={16} />
							</button>
						))}
					</div>
				))}
			</nav>
			<section className='settings-page' aria-labelledby='settings-page-title'>
				<header className='settings-page-head'>
					<button type='button' className='icon-btn settings-back' onClick={() => setView('nav')} aria-label='Retour aux sections'>
						<Icon name='chevron-left' />
					</button>
					<h2 id='settings-page-title' className='ellipsis'>
						{current.label}
					</h2>
					<button type='button' className='icon-btn' onClick={onClose} aria-label='Fermer'>
						<Icon name='close' />
					</button>
				</header>
				<div className='settings-page-body'>
					{current.key === 'space' && <SpaceTab info={info} myId={myId} onChanged={onChanged} />}
					{current.key === 'channels' && <ChannelsTab info={info} channels={channels} />}
					{current.key === 'grades' && <GradesTab info={info} myId={myId} onChanged={onChanged} />}
					{current.key === 'members' && <MembersTab info={info} myId={myId} onChanged={onChanged} />}
					{current.key === 'invites' && <InvitesTab info={info} channels={channels} myId={myId} />}
					{current.key === 'commands' && <CommandsTab workspaceId={info.id} />}
					{current.key === 'webhooks' && <WebhooksTab workspaceId={info.id} />}
					{current.key === 'mail' && <MailTab info={info} />}
					{current.key === 'audit' && <AuditTab info={info} channelName={(id) => channels.find((c) => c.id === id)?.name ?? null} />}
				</div>
			</section>
		</div>
	);
}

// Recadrage carré centré, réduit à 256 px : poids constant quelle que soit la photo.
async function squareLogo(file: File): Promise<File> {
	if (!AVATAR_TYPES.includes(file.type)) {
		throw new Error('Image PNG, JPEG, GIF ou WebP attendue');
	}
	const bitmap = await createImageBitmap(file).catch(() => {
		throw new Error('Image illisible');
	});
	const side = Math.min(bitmap.width, bitmap.height);
	const canvas = document.createElement('canvas');
	canvas.width = LOGO_SIZE;
	canvas.height = LOGO_SIZE;
	const context = canvas.getContext('2d')!;
	context.imageSmoothingQuality = 'high';
	context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, LOGO_SIZE, LOGO_SIZE);
	bitmap.close();
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
	if (!blob) {
		throw new Error('Image illisible');
	}
	// Safari n'encode pas le WebP : blob.type retombe sur PNG.
	return new File([blob], 'logo', { type: blob.type });
}

function SpaceTab({ info, myId, onChanged }: { info: WorkspaceDetail; myId: string; onChanged: () => Promise<unknown> }) {
	const { error, run } = useAction();
	const [busy, setBusy] = useState(false);
	const canEdit = has(info.perms, P.MANAGE_WORKSPACE);
	const setAccent = (accent: string) =>
		run(async () => {
			await api('PATCH', `/w/${info.id}/info`, { accent });
			await onChanged();
		});
	const logoTask = (task: () => Promise<unknown>) => {
		setBusy(true);
		void run(async () => {
			await task();
			await onChanged();
		}).finally(() => setBusy(false));
	};
	const changeLogo = (file: File | undefined) => file && logoTask(async () => upload(`/w/${info.id}/logo`, await squareLogo(file)));
	const removeLogo = () => logoTask(() => api('DELETE', `/w/${info.id}/logo`));

	return (
		<div className='settings-sections'>
			<section className='settings-block'>
				<div className='settings-identity'>
					<SpaceLogo name={info.name} accent={info.accent} url={info.logoUrl} size={80} />
					<div className='settings-identity-text'>
						<strong className='ellipsis'>{info.name}</strong>
						{canEdit ? (
							<>
								<div className='row' style={{ flexWrap: 'wrap', gap: 8 }}>
									<label className={`btn${busy ? ' is-disabled' : ''}`}>
										<Icon name='upload' size={16} /> Changer le logo
										<input
											type='file'
											accept={AVATAR_TYPES.join(',')}
											hidden
											disabled={busy}
											onChange={(e) => {
												changeLogo(e.target.files?.[0]);
												e.target.value = '';
											}}
										/>
									</label>
									{info.logoUrl && (
										<button type='button' className='btn btn-ghost' disabled={busy} onClick={removeLogo}>
											Retirer
										</button>
									)}
								</div>
								<span className='field-hint'>Recadré en carré de 256 px. PNG, JPEG, GIF ou WebP, 2 Mo max. Sans logo, l’initiale s’affiche.</span>
							</>
						) : (
							<span className='field-hint'>Seuls les membres qui gèrent l’espace peuvent modifier son identité.</span>
						)}
					</div>
				</div>
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
			</section>
			<section className='settings-block'>
				<h3 className='settings-block-title'>{info.owner ? 'Zone sensible' : 'Quitter'}</h3>
				{info.owner ? (
					<div className='settings-danger'>
						<span className='grow'>
							<strong>Supprimer l’espace</strong>
							<span className='field-hint'>Messages, fichiers et réglages sont effacés définitivement.</span>
						</span>
						<button
							type='button'
							className='btn btn-danger'
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
					</div>
				) : (
					<div className='settings-danger'>
						<span className='grow'>
							<strong>Quitter l’espace</strong>
							<span className='field-hint'>Il faudra une nouvelle invitation pour revenir.</span>
						</span>
						<button
							type='button'
							className='btn btn-danger'
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
					</div>
				)}
			</section>
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
				<Floating anchor={ref} placement='bottom-end' className='popover' role='menu' style={{ minWidth: 200 }}>
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
				</Floating>
			)}
		</div>
	);
}
