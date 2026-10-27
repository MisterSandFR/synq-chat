import { useRef, useState, type ReactNode } from 'react';

import { PRESENCE_LABEL, type Presence } from '../../shared/rc';

import { P, has } from '../../shared/permissions';
import type { Channel, Grade, Me, Member, VoiceParticipant } from '../../shared/types';
import { api } from '../api';
import { navigate } from '../router';
import { Avatar, Icon, useDismiss } from '../ui';
import { CategoryNav } from './categories/CategoryNav';
import { memberColor } from './grades';
import { ResizeHandle, type Resizable } from './resizable';
import { CallControls } from './voice/CallView';
import type { VoiceControls } from './voice/useVoice';
import type { WorkspaceState } from './useWorkspace';

type Props = {
	me: Me;
	workspaceId: string;
	state: WorkspaceState;
	channelId: string | null;
	members: Map<string, Member>;
	voice: VoiceControls;
	width: Resizable;
	onOpenSettings: () => void;
	onOpenSearch: () => void;
	onNavigate: () => void;
	onCreateChannel: (kind: 'text' | 'voice') => void;
	presence?: Presence;
	presenceText?: string;
	meMenu?: (close: () => void) => ReactNode;
	directs?: ReactNode;
};

export function Sidebar({ me, workspaceId, state, channelId, members, voice, width, onOpenSettings, onOpenSearch, onNavigate, onCreateChannel, presence, presenceText, meMenu, directs }: Props) {
	const staff = has(state.info?.perms ?? 0, P.MANAGE_CHANNELS);
	const grades = state.info?.grades ?? [];
	const channels = state.channels ?? [];
	const connectedChannel = voice.snapshot ? channels.find((c) => c.id === voice.snapshot!.channelId) : undefined;

	const open = (id: string) => {
		onNavigate();
		navigate(`/w/${workspaceId}/${id}`);
	};

	return (
		<aside className='sidebar' style={{ width: width.width }} aria-label='Navigation de l’espace'>
			<div className='sidebar-top'>
				<WorkspaceSwitcher me={me} workspaceId={workspaceId} name={state.info?.name ?? ''} accent={state.info?.accent} />
				<button type='button' className='icon-btn' aria-label='Réglages de l’espace' title='Réglages de l’espace' onClick={onOpenSettings}>
					<Icon name='settings' />
				</button>
			</div>

			<button type='button' className='search-btn' onClick={onOpenSearch}>
				<Icon name='search' size={16} />
				<span className='grow' style={{ textAlign: 'left' }}>
					Rechercher
				</span>
				<kbd>Ctrl K</kbd>
			</button>

			<CategoryNav
				workspaceId={workspaceId}
				info={state.info ?? null}
				channels={channels.filter((c) => c.kind !== 'dm')}
				footer={directs}
				channelId={channelId}
				staff={staff}
				onOpenChannel={open}
				onCreateChannel={onCreateChannel}
				renderChannel={(channel) =>
					channel.kind === 'voice' ? (
						<VoiceChannelRow
							channel={channel}
							active={channel.id === channelId}
							unread={state.unread[channel.id] ?? 0}
							mentions={state.mentions[channel.id] ?? 0}
							participants={state.voice[channel.id] ?? []}
							members={members}
							grades={grades}
							speaking={voice.snapshot?.channelId === channel.id ? voice.snapshot.speaking : null}
							onOpen={() => open(channel.id)}
							onJoin={() => {
								open(channel.id);
								void voice.join(channel.id);
							}}
						/>
					) : (
						<TextChannelRow channel={channel} active={channel.id === channelId} unread={state.unread[channel.id] ?? 0} mentions={state.mentions[channel.id] ?? 0} onOpen={() => open(channel.id)} />
					)
				}
			/>

			{voice.snapshot && (
				<div className='voice-dock'>
					<div className='voice-dock-status'>
						<span className='grow ellipsis'>
							<strong>{voice.snapshot.status === 'connecting' ? 'Connexion…' : voice.snapshot.status === 'reconnecting' ? 'Reconnexion…' : 'Vocal connecté'}</strong>
							{connectedChannel && (
								<>
									{' '}
									<button type='button' className='link' style={{ fontWeight: 500, color: 'var(--muted)' }} onClick={() => open(connectedChannel.id)}>
										{connectedChannel.name}
									</button>
								</>
							)}
						</span>
					</div>
					<CallControls voice={voice} perms={state.perms[voice.snapshot.channelId] ?? 0} />
				</div>
			)}

			<MeBar me={me} status={state.status} presence={presence} presenceText={presenceText} menu={meMenu} />

			<ResizeHandle resize={width} label='Redimensionner la barre latérale' />
		</aside>
	);
}

function TextChannelRow({ channel, active, unread, mentions, onOpen }: { channel: Channel; active: boolean; unread: number; mentions: number; onOpen: () => void }) {
	const showUnread = !active && unread > 0;
	return (
		<a
			href={`#${channel.id}`}
			className={`channel${showUnread ? ' channel-unread' : ''}`}
			aria-current={active ? 'page' : undefined}
			onClick={(e) => {
				e.preventDefault();
				onOpen();
			}}
		>
			<span className='channel-icon'>
				<Icon name={channel.readOnly ? 'megaphone' : 'hash'} size={16} />
			</span>
			<span className='channel-name'>{channel.name}</span>
			{!active && mentions > 0 ? <span className='pill'>{mentions > 99 ? '99+' : mentions}</span> : showUnread && <span className='dot' aria-label='Non lu' />}
		</a>
	);
}

