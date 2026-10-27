import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClientEvent, VoiceParticipant } from '../../../shared/types';
import { errorText } from '../../api';
import { navigate } from '../../router';
import { VoiceClient, type VoiceSnapshot } from './VoiceClient';

type Options = {
	workspaceId: string;
	connId: string | null;
	myId: string;
	voice: Record<string, VoiceParticipant[]>;
	voiceEnded: { reason: string; at: number } | null;
	forceMuted: { by: string; at: number } | null;
	voiceMoved: { channelId: string; by: string; at: number } | null;
	send: (event: ClientEvent) => void;
};

export type VoiceControls = ReturnType<typeof useVoice>;

export function useVoice({ workspaceId, connId, myId, voice, voiceEnded, forceMuted, voiceMoved, send }: Options) {
	const clientRef = useRef<VoiceClient | null>(null);
	const [snapshot, setSnapshot] = useState<VoiceSnapshot | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [joining, setJoining] = useState<string | null>(null);
	const connRef = useRef(connId);
	const failures = useRef<number[]>([]);
	const joinRef = useRef<(channelId: string) => Promise<void>>(async () => undefined);

	const stop = useCallback(() => {
		clientRef.current?.dispose();
		clientRef.current = null;
		setSnapshot(null);
	}, []);

	const join = useCallback(
		async (channelId: string) => {
			if (!connId || joining) {
				return;
			}
			if (clientRef.current) {
				await clientRef.current.leave().catch(() => undefined);
				clientRef.current = null;
				setSnapshot(null);
			}
			setNotice(null);
			setJoining(channelId);
			const client = new VoiceClient({
				workspaceId,
				connId,
				channelId,
				myId,
				onChange: setSnapshot,
				sendFlags: (flags) => send({ t: 'voice_update', ...flags }),
				onFailed: () => {
					const now = Date.now();
					failures.current = [...failures.current.filter((at) => now - at < 60_000), now];
					if (failures.current.length > 3) {
						client.dispose();
						clientRef.current = null;
						setSnapshot(null);
						setNotice('Connexion vocale impossible. Vérifie ta connexion puis rejoins le salon.');
						return;
					}
					setTimeout(() => clientRef.current === client && void joinRef.current(channelId), 800);
				},
			});
			clientRef.current = client;
			setSnapshot(client.snapshot);
			try {
				await client.join();
			} catch (error) {
				client.dispose();
				if (clientRef.current === client) {
					clientRef.current = null;
					setSnapshot(null);
				}
				setNotice(errorText(error));
			} finally {
				setJoining(null);
			}
		},
		[connId, joining, workspaceId, myId, send],
	);

	joinRef.current = join;

	const leave = useCallback(async () => {
		const client = clientRef.current;
		clientRef.current = null;
		setSnapshot(null);
		await client?.leave().catch(() => undefined);
	}, []);

	const channelId = snapshot?.channelId;
	const participants = channelId ? voice[channelId] : undefined;

	useEffect(() => {
		if (participants && clientRef.current) {
			clientRef.current.sync(participants);
		}
	}, [participants]);

	// Nouvelle connexion temps réel : le serveur a oublié la session, on rejoint à nouveau.
	useEffect(() => {
		const previous = connRef.current;
		connRef.current = connId;
		const current = clientRef.current;
		if (current && connId && previous && previous !== connId) {
			const target = current.snapshot.channelId;
			stop();
			void join(target);
		}
	}, [connId, join, stop]);

	useEffect(() => {
		if (voiceEnded && clientRef.current) {
			stop();
			setNotice(voiceEnded.reason);
		}
	}, [voiceEnded, stop]);

	useEffect(() => {
		if (forceMuted && clientRef.current) {
			void clientRef.current.setMuted(true);
			setNotice(`${forceMuted.by} a coupé ton micro.`);
		}
	}, [forceMuted]);

	useEffect(() => {
		const from = clientRef.current?.snapshot.channelId;
		if (!voiceMoved || !from || from === voiceMoved.channelId) {
			return;
		}
		// Qui regardait l'ancien salon suit l'appel ; sinon la vue ne bouge pas.
		if (location.pathname.endsWith(`/${from}`)) {
			navigate(`/w/${workspaceId}/${voiceMoved.channelId}`, true);
		}
		void joinRef.current(voiceMoved.channelId).then(() => setNotice(`${voiceMoved.by} t’a déplacé dans un autre salon vocal.`));
	}, [voiceMoved, workspaceId]);

	useEffect(() => () => void clientRef.current?.leave().catch(() => undefined), []);

	const client = () => clientRef.current;

	return {
		snapshot,
		notice,
		joining,
		join,
		leave,
		dismissNotice: () => setNotice(null),
		toggleMute: () => snapshot && void client()?.setMuted(!snapshot.muted),
		toggleDeafen: () => snapshot && void client()?.setDeafened(!snapshot.deafened),
		toggleVideo: () => snapshot && void client()?.setVideo(!snapshot.video),
		toggleScreen: () => snapshot && void client()?.setScreen(!snapshot.screen),
	};
}
