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
import { DrivePanel } from './DrivePanel';
import { MembersPanel } from './MembersPanel';
import { MessageList } from './MessageList';
import { ResizeHandle, useResizable } from './resizable';
import type { Lookup } from './richText';
import { SearchPalette } from './SearchPalette';
import { CreateChannelDialog, SettingsDialog } from './SettingsDialog';
import { Sidebar } from './Sidebar';
import { useWorkspace } from './useWorkspace';
import { CallView, RemoteAudio } from './voice/CallView';
import { useVoice } from './voice/useVoice';

type Props = {
	me: Me;
	workspaceId: string;
	channelId: string | null;
	onMeChanged: () => Promise<unknown>;
};

type Panel = 'members' | 'drive' | null;

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

export function WorkspaceView({ me, workspaceId, channelId, onMeChanged }: Props) {
	const myId = me.user.id;
	const { state, dispatch, send, loadMessages, reloadInfo } = useWorkspace(workspaceId, myId, channelId);
	useDirectsLoader(workspaceId, state.connId, dispatch);
	const voice = useVoice({ workspaceId, connId: state.connId, myId, voice: state.voice, voiceEnded: state.voiceEnded, forceMuted: state.forceMuted, send });
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
	const [voiceChat, setVoiceChatState] = useState(() => readPref('voice_chat') !== '0' && window.innerWidth > 860);
	const [view, setView] = useState<ContentView>(null);
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
	const active = channels?.find((c) => c.id === channelId);
	const members = useMemo(() => new Map<string, Member>((state.info?.members ?? []).map((m) => [m.id, m])), [state.info]);
	const grades = state.info?.grades ?? [];
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

	const openChannel = useCallback(
		(id: string) => {
			setNavOpen(false);
			setView(null);
			navigate(`/w/${workspaceId}/${id}`);
		},
		[workspaceId],
	);

	const lookup: Lookup = useMemo(() => ({ members, channels: rooms, myId, openChannel }), [members, rooms, myId, openChannel]);

	useEffect(() => rememberWorkspace(workspaceId), [workspaceId]);

	useEffect(() => {
		const first = channels?.find((c) => c.kind === 'text') ?? channels?.[0];
		if (channels && !active && first) {
			navigate(`/w/${workspaceId}/${first.id}`, true);
		}
	}, [channels, active, workspaceId]);

	useEffect(() => setReplyTo(null), [channelId]);

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

	const sendMessage = async (body: string, attachmentKey?: string, reply?: number) => {
		if (!active) {
			return;
		}
		if (activeData?.hasNewer) {
			await loadMessages(active.id);
		}
		const message = await api<Message>('POST', `/w/${workspaceId}/channels/${active.id}/messages`, { body, attachmentKey, replyTo: reply });
		dispatch({ type: 'message', message });
	};

	const startDirect = async (userIds: string[], name = '') => {
		const { conversation, channel, perms } = await openDirect(workspaceId, userIds, name);
		dispatch({ type: 'dm_threads', update: upsertDirect(conversation) });
		if (!channels?.some((c) => c.id === channel.id)) {
			dispatch({ type: 'event', event: { t: 'channel_upsert', channel, perms }, activeChannelId: channelId, myId, focused });
		}
		setNewDirect(false);
		openChannel(channel.id);
	};

	const messagePane = active && (
			<>
				<MessageList
					key={`messages-${active.id}`}
					workspaceId={workspaceId}
					channel={shown!}
					data={activeData}
					lookup={lookup}
					canModerate={has(activePerms, P.MANAGE_MESSAGES)}
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
					onOpenThread={(id) => setThread({ channelId: active.id, id })}
					onEdit={async (id, body) => {
						await api('PATCH', `/w/${workspaceId}/messages/${id}`, { body });
					}}
					onDelete={async (id) => {
						await api('DELETE', `/w/${workspaceId}/messages/${id}`);
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
			</>
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
				onOpenSettings={() => setSettingsOpen(true)}
				onOpenSearch={() => setSearchOpen(true)}
				onNavigate={() => {
					setNavOpen(false);
					setView(null);
				}}
				onCreateChannel={setCreateKind}
				directs={
					<DirectSection
						state={state}
						channelId={channelId}
						members={members}
						myId={myId}
						view={view}
						onOpenView={(next) => {
							setView(next);
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
					{active && (
						<>
							<h1>
								<Icon name={view === 'dms' ? 'chat' : view === 'threads' ? 'thread' : active.kind === 'voice' ? 'speaker' : active.kind === 'dm' ? 'chat' : active.readOnly ? 'megaphone' : 'hash'} />
								<span className='ellipsis'>{view === 'dms' ? 'Messages directs' : view === 'threads' ? 'Fils' : shown!.name}</span>
							</h1>
							<p className='topbar-topic'>{view ? null : shown!.topic}</p>
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
					<button type='button' className='icon-btn' aria-pressed={panel === 'drive'} aria-label='Fichiers du salon' title='Fichiers du salon' onClick={() => setPanel(panel === 'drive' ? null : 'drive')}>
						<Icon name='drive' />
					</button>
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
						{view === 'dms' ? (
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
					{panel === 'members' && state.info && <MembersPanel members={state.info.members} grades={grades} online={state.online} voice={state.voice} myId={myId} onMessage={(id) => void startDirect([id]).catch(() => undefined)} onClose={() => setPanel(null)} />}
					{panel === 'drive' && active && (
						<DrivePanel workspaceId={workspaceId} channel={active} version={state.drive[active.id] ?? 0} members={members} myId={myId} perms={activePerms} onClose={() => setPanel(null)} />
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
					<NewDirectDialog open={newDirect} members={members} myId={myId} online={state.online} onClose={() => setNewDirect(false)} onSubmit={startDirect} />
					{activeDm?.group && (
						<GroupDialog
							open={groupOpen}
							workspaceId={workspaceId}
							conversation={activeDm}
							members={members}
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
