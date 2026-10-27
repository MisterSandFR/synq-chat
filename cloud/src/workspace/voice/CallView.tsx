import { useEffect, useRef, useState } from 'react';

import { P, has } from '../../../shared/permissions';
import type { Channel, Grade, Member, VoiceParticipant } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Avatar, Icon, useDismiss } from '../../ui';
import { memberColor } from '../grades';
import type { VoiceControls } from './useVoice';

export function Video({ stream, mirror }: { stream: MediaStream; mirror?: boolean }) {
	const ref = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		if (ref.current && ref.current.srcObject !== stream) {
			ref.current.srcObject = stream;
		}
	}, [stream]);
	return <video ref={ref} autoPlay playsInline muted style={mirror ? { transform: 'scaleX(-1)' } : undefined} />;
}

function Sound({ stream, muted }: { stream: MediaStream; muted: boolean }) {
	const ref = useRef<HTMLAudioElement>(null);
	useEffect(() => {
		const el = ref.current;
		if (el && el.srcObject !== stream) {
			el.srcObject = stream;
			void el.play().catch(() => undefined);
		}
	}, [stream]);
	useEffect(() => {
		if (ref.current) {
			ref.current.muted = muted;
		}
	}, [muted]);
	return <audio ref={ref} autoPlay />;
}

// Monté au niveau de l'espace : le son continue pendant la navigation entre salons.
export function RemoteAudio({ voice }: { voice: VoiceControls }) {
	const snapshot = voice.snapshot;
	if (!snapshot) {
		return null;
	}
	return (
		<div hidden>
			{Object.entries(snapshot.remotes).flatMap(([userId, media]) =>
				[media.audio, media.screenAudio]
					.filter((s): s is MediaStream => Boolean(s))
					.map((stream) => <Sound key={`${userId}-${stream.id}`} stream={stream} muted={snapshot.deafened} />),
			)}
		</div>
	);
}

type Props = {
	workspaceId: string;
	channel: Channel;
	participants: VoiceParticipant[];
	members: Map<string, Member>;
	grades: Grade[];
	perms: number;
	myId: string;
	voice: VoiceControls;
	otherChannelName: string | null;
	// Salons vocaux où l'on peut déplacer quelqu'un (permission vérifiée par le serveur).
	moveTargets: Channel[];
};

