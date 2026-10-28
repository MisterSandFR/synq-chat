import { createContext, useContext, useRef, useState, type ReactNode } from 'react';

import { isSpaceEmoji } from '../../shared/categories';
import { Floating } from '../floating';
import { PRESENCE_LABEL, type Presence } from '../../shared/rc';

import { P, has } from '../../shared/permissions';
import type { Channel, Grade, Me, Member, VoiceParticipant } from '../../shared/types';
import { api } from '../api';
import { navigate, readPref, writePref } from '../router';
import { Avatar, Icon, SpaceLogo, useDismiss, type IconName } from '../ui';
import { CategoryNav } from './categories/CategoryNav';
import { CustomEmojiImg, customOf, type EmojiMap } from './emojis/customEmojis';
import { memberColor, memberGrades } from './grades';
import { ResizeHandle, type Resizable } from './resizable';
import { CallControls } from './voice/CallView';
import { useContextMenu } from './ContextMenu';
import { DraftMark, DraftsNavLink } from './drafts/Marks';
import { ThreadsNavLink } from './dm-threads';
import { PagesSection } from './canvas/PageTree';
import { FavoritesSection } from './favorites/FavoritesSection';
import { useFavoritesLoader } from './favorites/store';
import { voiceDrag, type MemberMenu } from './members/useMemberMenu';
import type { VoiceControls } from './voice/useVoice';
import type { WorkspaceState } from './useWorkspace';
import './sidebar.css';

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
	memberMenu?: MemberMenu;
	emojis?: EmojiMap;
};

export function Sidebar({ me, workspaceId, state, channelId, members, voice, width, onOpenSettings, onOpenSearch, onNavigate, onCreateChannel, presence, presenceText, meMenu, directs, memberMenu, emojis }: Props) {
	const staff = has(state.info?.perms ?? 0, P.MANAGE_CHANNELS);
	const grades = state.info?.grades ?? [];
	const channels = state.channels ?? [];
	const connectedChannel = voice.snapshot ? channels.find((c) => c.id === voice.snapshot!.channelId) : undefined;
	const canScreen = voice.snapshot?.status === 'connected' && has(state.perms[voice.snapshot.channelId] ?? 0, P.VOICE_SCREEN);
	useFavoritesLoader(workspaceId, state.connId);
	const pageActive = (slug: string) => location.pathname === `/w/${workspaceId}/${slug}`;

	const open = (id: string) => {
		onNavigate();
		navigate(`/w/${workspaceId}/${id}`);
	};

	return (
		<TileEmojis.Provider value={emojis}>
		<aside className='sidebar' style={{ width: width.width }} aria-label='Navigation de l’espace'>
			<div className='sidebar-top sb-head'>
				<WorkspaceSwitcher me={me} workspaceId={workspaceId} name={state.info?.name ?? ''} accent={state.info?.accent} logoUrl={state.info?.logoUrl} memberCount={members.size} />
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
				header={
					<>
						<div className='nav-section sb-links'>
							<ThreadsNavLink active={channelId === 'fils'} unread={state.dmThreads.unreadThreads} onOpen={() => open('fils')} />
							<DraftsNavLink active={channelId === 'brouillons'} onOpen={() => open('brouillons')} />
							<SideLink icon='list' label='Listes' active={pageActive('listes')} onOpen={() => open('listes')} />
						</div>
						<PagesSection workspaceId={workspaceId} activeId={location.pathname.match(/^\/w\/[\w-]+\/(?:canevas|pages)\/([\w-]+)/)?.[1] ?? null} pagesActive={pageActive('canevas') || pageActive('pages')} />
						<FavoritesSection
							workspaceId={workspaceId}
							state={state}
							channelId={channelId}
							members={members}
							myId={me.user.id}
							onNavigate={onNavigate}
							renderChannel={(channel) => (
								<TextChannelRow channel={channel} active={channel.id === channelId} unread={state.unread[channel.id] ?? 0} mentions={state.mentions[channel.id] ?? 0} onOpen={() => open(channel.id)} />
							)}
						/>
					</>
				}
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
							memberMenu={memberMenu}
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

			{(staff || canScreen) && (
				<div className='sb-quick'>
					{staff && (
						<button type='button' className='sb-quick-btn' onClick={() => onCreateChannel('text')}>
							<Icon name='plus' size={15} strokeWidth={2} /> Créer un salon
						</button>
					)}
					{canScreen && (
						<button type='button' className='sb-quick-btn' aria-pressed={voice.snapshot!.screen} onClick={voice.toggleScreen}>
							<Icon name={voice.snapshot!.screen ? 'screen-off' : 'screen'} size={15} /> {voice.snapshot!.screen ? 'Arrêter' : 'Partager l’écran'}
						</button>
					)}
				</div>
			)}

			<MeBar me={me} status={state.status} presence={presence} presenceText={presenceText} menu={meMenu} />

			<ResizeHandle resize={width} label='Redimensionner la barre latérale' />
		</aside>
		</TileEmojis.Provider>
	);
}