type VoiceRowProps = {
	channel: Channel;
	active: boolean;
	unread: number;
	mentions: number;
	participants: VoiceParticipant[];
	members: Map<string, Member>;
	grades: Grade[];
	speaking: Set<string> | null;
	onOpen: () => void;
	onJoin: () => void;
};

function VoiceChannelRow({ channel, active, unread, mentions, participants, members, grades, speaking, onOpen, onJoin }: VoiceRowProps) {
	return (
		<>
			<a
				href={`#${channel.id}`}
				className='channel'
				aria-current={active ? 'page' : undefined}
				title='Double-clic pour rejoindre'
				onClick={(e) => {
					e.preventDefault();
					onOpen();
				}}
				onDoubleClick={(e) => {
					e.preventDefault();
					onJoin();
				}}
			>
				<span className='channel-icon'>
					<Icon name='speaker' size={16} />
				</span>
				<span className='channel-name'>{channel.name}</span>
				{!active && mentions > 0 ? <span className='pill'>{mentions > 99 ? '99+' : mentions}</span> : !active && unread > 0 && <span className='dot' aria-label='Messages non lus' />}
				{(participants.length > 0 || channel.userLimit > 0) && (
					<span className='channel-meta'>
						{participants.length}
						{channel.userLimit > 0 && `/${channel.userLimit}`}
					</span>
				)}
			</a>
			{participants.length > 0 && (
				<ul className='voice-users'>
					{participants.map((p) => {
						const member = members.get(p.userId);
						return (
							<li key={p.userId} className={`voice-user${speaking?.has(p.userId) ? ' voice-user-speaking' : ''}`}>
								<Avatar name={member?.name ?? '?'} url={member?.avatarUrl} size={22} />
								<span className='grow ellipsis' style={{ color: memberColor(member, grades) }}>
									{member?.name ?? 'Membre'}
								</span>
								<span className='voice-user-icons'>
									{p.screen && <Icon name='screen' size={14} />}
									{p.video && <Icon name='video' size={14} />}
									{p.deafened ? <Icon name='headphones-off' size={14} /> : p.muted && <Icon name='mic-off' size={14} />}
								</span>
							</li>
						);
					})}
				</ul>
			)}
		</>
	);
}

function WorkspaceSwitcher({ me, workspaceId, name, accent }: { me: Me; workspaceId: string; name: string; accent?: string }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	return (
		<div className='switcher' ref={ref}>
			<button type='button' className='switcher-btn' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<span className='avatar avatar-square' style={{ width: 30, height: 30, fontSize: 13, background: accent ?? 'var(--text)', color: '#fff' }}>
					{name.charAt(0).toUpperCase() || ' '}
				</span>
				<span className='switcher-name'>{name}</span>
				<Icon name='chevron' size={16} />
			</button>
			{open && (
				<div className='popover' role='menu' style={{ top: 'calc(100% + 4px)', left: 0, width: 280 }}>
					{me.workspaces.map((w) => (
						<button
							key={w.id}
							type='button'
							role='menuitem'
							className='menu-item'
							onClick={() => {
								setOpen(false);
								navigate(`/w/${w.id}`);
							}}
						>
							<span className='avatar avatar-square' style={{ width: 26, height: 26, fontSize: 12, background: w.accent, color: '#fff' }}>
								{w.name.charAt(0).toUpperCase()}
							</span>
							<span className='grow ellipsis'>{w.name}</span>
							{w.id === workspaceId && <Icon name='check' size={16} />}
						</button>
					))}
					<div className='menu-sep' />
					<button
						type='button'
						role='menuitem'
						className='menu-item'
						onClick={() => {
							setOpen(false);
							navigate('/espaces');
						}}
					>
						<Icon name='plus' size={16} /> Créer ou rejoindre un espace
					</button>
				</div>
			)}
		</div>
	);
}

type MeBarProps = { me: Me; status: WorkspaceState['status']; presence?: Presence; presenceText?: string; menu?: (close: () => void) => ReactNode };

function MeBar({ me, status, presence, presenceText, menu }: MeBarProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	const live = presenceText || (presence ? PRESENCE_LABEL[presence] : 'En ligne');
	const label = status === 'live' ? live : status === 'connecting' ? 'Connexion…' : 'Hors ligne';
	return (
		<div className='me-bar' ref={ref} style={{ position: 'relative' }}>
			<Avatar name={me.user.name} url={me.user.avatarUrl} size={32} online={status === 'live'} className={presence ? `presence-${presence}` : ''} />
			<span className='me-bar-name grow'>
				<span className='ellipsis'>{me.user.name}</span>
				<span>{label}</span>
			</span>
			<button type='button' className='icon-btn' aria-label='Menu du compte' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<Icon name='more' />
			</button>
			{open && (
				<div className='popover' role='menu' style={{ bottom: 'calc(100% + 4px)', right: 8 }}>
					{menu?.(() => setOpen(false))}
					<button
						type='button'
						role='menuitem'
						className='menu-item'
						onClick={() => {
							setOpen(false);
							navigate('/espaces');
						}}
					>
						<Icon name='home' size={16} /> Profil et espaces
					</button>
					<button
						type='button'
						role='menuitem'
						className='menu-item menu-item-danger'
						onClick={async () => {
							await api('POST', '/auth/logout');
							window.location.href = '/';
						}}
					>
						<Icon name='logout' size={16} /> Se déconnecter
					</button>
				</div>
			)}
		</div>
	);
}