export function CallView({ workspaceId, channel, participants, members, grades, perms, myId, voice, otherChannelName, moveTargets }: Props) {
	const snapshot = voice.snapshot;
	const connected = snapshot?.channelId === channel.id;
	const speaking = connected ? snapshot.speaking : new Set<string>();
	const full = channel.userLimit > 0 && participants.length >= channel.userLimit && !has(perms, P.BYPASS_LIMIT);
	const canConnect = has(perms, P.VOICE_CONNECT);
	const canModerate = has(perms, P.VOICE_MODERATE);
	const canMove = has(perms, P.VOICE_MOVE) && moveTargets.length > 0;
	const [modError, setModError] = useState<string | null>(null);
	const report = (request: Promise<unknown>) =>
		request.then(
			() => setModError(null),
			(error) => setModError(errorText(error)),
		);
	const moderate = (userId: string, action: 'mute' | 'kick') => report(api('POST', `/w/${workspaceId}/voice/moderate`, { userId, action }));
	const move = (userId: string, channelId: string) => report(api('POST', `/w/${workspaceId}/voice/move`, { userId, channelId }));

	const camFor = (p: VoiceParticipant) => {
		if (!connected || !p.video) {
			return null;
		}
		return p.userId === myId ? snapshot.localCam : (snapshot.remotes[p.userId]?.cam ?? null);
	};
	const sharer = connected ? participants.find((p) => p.screen && (p.userId === myId ? snapshot.localScreen : snapshot.remotes[p.userId]?.screen)) : undefined;
	const shareStream = sharer ? (sharer.userId === myId ? snapshot!.localScreen : snapshot!.remotes[sharer.userId]?.screen) : null;

	const tiles = participants.map((p) => {
		const member = members.get(p.userId);
		const cam = camFor(p);
		return (
			<div key={p.userId} className={`tile${speaking.has(p.userId) ? ' tile-speaking' : ''}`}>
				{cam ? <Video stream={cam} mirror={p.userId === myId} /> : <Avatar name={member?.name ?? '?'} url={member?.avatarUrl} size={72} />}
				{(canModerate || canMove) && p.userId !== myId && (
					<TileMenu
						name={member?.name ?? 'ce membre'}
						onMute={canModerate ? () => void moderate(p.userId, 'mute') : undefined}
						onKick={canModerate ? () => void moderate(p.userId, 'kick') : undefined}
						targets={canMove ? moveTargets : []}
						onMove={(channelId) => void move(p.userId, channelId)}
					/>
				)}
				<span className='tile-label'>
					<span className='ellipsis' style={{ color: memberColor(member, grades) }}>
						{member?.name ?? 'Membre'}
						{p.userId === myId && ' (toi)'}
					</span>
					{p.deafened ? <Icon name='headphones-off' size={14} /> : p.muted && <Icon name='mic-off' size={14} />}
					{p.screen && <Icon name='screen' size={14} />}
				</span>
			</div>
		);
	});

	return (
		<section className='call' aria-label={`Salon vocal ${channel.name}`}>
			{!connected ? (
				<div className='call-empty'>
					{participants.length > 0 ? (
						<div className='facepile-stack'>
							{participants.slice(0, 6).map((p) => (
								<Avatar key={p.userId} name={members.get(p.userId)?.name ?? '?'} url={members.get(p.userId)?.avatarUrl} size={48} />
							))}
						</div>
					) : (
						<span className='channel-intro-icon'>
							<Icon name='speaker' size={24} />
						</span>
					)}
					<div className='stack' style={{ gap: 4 }}>
						<h2 style={{ fontSize: 22, fontWeight: 600 }}>{channel.name}</h2>
						<p className='muted'>
							{participants.length === 0
								? 'Personne pour l’instant.'
								: `${participants.map((p) => members.get(p.userId)?.name ?? 'Membre').join(', ')} ${participants.length > 1 ? 'sont' : 'est'} là.`}
						</p>
						{otherChannelName && <p className='muted'>Tu es connecté à « {otherChannelName} ». Rejoindre ici te déplace.</p>}
					</div>
					<button type='button' className='btn btn-primary btn-lg' disabled={Boolean(voice.joining) || full || !canConnect} onClick={() => void voice.join(channel.id)}>
						<Icon name='speaker' />
						{voice.joining === channel.id ? 'Connexion…' : !canConnect ? 'Accès réservé' : full ? 'Salon complet' : 'Rejoindre le salon'}
					</button>
					{voice.notice && (
						<p className='notice notice-error' role='alert'>
							{voice.notice}
						</p>
					)}
				</div>
			) : (
				<>
					<div className={`call-stage${shareStream ? ' call-stage-share' : ''}`}>
						{shareStream ? (
							<>
								<div className='call-share'>
									<Video stream={shareStream} />
									<span className='tile-label'>Écran de {members.get(sharer!.userId)?.name ?? 'Membre'}</span>
								</div>
								<div className='call-strip'>{tiles}</div>
							</>
						) : (
							<div className='call-grid'>{tiles}</div>
						)}
					</div>
					{(snapshot.error || voice.notice || modError) && (
						<p className='notice notice-error' role='alert' style={{ margin: '0 16px 10px', alignSelf: 'center' }}>
							{snapshot.error ?? modError ?? voice.notice}
						</p>
					)}
					<CallControls voice={voice} perms={perms} large />
				</>
			)}
		</section>
	);
}

type TileMenuProps = { name: string; onMute?: () => void; onKick?: () => void; targets: Channel[]; onMove: (channelId: string) => void };

