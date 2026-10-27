import { useEffect, useRef, useState } from 'react';

import { CLIP_MAX_MS } from '../../../shared/media';
import { Dialog, Icon } from '../../ui';
import './media.css';

type Mode = 'audio' | 'video';
type Phase = 'starting' | 'ready' | 'recording' | 'review' | 'error';

const MIMES: Record<Mode, string[]> = {
	audio: ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'],
	video: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'],
};

const supported = () => typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

const clock = (ms: number) => {
	const s = Math.floor(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const stopTracks = (stream: MediaStream | null) => stream?.getTracks().forEach((track) => track.stop());

function deviceError(error: unknown, mode: Mode): string {
	const name = error instanceof DOMException ? error.name : '';
	if (name === 'NotAllowedError' || name === 'SecurityError') {
		return `Accès ${mode === 'video' ? 'à la caméra' : 'au micro'} refusé. Autorise-le dans le navigateur.`;
	}
	if (name === 'NotFoundError' || name === 'OverconstrainedError') {
		return mode === 'video' ? 'Aucune caméra détectée.' : 'Aucun micro détecté.';
	}
	return 'Impossible de démarrer l’enregistrement.';
}

export function RecordButtons({ onClip }: { onClip: (file: File) => void }) {
	const [mode, setMode] = useState<Mode | null>(null);
	if (!supported()) {
		return null;
	}
	return (
		<>
			<button type='button' className='icon-btn' aria-label='Enregistrer un clip audio' title='Enregistrer un clip audio' onClick={() => setMode('audio')}>
				<Icon name='mic' />
			</button>
			<button type='button' className='icon-btn' aria-label='Enregistrer un clip vidéo' title='Enregistrer un clip vidéo' onClick={() => setMode('video')}>
				<Icon name='video' />
			</button>
			<Dialog open={mode !== null} onClose={() => setMode(null)} title={mode === 'video' ? 'Clip vidéo' : 'Clip audio'}>
				{mode && (
					<RecorderBody
						mode={mode}
						onCancel={() => setMode(null)}
						onDone={(file) => {
							setMode(null);
							onClip(file);
						}}
					/>
				)}
			</Dialog>
		</>
	);
}

function RecorderBody({ mode, onDone, onCancel }: { mode: Mode; onDone: (file: File) => void; onCancel: () => void }) {
	const [attempt, setAttempt] = useState(0);
	const [phase, setPhase] = useState<Phase>('starting');
	const [error, setError] = useState('');
	const [elapsed, setElapsed] = useState(0);
	const [clip, setClip] = useState<{ file: File; url: string } | null>(null);
	const live = useRef<HTMLVideoElement>(null);
	const stream = useRef<MediaStream | null>(null);
	const recorder = useRef<MediaRecorder | null>(null);

	useEffect(() => {
		let cancelled = false;
		setPhase('starting');
		navigator.mediaDevices
			.getUserMedia({ audio: true, video: mode === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false })
			.then((media) => {
				if (cancelled) {
					stopTracks(media);
					return;
				}
				stream.current = media;
				setPhase('ready');
			})
			.catch((e: unknown) => {
				if (!cancelled) {
					setError(deviceError(e, mode));
					setPhase('error');
				}
			});
		return () => {
			cancelled = true;
			// Fermeture en cours d'enregistrement : rien n'est produit.
			if (recorder.current) {
				recorder.current.onstop = null;
				if (recorder.current.state !== 'inactive') {
					recorder.current.stop();
				}
				recorder.current = null;
			}
			stopTracks(stream.current);
			stream.current = null;
		};
	}, [mode, attempt]);

	useEffect(() => {
		if (live.current && stream.current && live.current.srcObject !== stream.current) {
			live.current.srcObject = stream.current;
		}
	}, [phase]);

	const stop = () => {
		if (recorder.current?.state === 'recording') {
			recorder.current.stop();
		}
	};

	useEffect(() => {
		if (phase !== 'recording') {
			return;
		}
		const began = Date.now();
		const tick = setInterval(() => {
			const ms = Date.now() - began;
			setElapsed(Math.min(ms, CLIP_MAX_MS));
			if (ms >= CLIP_MAX_MS) {
				stop();
			}
		}, 250);
		return () => clearInterval(tick);
	}, [phase]);

	useEffect(() => () => void (clip && URL.revokeObjectURL(clip.url)), [clip]);

	const start = () => {
		const media = stream.current;
		if (!media) {
			return;
		}
		const mime = MIMES[mode].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
		// Débit borné : 5 min de vidéo tiennent sous la limite de 50 Mo.
		const rec = new MediaRecorder(media, { mimeType: mime || undefined, audioBitsPerSecond: 96_000, videoBitsPerSecond: mode === 'video' ? 1_000_000 : undefined });
		const chunks: Blob[] = [];
		rec.ondataavailable = (e) => {
			if (e.data.size) {
				chunks.push(e.data);
			}
		};
		rec.onstop = () => {
			const type = (rec.mimeType || mime || `${mode}/webm`).split(';')[0]!;
			const sub = type.split('/')[1] ?? 'webm';
			const ext = sub === 'mp4' && mode === 'audio' ? 'm4a' : sub;
			const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
			const file = new File(chunks, `clip-${mode}-${stamp}.${ext}`, { type });
			stopTracks(stream.current);
			stream.current = null;
			recorder.current = null;
			setClip({ file, url: URL.createObjectURL(file) });
			setPhase('review');
		};
		rec.start(1000);
		recorder.current = rec;
		setElapsed(0);
		setPhase('recording');
	};

	const retry = () => {
		setClip(null);
		setError('');
		setElapsed(0);
		setAttempt((n) => n + 1);
	};

	return (
		<div className='recorder'>
			<div className='recorder-stage'>
				{mode === 'video' && phase !== 'review' && phase !== 'error' && <video ref={live} muted playsInline autoPlay />}
				{mode === 'audio' && phase !== 'review' && (
					<span className={`recorder-mic${phase === 'recording' ? ' is-live' : ''}`}>
						<Icon name='mic' size={28} />
					</span>
				)}
				{phase === 'review' && clip && (mode === 'video' ? <video src={clip.url} controls playsInline /> : <audio src={clip.url} controls />)}
			</div>
			{phase === 'error' ? (
				<p className='notice notice-error'>{error}</p>
			) : (
				<div className='recorder-time' aria-live='polite'>
					{phase === 'recording' && <span className='recorder-dot' aria-hidden />}
					{phase === 'starting' ? (
						<span className='recorder-hint'>En attente de l’autorisation {mode === 'video' ? 'caméra' : 'micro'}…</span>
					) : (
						<>
							<span>{clock(elapsed)}</span>
							<span className='recorder-hint'>/ {clock(CLIP_MAX_MS)} max</span>
						</>
					)}
				</div>
			)}
			<div className='recorder-actions'>
				<button type='button' className='btn' onClick={onCancel}>
					Annuler
				</button>
				{phase === 'ready' && (
					<button type='button' className='btn btn-primary' onClick={start}>
						Démarrer l’enregistrement
					</button>
				)}
				{phase === 'recording' && (
					<button type='button' className='btn btn-primary' onClick={stop}>
						Arrêter
					</button>
				)}
				{(phase === 'review' || phase === 'error') && (
					<button type='button' className='btn' onClick={retry}>
						{phase === 'error' ? 'Réessayer' : 'Recommencer'}
					</button>
				)}
				{phase === 'review' && clip && (
					<button type='button' className='btn btn-primary' onClick={() => onDone(clip.file)}>
						Joindre au message
					</button>
				)}
			</div>
		</div>
	);
}
