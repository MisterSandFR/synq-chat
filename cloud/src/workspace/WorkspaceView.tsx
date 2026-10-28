import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

import { P, has } from '../../shared/permissions';
import type { ChannelKind, Me, Member, Message } from '../../shared/types';
import { api } from '../api';
import { navigate, readPref, rememberWorkspace, writePref } from '../router';
import { Avatar, Icon, Logo } from '../ui';
import { Composer } from './Composer';
import {
	CallRing,
	channelLabel,
	DirectMessagesView,
	DirectSection,
	dismissRing,
	GroupDialog,
	NewDirectDialog,
	openDirect,
	ThreadPanel,
	ThreadsView,
	upsertDirect,
	useDirectsLoader,
	type ContentView,
} from './dm-threads';
import { AccessDialog } from './grade-access/AccessDialog';
import { DrivePanel } from './DrivePanel';
import { DraftsView, ScheduledBanner, useDraftsLoader } from './drafts';
import { MembersPanel } from './MembersPanel';
import { useMemberMenu } from './members/useMemberMenu';
import { MessageList } from './MessageList';
import { ActivityPanel } from './notifications/ActivityPanel';
import { openNotification, useBrowserNotifications } from './notifications/browser';
import { DropZone } from './media/DropZone';
import { PinsPanel } from './chat/PinsPanel';
import { ResizeHandle, useResizable } from './resizable';
import type { Lookup } from './richText';
import { SearchPalette } from './SearchPalette';
import { CreateChannelDialog, SettingsDialog } from './SettingsDialog';
import { Sidebar } from './Sidebar';
import { useWorkspace } from './useWorkspace';
import { CallView, RemoteAudio } from './voice/CallView';
import { useVoice } from './voice/useVoice';
import { AnnouncementBanner } from './rc/AnnouncementBanner';
import { DirectoryDialog } from './rc/DirectoryDialog';
import { ForwardDialog } from './rc/ForwardDialog';
import { ProfileCard } from './rc/ProfileCard';
import { ProfileDialog } from './rc/ProfileDialog';
import { SavedPanel } from './rc/SavedPanel';
import { StatusDialog, StatusMenuItems } from './rc/status';
import { presenceOf, useRc } from './rc/useRc';
import { CatchupBanner } from '../ai/CatchupBanner';

type Props = {
	me: Me;
	workspaceId: string;
	channelId: string | null;
	onMeChanged: () => Promise<unknown>;
	onBadges?: (badges: Record<string, number>) => void;
};

type Panel = 'members' | 'drive' | 'saved' | 'pins' | null;

function useFocused(): boolean {
	const [focused, setFocused] = useState(() => document.hasFocus());
	useEffect(() => {
		const update = () => setFocused(document.visibilityState === 'visible' && document.hasFocus());
		window.addEventListener('focus', update);
		window.addEventListener('blur', update);
		document.addEventListener('visibilitychange', update);
		return () => {
			window.removeEventListener('focus', update);
			window.removeEventListener('blur', update);
			document.removeEventListener('visibilitychange', update);
		};
	}, []);
	return focused;
}

