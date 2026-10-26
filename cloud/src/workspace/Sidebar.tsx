import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

import type { Channel, Me, Member, VoiceParticipant } from '../../shared/types';
import { api } from '../api';
import { navigate, readPref, writePref } from '../router';
import { Avatar, Icon, useDismiss } from '../ui';
import { CallControls } from './voice/CallView';
import type { VoiceControls } from './voice/useVoice';
import type { WorkspaceState } from './useWorkspace';

const MIN_WIDTH = 220;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 280;

export function useSidebarWidth() {
	const [width, setWidth] = useState(() => {
		const saved = Number(readPref('sidebar_width'));
		return saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : DEFAULT_WIDTH;
	});
	const [dragging, setDragging] = useState(false);

	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			const startX = event.clientX;
			const startWidth = width;
			let latest = startWidth;
			setDragging(true);
			const move = (e: PointerEvent) => {
				latest = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + e.clientX - startX)));
				setWidth(latest);
			};
			const up = () => {
				setDragging(false);
				writePref('sidebar_width', String(latest));
				window.removeEventListener('pointermove', move);
				window.removeEventListener('pointerup', up);
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
			};
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
			window.addEventListener('pointermove', move);
			window.addEventListener('pointerup', up);
		},
		[width],
	);

	const onKeyDown = (event: ReactKeyboardEvent) => {
		const step = event.shiftKey ? 40 : 10;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width + (event.key === 'ArrowRight' ? step : -step)));
			setWidth(next);
			writePref('sidebar_width', String(next));
		}
	};

	const reset = () => {
		setWidth(DEFAULT_WIDTH);
		writePref('sidebar_width', String(DEFAULT_WIDTH));
	};

	return { width, dragging, onPointerDown, onKeyDown, reset };
}

type Props = {
	me: Me;
	workspaceId: string;
	state: WorkspaceState;
	channelId: string | null;
	members: Map<string, Member>;
	voice: VoiceControls;
	width: ReturnType<typeof useSidebarWidth>;
	onOpenSettings: () => void;
	onOpenSearch: () => void;
	onNavigate: () => void;
	onCreateChannel: (kind: 'text' | 'voice') => void;
};

export function Sidebar({ me, workspaceId, state, channelId, members, voice, width, onOpenSettings, onOpenSearch, onNavigate, onCreateChannel }: Props) {
	const staff = state.info?.role !== 'member';
	const channels = state.channels ?? [];
	const sections = new Map<string, { kind: 'text' | 'voice'; label: string; items: Channel[] }>();
	for (const channel of channels) {
		const key = `${channel.kind}:${channel.category}`;
		const label = channel.category || (channel.kind === 'voice' ? 'Vocal' : 'Salons');
		const section = sections.get(key) ?? { kind: channel.kind, label, items: [] };
		section.items.push(channel);
		sections.set(key, section);
	}
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

			<nav className='nav' aria-label='Salons'>
				{[...sections.values()].map((section) => (
					<div key={`${section.kind}:${section.label}`} className='nav-section'>
						<div className='nav-section-head'>
							<span>{section.label}</span>
							{staff && (
								<button
									type='button'
									className='icon-btn icon-btn-sm'
									aria-label={section.kind === 'voice' ? 'Créer un salon vocal' : 'Créer un salon'}
									title={section.kind === 'voice' ? 'Créer un salon vocal' : 'Créer un salon'}
									onClick={() => onCreateChannel(section.kind)}
								>
									<Icon name='plus' size={14} strokeWidth={2} />
								</button>
							)}
						</div>
						{section.items.map((channel) =>
							channel.kind === 'voice' ? (
								<VoiceChannelRow
									key={channel.id}
									channel={channel}
									active={channel.id === channelId}
									unread={state.unread[channel.id] ?? 0}
									mentions={state.mentions[channel.id] ?? 0}
									participants={state.voice[channel.id] ?? []}
									members={members}
									speaking={voice.snapshot?.channelId === channel.id ? voice.snapshot.speaking : null}
									onOpen={() => open(channel.id)}
									onJoin={() => {
										open(channel.id);
										void voice.join(channel.id);
									}}
								/>
							) : (
								<TextChannelRow key={channel.id} channel={channel} active={channel.id === channelId} unread={state.unread[channel.id] ?? 0} mentions={state.mentions[channel.id] ?? 0} onOpen={() => open(channel.id)} />
							),
						)}
					</div>
				))}
				{staff && !channels.some((c) => c.kind === 'voice') && (
					<button type='button' className='channel' style={{ border: 0, background: 'none' }} onClick={() => onCreateChannel('voice')}>
						<Icon name='plus' size={16} />
						<span className='channel-name'>Ajouter un salon vocal</span>
					</button>
				)}
			</nav>

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
					<CallControls voice={voice} />
				</div>
			)}

			<MeBar me={me} status={state.status} />

			<div
				className='sidebar-resize'
				role='separator'
				aria-orientation='vertical'
				aria-label='Redimensionner la barre latérale'
				aria-valuemin={MIN_WIDTH}
				aria-valuemax={MAX_WIDTH}
				aria-valuenow={width.width}
				tabIndex={0}
				data-active={width.dragging}
				onPointerDown={width.onPointerDown}
				onKeyDown={width.onKeyDown}
				onDoubleClick={width.reset}
				title='Glisser pour redimensionner, double-clic pour réinitialiser'
			/>
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
	speaking: Set<string> | null;
	onOpen: () => void;
	onJoin: () => void;
};

function VoiceChannelRow({ channel, active, unread, mentions, participants, members, speaking, onOpen, onJoin }: VoiceRowProps) {
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
								<span className='grow ellipsis'>{member?.name ?? 'Membre'}</span>
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

function MeBar({ me, status }: { me: Me; status: WorkspaceState['status'] }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	const label = status === 'live' ? 'En ligne' : status === 'connecting' ? 'Connexion…' : 'Hors ligne';
	return (
		<div className='me-bar' ref={ref} style={{ position: 'relative' }}>
			<Avatar name={me.user.name} url={me.user.avatarUrl} size={32} online={status === 'live'} />
			<span className='me-bar-name grow'>
				<span className='ellipsis'>{me.user.name}</span>
				<span>{label}</span>
			</span>
			<button type='button' className='icon-btn' aria-label='Menu du compte' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<Icon name='more' />
			</button>
			{open && (
				<div className='popover' role='menu' style={{ bottom: 'calc(100% + 4px)', right: 8 }}>
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