function TileMenu({ name, onMute, onKick, targets, onMove }: TileMenuProps) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	return (
		<div ref={ref} className='tile-menu'>
			<button type='button' className='icon-btn icon-btn-sm' aria-label={`Modérer ${name}`} aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<Icon name='shield' size={16} />
			</button>
			{open && (
				<div className='popover' role='menu' style={{ right: 0, top: 'calc(100% + 4px)', minWidth: 220, maxHeight: 360, overflowY: 'auto' }}>
					{onMute && (
						<button
							type='button'
							role='menuitem'
							className='menu-item'
							onClick={() => {
								setOpen(false);
								onMute();
							}}
						>
							<Icon name='mic-off' size={16} /> Couper son micro
						</button>
					)}
					{onKick && (
						<button
							type='button'
							role='menuitem'
							className='menu-item menu-item-danger'
							onClick={() => {
								setOpen(false);
								onKick();
							}}
						>
							<Icon name='hangup' size={16} /> Retirer du vocal
						</button>
					)}
					{targets.length > 0 && (
						<>
							{(onMute || onKick) && <div className='menu-sep' />}
							<p className='menu-label'>Déplacer vers</p>
							{targets.map((target) => (
								<button
									key={target.id}
									type='button'
									role='menuitem'
									className='menu-item'
									onClick={() => {
										setOpen(false);
										onMove(target.id);
									}}
								>
									<Icon name='speaker' size={16} /> <span className='ellipsis'>{target.name}</span>
								</button>
							))}
						</>
					)}
				</div>
			)}
		</div>
	);
}

export function CallControls({ voice, perms, large }: { voice: VoiceControls; perms: number; large?: boolean }) {
	const s = voice.snapshot;
	if (!s) {
		return null;
	}
	const cls = large ? 'call-btn' : 'icon-btn';
	const canSpeak = has(perms, P.VOICE_SPEAK);
	const canVideo = has(perms, P.VOICE_VIDEO);
	const canScreen = has(perms, P.VOICE_SCREEN);
	return (
		<div className={large ? 'call-controls' : 'voice-dock-controls'}>
			<button type='button' className={`${cls}${s.muted ? (large ? ' call-btn-off' : ' icon-btn-off') : ''}`} aria-label={s.muted ? 'Activer le micro' : 'Couper le micro'} title={canSpeak ? (s.muted ? 'Activer le micro' : 'Couper le micro') : 'Ton grade ne permet pas de parler ici'} disabled={!canSpeak} onClick={voice.toggleMute}>
				<Icon name={s.muted ? 'mic-off' : 'mic'} size={large ? 22 : 18} />
			</button>
			<button type='button' className={`${cls}${s.deafened ? (large ? ' call-btn-off' : ' icon-btn-off') : ''}`} aria-label={s.deafened ? 'Réactiver le son' : 'Couper le son'} title={s.deafened ? 'Réactiver le son' : 'Couper le son'} onClick={voice.toggleDeafen}>
				<Icon name={s.deafened ? 'headphones-off' : 'headphones'} size={large ? 22 : 18} />
			</button>
			<button type='button' className={cls} aria-pressed={s.video} aria-label={s.video ? 'Couper la caméra' : 'Activer la caméra'} title={canVideo ? (s.video ? 'Couper la caméra' : 'Activer la caméra') : 'Caméra non autorisée ici'} disabled={!canVideo && !s.video} onClick={voice.toggleVideo}>
				<Icon name={s.video ? 'video' : 'video-off'} size={large ? 22 : 18} />
			</button>
			<button type='button' className={cls} aria-pressed={s.screen} aria-label={s.screen ? 'Arrêter le partage' : 'Partager l’écran'} title={canScreen ? (s.screen ? 'Arrêter le partage' : 'Partager l’écran') : 'Partage d’écran non autorisé ici'} disabled={!canScreen && !s.screen} onClick={voice.toggleScreen}>
				<Icon name='screen' size={large ? 22 : 18} />
			</button>
			<button type='button' className={large ? 'call-btn call-btn-hangup' : 'icon-btn icon-btn-hangup'} aria-label='Quitter le vocal' title='Quitter le vocal' onClick={() => void voice.leave()}>
				<Icon name='hangup' size={large ? 22 : 18} />
			</button>
		</div>
	);
}