function SideLink({ icon, label, active, onOpen }: { icon: IconName; label: string; active: boolean; onOpen: () => void }) {
	return (
		<button type='button' className='channel dm-nav-btn sb-link-minor' aria-current={active ? 'page' : undefined} onClick={onOpen}>
			<span className='channel-icon'>
				<Icon name={icon} size={15} />
			</span>
			<span className='channel-name'>{label}</span>
		</button>
	);
}

function TextChannelRow({ channel, active, unread, mentions, onOpen }: { channel: Channel; active: boolean; unread: number; mentions: number; onOpen: () => void }) {
	const showUnread = !active && unread > 0;
	return (
		<a
			href={`#${channel.id}`}
			className={`channel sb-pill${showUnread ? ' channel-unread' : ''}`}
			aria-current={active ? 'page' : undefined}
			onClick={(e) => {
				e.preventDefault();
				onOpen();
			}}
		>
			<ChannelTile channel={channel} />
			<span className='channel-name'>{channel.name}</span>
			{!active && <DraftMark channelId={channel.id} />}
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
	memberMenu?: MemberMenu;
};

const TileEmojis = createContext<EmojiMap | undefined>(undefined);

// Emoji d'espace supprimé : icône du type.
function ChannelTile({ channel }: { channel: Channel }) {
	const map = useContext(TileEmojis);
	const custom = channel.icon && isSpaceEmoji(channel.icon) ? customOf(channel.icon, map) : undefined;
	const emoji = channel.icon && !isSpaceEmoji(channel.icon) ? channel.icon : '';
	return (
		<span className='sb-tile' aria-hidden>
			{custom ? (
				<CustomEmojiImg emoji={custom} className='sb-tile-custom' />
			) : emoji ? (
				<span className='sb-tile-emoji'>{emoji}</span>
			) : (
				<Icon name={channel.kind === 'voice' ? 'speaker' : channel.readOnly ? 'megaphone' : 'hash'} size={15} />
			)}
		</span>
	);
}

const foldKey = (channelId: string) => `voice_folded_${channelId}`;

function VoiceChannelRow({ channel, active, unread, mentions, participants, members, grades, speaking, onOpen, onJoin, memberMenu }: VoiceRowProps) {
	const ctx = useContextMenu();
	const [over, setOver] = useState(false);
	const [folded, setFolded] = useState(() => readPref(foldKey(channel.id)) === '1');
	const droppable = () => Boolean(memberMenu && voiceDrag.userId && memberMenu.canMove(voiceDrag.userId, channel.id));
	const fold = () => {
		writePref(foldKey(channel.id), folded ? '0' : '1');
		setFolded(!folded);
	};
	return (
		<div className={`sb-voice${participants.length > 0 ? ' sb-voice-foldable' : ''}`}>
			<a
				href={`#${channel.id}`}
				className={`channel sb-pill${over ? ' channel-drop' : ''}${!active && unread > 0 ? ' channel-unread' : ''}`}
				onDragOver={(e) => {
					if (droppable()) {
						e.preventDefault();
						e.stopPropagation();
						e.dataTransfer.dropEffect = 'move';
						setOver(true);
					}
				}}
				onDragLeave={() => setOver(false)}
				onDrop={(e) => {
					const userId = voiceDrag.userId;
					setOver(false);
					if (userId && droppable()) {
						e.preventDefault();
						e.stopPropagation();
						voiceDrag.userId = null;
						memberMenu!.move(userId, channel.id);
					}
				}}
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
				<ChannelTile channel={channel} />
				<span className='channel-name'>{channel.name}</span>
				{!active && mentions > 0 ? <span className='pill'>{mentions > 99 ? '99+' : mentions}</span> : !active && unread > 0 && <span className='dot' aria-label='Messages non lus' />}
				{(participants.length > 0 || channel.userLimit > 0) && (
					<span className='sb-count' title={channel.userLimit > 0 ? `${participants.length} sur ${channel.userLimit} places` : `${participants.length} en vocal`}>
						{participants.length}
						{channel.userLimit > 0 && `/${channel.userLimit}`}
					</span>
				)}
			</a>
			{participants.length > 0 && (
				<button type='button' className='sb-fold' aria-expanded={!folded} aria-label={folded ? `Afficher les participants de ${channel.name}` : `Masquer les participants de ${channel.name}`} onClick={fold}>
					<Icon name='chevron' size={14} strokeWidth={2.2} />
				</button>
			)}
			{participants.length > 0 && !folded && (
				<ul className='sb-users'>
					{participants.map((p) => {
						const member = members.get(p.userId);
						const badges = memberGrades(member, grades)
							.filter((g) => g.color)
							.slice(0, 3);
						return (
							<li
								key={p.userId}
								className={`sb-user${speaking?.has(p.userId) ? ' sb-user-speaking' : ''}`}
								{...(memberMenu ? ctx.bind(() => memberMenu.items(p.userId)) : {})}
								draggable={memberMenu?.canDrag(p.userId) || undefined}
								onDragStart={(e) => {
									// Hors du glisser des salons de CategoryNav.
									e.stopPropagation();
									voiceDrag.userId = p.userId;
									e.dataTransfer.effectAllowed = 'move';
									e.dataTransfer.setData('text/plain', member?.name ?? p.userId);
								}}
								onDragEnd={(e) => {
									e.stopPropagation();
									voiceDrag.userId = null;
								}}
							>
								<Avatar name={member?.name ?? '?'} url={member?.avatarUrl} size={24} />
								<span className='sb-user-name' style={{ color: memberColor(member, grades) }}>
									{member?.name ?? 'Membre'}
								</span>
								<span className='sb-user-state'>
									{p.screen && <span className='sb-live'>En direct</span>}
									{p.video && (
										<span title='Caméra active' style={{ display: 'inline-grid' }}>
											<Icon name='video' size={14} />
										</span>
									)}
									{p.deafened ? (
										<span className='sb-off' title='Son coupé'>
											<Icon name='headphones-off' size={14} />
										</span>
									) : (
										p.muted && (
											<span className='sb-off' title='Micro coupé'>
												<Icon name='mic-off' size={14} />
											</span>
										)
									)}
								</span>
								{badges.length > 0 && (
									<span className='sb-grades'>
										{badges.map((g) => (
											<span key={g.id} className='sb-grade' style={{ background: g.color }} title={g.name} />
										))}
									</span>
								)}
							</li>
						);
					})}
				</ul>
			)}
			{ctx.menu}
		</div>
	);
}

function WorkspaceSwitcher({ me, workspaceId, name, accent, logoUrl, memberCount }: { me: Me; workspaceId: string; name: string; accent?: string; logoUrl?: string | null; memberCount: number }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	return (
		<div className='switcher' ref={ref}>
			<button type='button' className='switcher-btn' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<SpaceLogo name={name} accent={accent} url={logoUrl} size={38} />
				<span className='sb-head-text'>
					<span className='switcher-name'>{name}</span>
					{memberCount > 0 && <span className='sb-head-sub'>{memberCount > 1 ? `${memberCount} membres` : '1 membre'}</span>}
				</span>
				<Icon name='chevron' size={16} />
			</button>
			{open && (
				<Floating anchor={ref} placement='bottom-start' className='popover' role='menu' style={{ width: 280 }}>
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
							<SpaceLogo name={w.name} accent={w.accent} url={w.logoUrl} size={26} />
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
				</Floating>
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
				<Floating anchor={ref} placement='top-end' className='popover' role='menu'>
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
				</Floating>
			)}
		</div>
	);
}
