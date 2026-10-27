import { useCallback, useEffect, useReducer, useRef } from 'react';

import { mentionedUsers, type Channel, type ClientEvent, type Message, type MessagePage, type ServerEvent, type VoiceParticipant, type WorkspaceDetail } from '../../shared/types';
import { everyoneMentions } from '../../shared/rc';
import { api } from '../api';

export interface ChannelMessages {
	items: Message[];
	hasMore: boolean;
	hasNewer: boolean;
	loading: boolean;
}

export interface WorkspaceState {
	info: WorkspaceDetail | null;
	connId: string | null;
	channels: Channel[] | null;
	perms: Record<string, number>;
	unread: Record<string, number>;
	mentions: Record<string, number>;
	online: Set<string>;
	voice: Record<string, VoiceParticipant[]>;
	messages: Record<string, ChannelMessages>;
	typing: Record<string, Record<string, number>>;
	drive: Record<string, number>;
	voiceEnded: { reason: string; at: number } | null;
	forceMuted: { by: string; at: number } | null;
	announcements: Record<string, string>;
	status: 'connecting' | 'live' | 'offline';
	closed: string | null;
}

export type PageMode = 'latest' | 'older' | 'newer' | 'around';

type Action =
	| { type: 'info'; info: WorkspaceDetail }
	| { type: 'event'; event: ServerEvent; activeChannelId: string | null; myId: string; focused: boolean }
	| { type: 'status'; status: WorkspaceState['status'] }
	| { type: 'closed'; reason: string }
	| { type: 'loading'; channelId: string }
	| { type: 'page'; channelId: string; page: MessagePage; mode: PageMode }
	| { type: 'message'; message: Message }
	| { type: 'read'; channelId: string }
	| { type: 'typing_expire'; now: number };

const TYPING_TTL = 4000;

const initial: WorkspaceState = {
	info: null,
	connId: null,
	channels: null,
	perms: {},
	unread: {},
	mentions: {},
	online: new Set(),
	voice: {},
	messages: {},
	typing: {},
	drive: {},
	voiceEnded: null,
	forceMuted: null,
	announcements: {},
	status: 'connecting',
	closed: null,
};

const sortChannels = (channels: Channel[]) =>
	[...channels].sort(
		(a, b) => Number(a.kind === 'voice') - Number(b.kind === 'voice') || a.category.localeCompare(b.category) || a.position - b.position || a.name.localeCompare(b.name),
	);

function withMessage(state: WorkspaceState, message: Message, mode: 'add' | 'update'): WorkspaceState {
	const current = state.messages[message.channelId];
	if (!current) {
		return state;
	}
	const index = current.items.findIndex((m) => m.id === message.id);
	if (index >= 0) {
		const items = [...current.items];
		items[index] = message;
		return { ...state, messages: { ...state.messages, [message.channelId]: { ...current, items } } };
	}
	// Fenêtre ancienne affichée : le nouveau message arrivera avec la page suivante.
	if (mode === 'update' || current.hasNewer) {
		return state;
	}
	return { ...state, messages: { ...state.messages, [message.channelId]: { ...current, items: [...current.items, message] } } };
}

