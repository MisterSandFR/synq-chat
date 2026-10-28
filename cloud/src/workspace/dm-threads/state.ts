import { useEffect } from 'react';

import { DM_PERMS, type DirectConversation, type DirectOpened, type GuestOutcome } from '../../../shared/dm-threads';
import type { Channel, Message, ServerEvent } from '../../../shared/types';
import { api } from '../../api';

export interface DmThreadsState {
	dms: DirectConversation[] | null;
	// Réponses des fils déjà ouverts, par message racine.
	threads: Record<number, Message[]>;
	ring: { channelId: string; by: string } | null;
}

export type DmThreadsAction = { type: 'dm_threads'; update: (current: DmThreadsState) => DmThreadsState };

export const initialDmThreads: DmThreadsState = { dms: null, threads: {}, ring: null };

export const dismissRing = (state: DmThreadsState): DmThreadsState => (state.ring ? { ...state, ring: null } : state);

export const upsertDirect =
	(conversation: DirectConversation) =>
	(state: DmThreadsState): DmThreadsState => ({
		...state,
		dms: [conversation, ...(state.dms ?? []).filter((d) => d.id !== conversation.id)],
	});

export const putReply =
	(rootId: number, message: Message) =>
	(state: DmThreadsState): DmThreadsState => {
		const list = state.threads[rootId];
		if (!list) {
			return state;
		}
		const known = list.some((m) => m.id === message.id);
		return { ...state, threads: { ...state.threads, [rootId]: known ? list.map((m) => (m.id === message.id ? message : m)) : [...list, message] } };
	};

export function reduceDmThreads(state: DmThreadsState, event: ServerEvent): DmThreadsState {
	switch (event.t) {
		case 'hello':
			// Reconnexion : les fils ouverts se rechargent.
			return Object.keys(state.threads).length ? { ...state, threads: {} } : state;
		case 'dm':
			return upsertDirect(event.conversation)(state);
		case 'access':
			// Grade retiré : le groupe quitte la liste avec son salon.
			return state.dms ? { ...state, dms: state.dms.filter((d) => event.channels.some((c) => c.id === d.id)) } : state;
		case 'thread':
			return putReply(event.rootId, event.message)(state);
		case 'message': {
			const { message } = event;
			const dm = state.dms?.find((d) => d.id === message.channelId);
			const next = dm ? upsertDirect({ ...dm, last: { userId: message.userId, body: message.body, createdAt: message.createdAt } })(state) : state;
			return message.threadRoot ? putReply(message.threadRoot, message)(next) : next;
		}
		case 'message_updated': {
			const rootId = event.message.threadRoot;
			return rootId && state.threads[rootId]?.some((m) => m.id === event.message.id) ? putReply(rootId, event.message)(state) : state;
		}
		case 'message_deleted': {
			let changed = false;
			const threads: Record<number, Message[]> = {};
			for (const [rootId, list] of Object.entries(state.threads)) {
				const kept = list.filter((m) => m.id !== event.id);
				changed ||= kept.length !== list.length;
				threads[Number(rootId)] = kept;
			}
			return changed ? { ...state, threads } : state;
		}
		case 'channel_deleted':
			return state.dms?.some((d) => d.id === event.id) ? { ...state, dms: state.dms.filter((d) => d.id !== event.id) } : state;
		case 'access': {
			// Retiré d'un groupe : la conversation disparaît.
			const visible = new Set(event.channels.map((c) => c.id));
			const dms = state.dms?.filter((d) => visible.has(d.id)) ?? null;
			const ring = state.ring && visible.has(state.ring.channelId) ? state.ring : null;
			return dms?.length === state.dms?.length && ring === state.ring ? state : { ...state, dms, ring };
		}
		case 'call_ring':
			return { ...state, ring: { channelId: event.channelId, by: event.by } };
		case 'voice':
			return state.ring?.channelId === event.channelId && event.participants.length === 0 ? { ...state, ring: null } : state;
		default:
			return state;
	}
}

// Salon renvoyé avec la conversation : la navigation n'attend pas l'event temps réel.
export async function openDirect(
	workspaceId: string,
	userIds: string[],
	name = '',
	gradeIds: string[] = [],
	guestEmails: string[] = [],
): Promise<{ conversation: DirectConversation; channel: Channel; perms: number; guestInvites: GuestOutcome[] }> {
	const { guestInvites = [], ...conversation } = await api<DirectOpened>('POST', `/w/${workspaceId}/dms`, { userIds, name, gradeIds, guestEmails });
	const channel: Channel = {
		id: conversation.id,
		name: `dm-${conversation.id}`,
		kind: 'dm',
		topic: '',
		category: '',
		categoryId: null,
		synced: false,
		readOnly: false,
		userLimit: 0,
		position: 0,
		createdAt: conversation.createdAt,
		icon: '',
	};
	return { conversation, channel, perms: DM_PERMS, guestInvites };
}

export function useDirectsLoader(workspaceId: string, connId: string | null, dispatch: (action: DmThreadsAction) => void): void {
	useEffect(() => {
		if (!connId) {
			return;
		}
		let live = true;
		api<DirectConversation[]>('GET', `/w/${workspaceId}/dms`)
			.then((dms) => live && dispatch({ type: 'dm_threads', update: (current) => ({ ...current, dms }) }))
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [workspaceId, connId, dispatch]);
}