export function WorkspaceView({ me, workspaceId, channelId, onMeChanged, onBadges }: Props) {
	const myId = me.user.id;
	const { state, dispatch, send, loadMessages, reloadInfo } = useWorkspace(workspaceId, myId, channelId);
	useDirectsLoader(workspaceId, state.connId, dispatch);
	const voice = useVoice({ workspaceId, connId: state.connId, myId, voice: state.voice, voiceEnded: state.voiceEnded, forceMuted: state.forceMuted, voiceMoved: state.voiceMoved, send });
	const width = useResizable({ pref: 'sidebar_width', min: 220, max: 520, initial: 280, edge: 'end' });
	const chatWidth = useResizable({ pref: 'voice_chat_width', min: 300, max: 720, initial: 380, edge: 'start' });
	const focused = useFocused();
	const [navOpen, setNavOpen] = useState(false);
	const [panel, setPanelState] = useState<Panel>(() => (readPref('panel') as Panel) || null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [createKind, setCreateKind] = useState<ChannelKind | null>(null);
	const [replyTo, setReplyTo] = useState<Message | null>(null);
	const [jump, setJump] = useState<{ channelId: string; id: number } | null>(null);
	const [highlight, setHighlight] = useState<number | null>(null);
	const rc = useRc(workspaceId, myId, state.info);
	const [card, setCard] = useState<{ userId: string; rect: DOMRect } | null>(null);
	const [rcDialog, setRcDialog] = useState<'status' | 'profile' | null>(null);
	const [announcing, setAnnouncing] = useState(false);
	const [copied, setCopied] = useState<number | null>(null);
	const [forwarding, setForwarding] = useState<Message | null>(null);
	const [directory, setDirectory] = useState(false);
	const myProfile = rc.profiles.get(myId);
	const [voiceChat, setVoiceChatState] = useState(() => readPref('voice_chat') !== '0' && window.innerWidth > 860);
	const [thread, setThread] = useState<{ channelId: string; id: number } | null>(null);
	const [newDirect, setNewDirect] = useState(false);
	const [groupOpen, setGroupOpen] = useState(false);

	const setVoiceChat = (open: boolean) => {
		setVoiceChatState(open);
		writePref('voice_chat', open ? '1' : '0');
	};

	const setPanel = (next: Panel) => {
		setPanelState(next);
		writePref('panel', next ?? '');
	};

	const channels = state.channels;
	useDraftsLoader(workspaceId, state.connId);
	const active = channels?.find((c) => c.id === channelId);
	// Pages de l'espace hors salon, ouvertes depuis la barre d'apps.
	const page = channelId === 'activite' ? 'activity' : channelId === 'messages' ? 'dms' : channelId === 'fils' ? 'threads' : channelId === 'brouillons' ? 'drafts' : null;
	const view: ContentView = page === 'dms' || page === 'threads' ? page : null;
	const openView = (next: Exclude<ContentView, null>) => navigate(`/w/${workspaceId}/${next === 'dms' ? 'messages' : 'fils'}`);
	const members = useMemo(() => new Map<string, Member>((state.info?.members ?? []).map((m) => [m.id, m])), [state.info]);
	const grades = state.info?.grades ?? [];
	const [accessOpen, setAccessOpen] = useState(false);
	const dms = state.dmThreads.dms;
	const rooms = useMemo(() => (channels ?? []).filter((c) => c.kind !== 'dm'), [channels]);
	const labelOf = (id: string) => channelLabel(channels?.find((c) => c.id === id), dms, members, myId);
	const activeDm = active?.kind === 'dm' ? dms?.find((d) => d.id === active.id) : undefined;
	// Un DM s'affiche sous le nom de ses participants.
	const shown = active?.kind === 'dm' ? { ...active, name: labelOf(active.id), topic: '' } : active;
	const activePerms = active ? (state.perms[active.id] ?? 0) : 0;
	const activeData = active ? state.messages[active.id] : undefined;
	const lastActiveId = activeData?.items.at(-1)?.id;
	const chatVisible = active?.kind === 'text' || active?.kind === 'dm' || (active?.kind === 'voice' && voiceChat);
	const huddle = active?.kind === 'dm' && ((state.voice[active.id]?.length ?? 0) > 0 || voice.snapshot?.channelId === active.id);
	const memberMenu = useMemberMenu({
		workspaceId,
		info: state.info ?? null,
		channels: channels ?? [],
		perms: state.perms,
		voice: state.voice,
		myId,
		mentionChannelId: active && (chatVisible || huddle) ? active.id : null,
		onProfile: (userId, rect) => setCard({ userId, rect }),
		onMessage: (userId) => void startDirect([userId]).catch(() => undefined),
		onChanged: () => reloadInfo().catch(() => undefined),
	});

	const openChannel = useCallback(
		(id: string) => {
			setNavOpen(false);
			navigate(`/w/${workspaceId}/${id}`);
		},
		[workspaceId],
	);

	const lookup: Lookup = useMemo(() => ({ members, channels: rooms, myId, openChannel }), [members, rooms, myId, openChannel]);

	const openMessage = useCallback(
		(cid: string, id: number) => {
			setJump({ channelId: cid, id });
			openChannel(cid);
		},
		[openChannel],
	);

	useBrowserNotifications(state.lastNotification, lookup, (item) => openNotification(item, openMessage));

	useEffect(() => rememberWorkspace(workspaceId), [workspaceId]);
	// Barre d'apps lue depuis /me : resynchronise après un changement d'identité poussé par members_changed.
	const summary = me.workspaces.find((w) => w.id === workspaceId);
	const info = state.info;
	const stale = Boolean(info && summary && (summary.name !== info.name || summary.accent !== info.accent || summary.logoUrl !== info.logoUrl));
	useEffect(() => {
		if (stale) {
			void onMeChanged();
		}
	}, [stale, onMeChanged]);

	const dmUnread = (channels ?? []).reduce((sum, c) => sum + (c.kind === 'dm' ? (state.unread[c.id] ?? 0) : 0), 0);
	useEffect(() => onBadges?.({ activity: state.notificationsUnread, dms: dmUnread }), [onBadges, state.notificationsUnread, dmUnread]);

	useEffect(() => {
		const first = channels?.find((c) => c.kind === 'text') ?? channels?.[0];
		if (channels && !active && !page && first) {
			navigate(`/w/${workspaceId}/${first.id}`, true);
		}
	}, [channels, active, workspaceId]);

	useEffect(() => setReplyTo(null), [channelId]);

	useEffect(() => setAnnouncing(false), [channelId]);

	// Lien permanent : ?m=<id> ouvre le message puis disparaît de l'URL.
	useEffect(() => {
		const target = Number(new URLSearchParams(location.search).get('m'));
		if (channelId && Number.isInteger(target) && target > 0) {
			setJump({ channelId, id: target });
			history.replaceState(history.state, '', location.pathname);
		}
	}, [channelId]);

	useEffect(() => {
		if (copied === null) {
			return;
		}
		const timer = setTimeout(() => setCopied(null), 1500);
		return () => clearTimeout(timer);
	}, [copied]);

	useEffect(() => {
		if (active && chatVisible && !state.messages[active.id] && state.status === 'live' && jump?.channelId !== active.id) {
			void loadMessages(active.id);
		}
	}, [active, chatVisible, state.messages, state.status, loadMessages, jump]);

	useEffect(() => {
		if (!jump || jump.channelId !== channelId || state.status !== 'live') {
			return;
		}
		const loaded = state.messages[jump.channelId]?.items.some((m) => m.id === jump.id);
		const show = () => {
			setHighlight(jump.id);
			setJump(null);
		};
		if (loaded) {
			show();
		} else {
			void loadMessages(jump.channelId, 'around', jump.id).then(show);
		}
	}, [jump, channelId, state.messages, state.status, loadMessages]);

	useEffect(() => {
		if (highlight === null) {
			return;
		}
		const timer = setTimeout(() => setHighlight(null), 2000);
		return () => clearTimeout(timer);
	}, [highlight]);

	useEffect(() => {
		if (active && chatVisible && focused && state.status === 'live' && !activeData?.hasNewer) {
			send({ t: 'read', channelId: active.id });
			dispatch({ type: 'read', channelId: active.id });
		}
	}, [active, chatVisible, focused, lastActiveId, state.status, activeData?.hasNewer, send, dispatch]);

	useEffect(() => {
		const unread = Object.values(state.unread).reduce((sum, n) => sum + n, 0);
		const mentions = Object.values(state.mentions).reduce((sum, n) => sum + n, 0);
		const badge = mentions ? `(${mentions}) ` : unread ? '• ' : '';
		document.title = `${badge}${shown ? `${shown.kind === 'text' ? '#' : ''}${shown.name} · ` : ''}${state.info?.name ?? 'Synq'}`;
	}, [state.unread, state.mentions, shown?.kind, shown?.name, state.info]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				setSearchOpen(true);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	if (state.closed) {
		return (
			<main className='center-screen'>
				<Logo />
				<div className='center-card'>
					<p>{state.closed}</p>
					<button
						type='button'
						className='btn btn-primary'
						onClick={() => {
							void onMeChanged();
							navigate('/espaces', true);
						}}
					>
						Retour à mes espaces
					</button>
				</div>
			</main>
		);
	}

	const typingNames = active
		? Object.entries(state.typing[active.id] ?? {})
				.filter(([, until]) => until > Date.now())
				.map(([id]) => members.get(id)?.name ?? 'Quelqu’un')
		: [];
	const onlineMembers = [...members.values()].filter((m) => state.online.has(m.id));
	const otherVoice = voice.snapshot && voice.snapshot.channelId !== active?.id ? channels?.find((c) => c.id === voice.snapshot!.channelId)?.name ?? null : null;

	const sendMessage = async (body: string, attachmentKeys: string[], reply?: number) => {
		if (!active) {
			return;
		}
		if (activeData?.hasNewer) {
			await loadMessages(active.id);
		}
		const message = await api<Message>('POST', `/w/${workspaceId}/channels/${active.id}/messages`, { body, attachmentKeys, replyTo: reply });
		dispatch({ type: 'message', message });
	};

	// Prestataires invités : la fenêtre reste ouverte pour montrer les liens.
	const startDirect = async (userIds: string[], name = '', gradeIds: string[] = [], guestEmails: string[] = []) => {
		const { conversation, channel, perms, guestInvites } = await openDirect(workspaceId, userIds, name, gradeIds, guestEmails);
		dispatch({ type: 'dm_threads', update: upsertDirect(conversation) });
		if (!channels?.some((c) => c.id === channel.id)) {
			dispatch({ type: 'event', event: { t: 'channel_upsert', channel, perms }, activeChannelId: channelId, myId, focused });
		}
		if (!guestInvites.length) {
			setNewDirect(false);
		}
		openChannel(channel.id);
		return guestInvites;
	};

	const messagePane = active && (
			<DropZone enabled={has(activePerms, P.ATTACH_FILES)}>
				{active.kind === 'text' && (
					<AnnouncementBanner
						key={`announce-${active.id}`}
						workspaceId={workspaceId}
						channelId={active.id}
						live={state.announcements[active.id]}
						canEdit={has(state.info?.perms ?? 0, P.MANAGE_CHANNELS)}
						editing={announcing}
						onEditing={setAnnouncing}
					/>
				)}
				<CatchupBanner
					key={`catchup-${active.id}`}
					workspaceId={workspaceId}
					channelId={active.id}
					unread={state.unread[active.id] ?? 0}
					data={activeData}
					onJump={(id) => setJump({ channelId: active.id, id })}
				/>
				<MessageList
					key={`messages-${active.id}`}
					workspaceId={workspaceId}
					channel={shown!}
					data={activeData}
					lookup={lookup}
					canModerate={has(activePerms, P.MANAGE_MESSAGES)}
					canReact={has(activePerms, P.ADD_REACTIONS)}
					canPin={has(activePerms, P.PIN_MESSAGES) || has(activePerms, P.MANAGE_MESSAGES)}
					grades={grades}
					highlightId={highlight}
					onLoadOlder={() => activeData?.items[0] && void loadMessages(active.id, 'older', activeData.items[0].id)}
					onLoadNewer={() => {
						const last = activeData?.items.at(-1);
						if (last) {
							void loadMessages(active.id, 'newer', last.id);
						}
					}}
					onJumpLatest={() => void loadMessages(active.id)}
					onJumpTo={(id) => setJump({ channelId: active.id, id })}
					onReply={setReplyTo}
					onAuthor={(userId, anchor) => setCard({ userId, rect: anchor.getBoundingClientRect() })}
					authorMenu={memberMenu.items}
					extraActions={(message) => {
						const saved = rc.savedIds.has(message.id);
						return (
							<>
								<button
									type='button'
									className='icon-btn icon-btn-sm'
									aria-label='Copier le lien'
									title={copied === message.id ? 'Lien copié' : 'Copier le lien'}
									onClick={() =>
										void navigator.clipboard
											.writeText(`${location.origin}/w/${workspaceId}/${message.channelId}?m=${message.id}`)
											.then(() => setCopied(message.id))
											.catch(() => undefined)
									}
								>
									<Icon name={copied === message.id ? 'check' : 'link'} size={16} />
								</button>
								<button type='button' className='icon-btn icon-btn-sm' aria-label='Transférer' title='Transférer' onClick={() => setForwarding(message)}>
									<Icon name='arrow' size={16} />
								</button>
								<button
								type='button'
								className={`icon-btn icon-btn-sm${saved ? ' is-saved' : ''}`}
								aria-pressed={saved}
								aria-label={saved ? 'Retirer des enregistrés' : 'Enregistrer'}
								title={saved ? 'Retirer des enregistrés' : 'Enregistrer'}
								onClick={() => void rc.toggleSaved(message).catch(() => undefined)}
							>
									<Icon name='bookmark' size={16} />
								</button>
							</>
						);
					}}
					onOpenThread={(id) => setThread({ channelId: active.id, id })}
					onEdit={async (id, body) => {
						await api('PATCH', `/w/${workspaceId}/messages/${id}`, { body });
					}}
					onDelete={async (id) => {
						await api('DELETE', `/w/${workspaceId}/messages/${id}`);
					}}
					onReact={async (id, emoji, add) => {
						await api(add ? 'PUT' : 'DELETE', `/w/${workspaceId}/messages/${id}/reactions/${encodeURIComponent(emoji)}`);
					}}
					onPin={async (id, pinned) => {
						await api(pinned ? 'PUT' : 'DELETE', `/w/${workspaceId}/messages/${id}/pin`);
					}}
				/>
				<div className='typing' aria-live='polite'>
					{typingNames.length > 0 && (
						<>
							<span className='typing-dots' aria-hidden>
								<span />
								<span />
								<span />
							</span>
							{typingNames.length === 1 && `${typingNames[0]} écrit`}
							{typingNames.length === 2 && `${typingNames[0]} et ${typingNames[1]} écrivent`}
							{typingNames.length > 2 && 'Plusieurs personnes écrivent'}
						</>
					)}
				</div>
				<ScheduledBanner channelId={active.id} onOpen={() => openChannel('brouillons')} />
				<Composer
					key={`composer-${active.id}`}
					workspaceId={workspaceId}
					channel={shown!}
					canPost={has(activePerms, P.SEND_MESSAGES)}
					canAttach={has(activePerms, P.ATTACH_FILES)}
					lookup={lookup}
					replyTo={replyTo}
					onCancelReply={() => setReplyTo(null)}
					onSend={sendMessage}
					onTyping={() => send({ t: 'typing', channelId: active.id })}
				/>
			</DropZone>
	);

	return (
		<div className={`app themed${navOpen ? ' nav-open' : ''}`} style={{ '--accent': state.info?.accent ?? '#6A4BFF' } as CSSProperties}>
			<Sidebar
				me={me}
				workspaceId={workspaceId}
				state={state}
				channelId={channelId}
				members={members}
				voice={voice}
				width={width}
				memberMenu={memberMenu}
				onOpenSettings={() => setSettingsOpen(true)}
				onOpenSearch={() => setSearchOpen(true)}
				onNavigate={() => setNavOpen(false)}
				onCreateChannel={setCreateKind}
				presence={myProfile && presenceOf(myProfile, true)}
				presenceText={myProfile?.statusText}
				meMenu={(close) => (
					<StatusMenuItems
						current={myProfile?.status}
						onPick={(status) => {
							close();
							void rc.updateProfile({ status }).catch(() => undefined);
						}}
						onCustom={() => {
							close();
							setRcDialog('status');
						}}
						onProfile={() => {
							close();
							setRcDialog('profile');
						}}
					/>
				)}
				directs={
					<DirectSection
						state={state}
						channelId={channelId}
						members={members}
						myId={myId}
						view={view}
						onOpenView={(next) => {
							openView(next);
							setNavOpen(false);
						}}
						onOpenDirect={openChannel}
						onNewDirect={() => setNewDirect(true)}
					/>
				}
			/>

			<main className='main'>
				<header className='topbar'>
					<button type='button' className='icon-btn only-mobile' aria-label='Salons' onClick={() => setNavOpen(!navOpen)}>
						<Icon name='menu' />
					</button>
					{page && (
						<h1>
							<Icon name={page === 'activity' ? 'bell' : page === 'dms' ? 'chat' : page === 'drafts' ? 'compose' : 'thread'} />
							<span className='ellipsis'>{page === 'activity' ? 'Activité' : page === 'dms' ? 'Messages directs' : page === 'drafts' ? 'Brouillons et envois' : 'Fils'}</span>
						</h1>
					)}
					{active && (
						<>
							<h1>
								<Icon name={active.kind === 'voice' ? 'speaker' : active.kind === 'dm' ? 'chat' : active.readOnly ? 'megaphone' : 'hash'} />
								<span className='ellipsis'>{shown!.name}</span>
							</h1>
							<p className='topbar-topic'>{shown!.topic}</p>
						</>
					)}
					<span className='grow' />
					<button type='button' className='facepile hide-mobile' aria-pressed={panel === 'members'} aria-label={`${onlineMembers.length} membres en ligne`} onClick={() => setPanel(panel === 'members' ? null : 'members')}>
						<span className='facepile-stack'>
							{onlineMembers.slice(0, 3).map((m) => (
								<Avatar key={m.id} name={m.name} url={m.avatarUrl} size={26} />
							))}
						</span>
						{onlineMembers.length} en ligne
					</button>
					<button type='button' className='icon-btn only-mobile' aria-pressed={panel === 'members'} aria-label='Membres' onClick={() => setPanel(panel === 'members' ? null : 'members')}>
						<Icon name='users' />
					</button>
					{active?.kind === 'voice' && (
						<button type='button' className='icon-btn' aria-pressed={voiceChat} aria-label='Chat du salon vocal' title='Chat du salon vocal' onClick={() => setVoiceChat(!voiceChat)}>
							<Icon name='chat' />
							{!voiceChat && (state.unread[active.id] ?? 0) > 0 && <span className='dot' style={{ marginLeft: -6, marginTop: -14 }} />}
						</button>
					)}
					{!view && active?.kind === 'dm' && voice.snapshot?.channelId !== active.id && (
						<button type='button' className='btn dm-call-btn' onClick={() => void voice.join(active.id)}>
							<Icon name='headphones' size={16} /> Appeler
						</button>
					)}
					{!view && activeDm?.group && (
						<button type='button' className='icon-btn' aria-label='Participants du groupe' title='Participants du groupe' onClick={() => setGroupOpen(true)}>
							<Icon name='users' />
						</button>
					)}
					{active && (
						<button type='button' className='icon-btn' aria-pressed={panel === 'pins'} aria-label='Messages épinglés' title='Messages épinglés' onClick={() => setPanel(panel === 'pins' ? null : 'pins')}>
							<Icon name='pin' />
						</button>
					)}
					{active && active.kind !== 'dm' && has(state.info?.perms ?? 0, P.MANAGE_CHANNELS) && (
						<button type='button' className='icon-btn' aria-label='Gérer l’accès' title='Gérer l’accès' onClick={() => setAccessOpen(true)}>
							<Icon name='shield' />
						</button>
					)}
					{active?.kind === 'text' && has(state.info?.perms ?? 0, P.MANAGE_CHANNELS) && (
						<button type='button' className='icon-btn hide-mobile' aria-pressed={announcing} aria-label='Annonce du salon' title='Annonce du salon' onClick={() => setAnnouncing(!announcing)}>
							<Icon name='megaphone' />
						</button>
					)}
					<button type='button' className='icon-btn hide-mobile' aria-label='Annuaire' title='Annuaire' onClick={() => setDirectory(true)}>
						<Icon name='list' />
					</button>
					<button type='button' className='icon-btn' aria-pressed={panel === 'saved'} aria-label='Messages enregistrés' title='Messages enregistrés' onClick={() => setPanel(panel === 'saved' ? null : 'saved')}>
						<Icon name='bookmark' />
					</button>
					{active && (
						<button type='button' className='icon-btn' aria-pressed={panel === 'drive'} aria-label='Fichiers du salon' title='Fichiers du salon' onClick={() => setPanel(panel === 'drive' ? null : 'drive')}>
							<Icon name='drive' />
						</button>
					)}
					<button type='button' className='icon-btn' aria-label='Rechercher' title='Rechercher (Ctrl K)' onClick={() => setSearchOpen(true)}>
						<Icon name='search' />
					</button>
				</header>

				{state.status === 'offline' && <p className='banner'>Connexion perdue. Reconnexion en cours…</p>}
				<CallRing
					ring={voice.snapshot?.channelId === state.dmThreads.ring?.channelId ? null : state.dmThreads.ring}
					members={members}
					label={labelOf}
					onJoin={(cid) => {
						dispatch({ type: 'dm_threads', update: dismissRing });
						openChannel(cid);
						void voice.join(cid);
					}}
					onDismiss={() => dispatch({ type: 'dm_threads', update: dismissRing })}
				/>

				<div className='body'>
					<div className='content'>
						{page === 'activity' ? (
							<ActivityPanel
								workspaceId={workspaceId}
								channels={channels ?? []}
								members={members}
								unread={state.notificationsUnread}
								version={state.notificationsVersion}
								onOpenMessage={openMessage}
								/>
						) : page === 'drafts' ? (
							<DraftsView
								workspaceId={workspaceId}
								connId={state.connId}
								lookup={lookup}
								channelLabel={labelOf}
								onOpenChannel={openChannel}
								onOpenMessage={openMessage}
								onOpenThread={(cid, id) => {
									openChannel(cid);
									setThread({ channelId: cid, id });
								}}
							/>
						) : view === 'dms' ? (
							<DirectMessagesView state={state} lookup={lookup} onOpen={openChannel} onNew={() => setNewDirect(true)} />
						) : view === 'threads' ? (
							<ThreadsView
								workspaceId={workspaceId}
								connId={state.connId}
								lookup={lookup}
								channelLabel={labelOf}
								onOpen={(cid, id) => {
									openChannel(cid);
									setThread({ channelId: cid, id });
								}}
							/>
						) : !active ? (
							<div className='spinner' aria-busy />
						) : active.kind === 'voice' || huddle ? (
							<div className='call-layout'>
								<CallView
									workspaceId={workspaceId}
									channel={shown!}
									participants={state.voice[active.id] ?? []}
									members={members}
									grades={grades}
									perms={activePerms}
									myId={myId}
									voice={voice}
									otherChannelName={otherVoice}
									moveTargets={channels?.filter((c) => c.kind === 'voice' && c.id !== active.id) ?? []}
									memberMenu={memberMenu.items}
								/>
								{(voiceChat || huddle) && (
									<aside className='call-chat' style={{ width: chatWidth.width }} aria-label={`Chat de ${active.name}`}>
										<ResizeHandle resize={chatWidth} label='Redimensionner le chat' />
										{messagePane}
									</aside>
								)}
							</div>
						) : (
							messagePane
						)}
					</div>
					{panel === 'members' && state.info && <MembersPanel members={state.info.members} grades={grades} online={state.online} voice={state.voice} myId={myId} onMessage={(id) => void startDirect([id]).catch(() => undefined)} menu={memberMenu.items} onClose={() => setPanel(null)} />}
					{panel === 'drive' && active && (
						<DrivePanel workspaceId={workspaceId} channel={active} version={state.drive[active.id] ?? 0} members={members} myId={myId} perms={activePerms} onClose={() => setPanel(null)} />
					)}
					{panel === 'saved' && (
						<SavedPanel
							saved={rc.saved}
							lookup={lookup}
							onOpen={(cid, id) => {
								setJump({ channelId: cid, id });
								openChannel(cid);
							}}
							onRemove={(message) => void rc.toggleSaved(message).catch(() => undefined)}
							onClose={() => setPanel(null)}
						/>
					)}
					{panel === 'pins' && active && (
						<PinsPanel
							workspaceId={workspaceId}
							channel={active}
							version={state.pins[active.id] ?? 0}
							lookup={lookup}
							canPin={has(activePerms, P.PIN_MESSAGES) || has(activePerms, P.MANAGE_MESSAGES)}
							onJump={(id) => setJump({ channelId: active.id, id })}
							onClose={() => setPanel(null)}
						/>
					)}
					{view === null && thread && shown && thread.channelId === shown.id && (
						<ThreadPanel
							workspaceId={workspaceId}
							connId={state.connId}
							channel={shown}
							channelName={labelOf(shown.id)}
							rootId={thread.id}
							state={state}
							dispatch={dispatch}
							lookup={lookup}
							grades={grades}
							canPost={has(activePerms, P.SEND_MESSAGES)}
							onClose={() => setThread(null)}
						/>
					)}
				</div>
			</main>

			{navOpen && <button type='button' className='scrim' aria-label='Fermer le menu' onClick={() => setNavOpen(false)} />}

			<RemoteAudio voice={voice} />
			{memberMenu.node}

			{card && (
				<ProfileCard
					key={card.userId}
					member={members.get(card.userId)}
					profile={rc.profiles.get(card.userId)}
					online={state.online.has(card.userId)}
					grades={grades}
					myId={myId}
					rect={card.rect}
					onClose={() => setCard(null)}
					onEdit={() => {
						setCard(null);
						setRcDialog('profile');
					}}
				/>
			)}
			<ForwardDialog
				workspaceId={workspaceId}
				message={forwarding}
				targets={channels ?? []}
				lookup={lookup}
				onClose={() => setForwarding(null)}
				onSent={(sent) => {
					setForwarding(null);
					setJump({ channelId: sent.channelId, id: sent.id });
					openChannel(sent.channelId);
				}}
			/>
			<DirectoryDialog
				open={directory}
				channels={channels ?? []}
				members={state.info?.members ?? []}
				myId={myId}
				onClose={() => setDirectory(false)}
				onOpenChannel={openChannel}
				onMessage={(id) => void startDirect([id]).catch(() => undefined)}
			/>
			<StatusDialog open={rcDialog === 'status'} onClose={() => setRcDialog(null)} profile={myProfile} onSave={rc.updateProfile} />
			<ProfileDialog open={rcDialog === 'profile'} onClose={() => setRcDialog(null)} me={me} profile={myProfile} onSave={rc.updateProfile} onAvatarChanged={onMeChanged} />

			{state.info && channels && (
				<>
					<SettingsDialog
						open={settingsOpen}
						onClose={() => setSettingsOpen(false)}
						info={state.info}
						channels={rooms}
						myId={myId}
						onChanged={async () => {
							await reloadInfo().catch(() => undefined);
							await onMeChanged();
						}}
					/>
					<CreateChannelDialog workspaceId={workspaceId} kind={createKind} onClose={() => setCreateKind(null)} />
					<NewDirectDialog open={newDirect} members={members} grades={grades} myId={myId} online={state.online} onClose={() => setNewDirect(false)} onSubmit={startDirect} />
					{accessOpen && active && active.kind !== 'dm' && state.info && <AccessDialog info={state.info} channel={active} onClose={() => setAccessOpen(false)} />}
					{activeDm?.group && (
						<GroupDialog
							open={groupOpen}
							workspaceId={workspaceId}
							conversation={activeDm}
							members={members}
							grades={grades}
							myId={myId}
							online={state.online}
							onClose={() => setGroupOpen(false)}
							onChanged={(conversation) => {
								if (conversation) {
									dispatch({ type: 'dm_threads', update: upsertDirect(conversation) });
								} else {
									setGroupOpen(false);
								}
							}}
						/>
					)}
					<SearchPalette
						open={searchOpen}
						onClose={() => setSearchOpen(false)}
						workspaceId={workspaceId}
						channels={rooms}
						lookup={lookup}
						onOpenChannel={openChannel}
						onOpenMessage={(cid, id) => {
							setJump({ channelId: cid, id });
							openChannel(cid);
						}}
					/>
				</>
			)}
		</div>
	);
}