function onEvent(state: WorkspaceState, action: Extract<Action, { type: 'event' }>): WorkspaceState {
	const { event } = action;
	switch (event.t) {
		case 'hello':
			return {
				...state,
				connId: event.connId,
				channels: sortChannels(event.channels),
				perms: event.perms,
				unread: event.unread,
				mentions: event.mentions,
				online: new Set(event.online),
				voice: event.voice,
				messages: {},
				status: 'live',
			};
		case 'message': {
			const next = withMessage(state, event.message, 'add');
			const { channelId, userId } = event.message;
			const typingInChannel = state.typing[channelId];
			const typing = typingInChannel?.[userId] ? { ...state.typing, [channelId]: { ...typingInChannel, [userId]: 0 } } : state.typing;
			if (userId === action.myId || (channelId === action.activeChannelId && action.focused)) {
				return { ...next, typing };
			}
			// @all ou @here sans la permission : compteur corrigé au prochain hello.
			const mentioned = mentionedUsers(event.message.body).includes(action.myId) || everyoneMentions(event.message.body).size > 0;
			return {
				...next,
				typing,
				unread: { ...state.unread, [channelId]: (state.unread[channelId] ?? 0) + 1 },
				mentions: mentioned ? { ...state.mentions, [channelId]: (state.mentions[channelId] ?? 0) + 1 } : state.mentions,
			};
		}
		case 'message_updated':
			return withMessage(state, event.message, 'update');
		case 'message_deleted': {
			const current = state.messages[event.channelId];
			if (!current) {
				return state;
			}
			return { ...state, messages: { ...state.messages, [event.channelId]: { ...current, items: current.items.filter((m) => m.id !== event.id) } } };
		}
		case 'channel_upsert':
			return {
				...state,
				channels: sortChannels([...(state.channels ?? []).filter((c) => c.id !== event.channel.id), event.channel]),
				perms: { ...state.perms, [event.channel.id]: event.perms },
			};
		case 'access': {
			const visible = new Set(event.channels.map((c) => c.id));
			const messages = Object.fromEntries(Object.entries(state.messages).filter(([id]) => visible.has(id)));
			return { ...state, channels: sortChannels(event.channels), perms: event.perms, unread: event.unread, mentions: event.mentions, voice: event.voice, messages };
		}
		case 'voice_force_mute':
			return { ...state, forceMuted: { by: event.by, at: Date.now() } };
		case 'channel_deleted': {
			const { [event.id]: _messages, ...messages } = state.messages;
			const { [event.id]: _unread, ...unread } = state.unread;
			const { [event.id]: _voice, ...voice } = state.voice;
			return { ...state, channels: (state.channels ?? []).filter((c) => c.id !== event.id), messages, unread, voice };
		}
		case 'presence': {
			const online = new Set(state.online);
			if (event.online) {
				online.add(event.userId);
			} else {
				online.delete(event.userId);
			}
			return { ...state, online };
		}
		case 'typing':
			if (event.userId === action.myId) {
				return state;
			}
			return { ...state, typing: { ...state.typing, [event.channelId]: { ...state.typing[event.channelId], [event.userId]: Date.now() + TYPING_TTL } } };
		case 'voice': {
			const { [event.channelId]: _previous, ...rest } = state.voice;
			return { ...state, voice: event.participants.length ? { ...rest, [event.channelId]: event.participants } : rest };
		}
		case 'voice_ended':
			return { ...state, voiceEnded: { reason: event.reason, at: Date.now() } };
		case 'drive':
			return { ...state, drive: { ...state.drive, [event.channelId]: (state.drive[event.channelId] ?? 0) + 1 } };
		case 'workspace_deleted':
			return { ...state, closed: 'Cet espace a été supprimé.' };
		case 'announcement':
			return { ...state, announcements: { ...state.announcements, [event.channelId]: event.text } };
		case 'members_changed':
			return state;
	}
}

function reducer(state: WorkspaceState, action: Action): WorkspaceState {
	switch (action.type) {
		case 'info':
			return { ...state, info: action.info };
		case 'event':
			return onEvent(state, action);
		case 'status':
			return state.status === action.status ? state : { ...state, status: action.status };
		case 'closed':
			return { ...state, closed: action.reason };
		case 'loading': {
			const current = state.messages[action.channelId] ?? { items: [], hasMore: true, hasNewer: false, loading: false };
			return { ...state, messages: { ...state.messages, [action.channelId]: { ...current, loading: true } } };
		}
		case 'page': {
			const current = state.messages[action.channelId];
			const page = action.page;
			const known = new Set(page.messages.map((m) => m.id));
			const rest = (current?.items ?? []).filter((m) => !known.has(m.id));
			let next: ChannelMessages;
			if (action.mode === 'older') {
				next = { items: [...page.messages, ...rest], hasMore: page.hasMore, hasNewer: current?.hasNewer ?? false, loading: false };
			} else if (action.mode === 'newer') {
				next = { items: [...rest, ...page.messages], hasMore: current?.hasMore ?? true, hasNewer: page.hasNewer, loading: false };
			} else if (action.mode === 'around') {
				next = { items: page.messages, hasMore: page.hasMore, hasNewer: page.hasNewer, loading: false };
			} else {
				// Garder les messages reçus par WebSocket pendant le chargement.
				const newest = page.messages.at(-1)?.id ?? 0;
				next = { items: [...page.messages, ...rest.filter((m) => m.id > newest)], hasMore: page.hasMore, hasNewer: false, loading: false };
			}
			return { ...state, messages: { ...state.messages, [action.channelId]: next } };
		}
		case 'message':
			return withMessage(state, action.message, 'add');
		case 'read':
			if (!state.unread[action.channelId] && !state.mentions[action.channelId]) {
				return state;
			}
			return { ...state, unread: { ...state.unread, [action.channelId]: 0 }, mentions: { ...state.mentions, [action.channelId]: 0 } };
		case 'typing_expire': {
			let changed = false;
			const typing: WorkspaceState['typing'] = {};
			for (const [channelId, users] of Object.entries(state.typing)) {
				const alive = Object.fromEntries(Object.entries(users).filter(([, until]) => until > action.now));
				changed ||= Object.keys(alive).length !== Object.keys(users).length;
				typing[channelId] = alive;
			}
			return changed ? { ...state, typing } : state;
		}
	}
}

const isFocused = () => document.visibilityState === 'visible' && document.hasFocus();

export function useWorkspace(workspaceId: string, myId: string, activeChannelId: string | null) {
	const [state, dispatch] = useReducer(reducer, initial);
	const activeRef = useRef(activeChannelId);
	activeRef.current = activeChannelId;
	const socketRef = useRef<WebSocket | null>(null);

	const reloadInfo = useCallback(async () => {
		dispatch({ type: 'info', info: await api<WorkspaceDetail>('GET', `/w/${workspaceId}/info`) });
	}, [workspaceId]);

	useEffect(() => {
		void reloadInfo();
	}, [reloadInfo]);

	useEffect(() => {
		let stopped = false;
		let retry = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const connect = () => {
			dispatch({ type: 'status', status: 'connecting' });
			const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/w/${workspaceId}/ws`);
			socketRef.current = ws;
			ws.onopen = () => {
				retry = 0;
			};
			ws.onmessage = (message) => {
				if (message.data === 'pong') {
					return;
				}
				const event = JSON.parse(message.data as string) as ServerEvent;
				if (event.t === 'members_changed') {
					void reloadInfo();
				}
				dispatch({ type: 'event', event, activeChannelId: activeRef.current, myId, focused: isFocused() });
			};
			ws.onclose = (close) => {
				if (stopped) {
					return;
				}
				if (close.code === 4001 || close.code === 4002) {
					dispatch({ type: 'closed', reason: close.code === 4001 ? 'Tu as été retiré de cet espace.' : 'Cet espace a été supprimé.' });
					return;
				}
				dispatch({ type: 'status', status: 'offline' });
				timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** retry++));
			};
		};
		connect();
		const ping = setInterval(() => socketRef.current?.readyState === WebSocket.OPEN && socketRef.current.send('ping'), 25_000);
		const expire = setInterval(() => dispatch({ type: 'typing_expire', now: Date.now() }), 1000);
		return () => {
			stopped = true;
			clearTimeout(timer);
			clearInterval(ping);
			clearInterval(expire);
			socketRef.current?.close(1000);
		};
	}, [workspaceId, myId, reloadInfo]);

	const send = useCallback((event: ClientEvent) => {
		const ws = socketRef.current;
		if (ws?.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(event));
		}
	}, []);

	const loadMessages = useCallback(
		async (channelId: string, mode: PageMode = 'latest', cursor?: number) => {
			dispatch({ type: 'loading', channelId });
			const param = mode === 'older' ? 'before' : mode === 'newer' ? 'after' : mode === 'around' ? 'around' : null;
			const page = await api<MessagePage>('GET', `/w/${workspaceId}/channels/${channelId}/messages${param && cursor ? `?${param}=${cursor}` : ''}`);
			dispatch({ type: 'page', channelId, page, mode });
		},
		[workspaceId],
	);

	return { state, dispatch, send, loadMessages, reloadInfo };
}
