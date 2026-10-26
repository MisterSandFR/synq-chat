import type { VoiceFlags, VoiceParticipant } from '../../../shared/types';
import { api, ApiError } from '../../api';

type TrackName = 'mic' | 'cam' | 'screen' | 'screen-audio';

export interface RemoteMedia {
	audio?: MediaStream;
	cam?: MediaStream;
	screen?: MediaStream;
	screenAudio?: MediaStream;
}

export interface VoiceSnapshot {
	channelId: string;
	status: 'connecting' | 'connected' | 'error';
	error: string | null;
	muted: boolean;
	deafened: boolean;
	video: boolean;
	screen: boolean;
	micAvailable: boolean;
	localCam: MediaStream | null;
	localScreen: MediaStream | null;
	remotes: Record<string, RemoteMedia>;
	speaking: Set<string>;
}

type Options = {
	workspaceId: string;
	connId: string;
	channelId: string;
	myId: string;
	onChange: (snapshot: VoiceSnapshot) => void;
	sendFlags: (flags: VoiceFlags) => void;
};

type SessionDescription = { type: RTCSdpType; sdp: string };
type TrackResult = { mid?: string; trackName?: string; errorCode?: string };
type TracksReply = { sessionDescription?: SessionDescription; requiresImmediateRenegotiation?: boolean; tracks?: TrackResult[] };

const SLOT: Record<TrackName, keyof RemoteMedia> = { mic: 'audio', cam: 'cam', screen: 'screen', 'screen-audio': 'screenAudio' };

const SPEAKING_LEVEL = 0.035;

// Pas de trickle ICE côté SFU : on attend les candidats, borné pour ne pas bloquer.
function gathered(pc: RTCPeerConnection): Promise<void> {
	if (pc.iceGatheringState === 'complete') {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const done = () => {
			if (pc.iceGatheringState === 'complete') {
				pc.removeEventListener('icegatheringstatechange', done);
				resolve();
			}
		};
		pc.addEventListener('icegatheringstatechange', done);
		setTimeout(resolve, 1500);
	});
}

export function mediaError(error: unknown, device: string): string {
	const name = error instanceof DOMException ? error.name : '';
	if (name === 'NotAllowedError') {
		return `Accès ${device} refusé par le navigateur.`;
	}
	if (name === 'NotFoundError' || name === 'OverconstrainedError') {
		return `Aucun ${device} détecté.`;
	}
	if (name === 'NotReadableError') {
		return `${device[0]!.toUpperCase()}${device.slice(1)} déjà utilisé par une autre application.`;
	}
	return error instanceof Error ? error.message : `Erreur ${device}`;
}

export class VoiceClient {
	private pc: RTCPeerConnection | null = null;
	private sessionId = '';
	private queue: Promise<unknown> = Promise.resolve();
	private readonly transceivers: Partial<Record<TrackName, RTCRtpTransceiver>> = {};
	private readonly local: Partial<Record<TrackName, MediaStreamTrack>> = {};
	private readonly pulled = new Map<string, { mid: string; userId: string; trackName: TrackName }>();
	private readonly byMid = new Map<string, { userId: string; trackName: TrackName }>();
	private audio: AudioContext | null = null;
	private readonly meters = new Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; data: Uint8Array<ArrayBuffer> }>();
	private meterTimer: ReturnType<typeof setInterval> | undefined;
	private disposed = false;
	private mutedBeforeDeafen = false;
	private state: VoiceSnapshot;

	constructor(private readonly opts: Options) {
		this.state = {
			channelId: opts.channelId,
			status: 'connecting',
			error: null,
			muted: false,
			deafened: false,
			video: false,
			screen: false,
			micAvailable: false,
			localCam: null,
			localScreen: null,
			remotes: {},
			speaking: new Set(),
		};
	}

	get snapshot(): VoiceSnapshot {
		return this.state;
	}

	private update(patch: Partial<VoiceSnapshot>): void {
		if (this.disposed) {
			return;
		}
		this.state = { ...this.state, ...patch };
		this.opts.onChange(this.state);
	}

	private run<T>(task: () => Promise<T>): Promise<T> {
		const next = this.queue.then(task, task);
		this.queue = next.catch(() => undefined);
		return next;
	}

	private path(suffix: string): string {
		return `/w/${this.opts.workspaceId}/voice/${suffix}`;
	}

	async join(): Promise<VoiceParticipant[]> {
		const joined = await api<{ sessionId: string; iceServers: RTCIceServer[]; participants: VoiceParticipant[] }>('POST', this.path('join'), {
			channelId: this.opts.channelId,
			connId: this.opts.connId,
		});
		this.sessionId = joined.sessionId;
		const pc = new RTCPeerConnection({ iceServers: joined.iceServers, bundlePolicy: 'max-bundle' });
		this.pc = pc;
		pc.ontrack = (event) => this.onTrack(event);
		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'failed') {
				this.update({ status: 'error', error: 'Connexion vocale perdue. Quitte puis rejoins le salon.' });
			} else if (pc.connectionState === 'connected' && this.state.status !== 'connected') {
				this.update({ status: 'connected', error: null });
			}
		};
		this.audio = new AudioContext();
		this.meterTimer = setInterval(() => this.measure(), 150);
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
			const track = stream.getAudioTracks()[0]!;
			this.local.mic = track;
			this.meter(this.opts.myId, stream);
			await this.publish('mic', track);
			this.update({ micAvailable: true });
		} catch (error) {
			this.update({ micAvailable: false, muted: true, error: mediaError(error, 'micro') });
			this.opts.sendFlags({ muted: true });
		}
		this.update({ status: 'connected' });
		this.sync(joined.participants);
		return joined.participants;
	}

	private publish(name: TrackName, track: MediaStreamTrack): Promise<void> {
		return this.run(async () => {
			const pc = this.pc;
			if (!pc) {
				return;
			}
			const existing = this.transceivers[name];
			if (existing) {
				await existing.sender.replaceTrack(track);
				return;
			}
			const transceiver = pc.addTransceiver(track, { direction: 'sendonly' });
			this.transceivers[name] = transceiver;
			await pc.setLocalDescription(await pc.createOffer());
			await gathered(pc);
			const reply = await api<TracksReply>('POST', this.path('tracks'), {
				connId: this.opts.connId,
				sessionId: this.sessionId,
				sessionDescription: pc.localDescription,
				tracks: [{ location: 'local', mid: transceiver.mid, trackName: name }],
			});
			if (reply.sessionDescription) {
				await pc.setRemoteDescription(reply.sessionDescription);
			}
		});
	}

	sync(participants: VoiceParticipant[]): void {
		if (!this.pc || this.disposed) {
			return;
		}
		const wanted = new Map<string, { sessionId: string; userId: string; trackName: TrackName }>();
		for (const p of participants) {
			if (p.userId === this.opts.myId) {
				continue;
			}
			for (const name of p.tracks as TrackName[]) {
				wanted.set(`${p.sessionId}:${name}`, { sessionId: p.sessionId, userId: p.userId, trackName: name });
			}
		}
		const fresh = [...wanted].filter(([key]) => !this.pulled.has(key)).map(([, value]) => value);
		const gone = [...this.pulled.keys()].filter((key) => !wanted.has(key));
		if (gone.length) {
			void this.run(() => this.dropRemote(gone));
		}
		if (fresh.length) {
			void this.run(() => this.pull(fresh)).catch((error) => this.update({ error: error instanceof Error ? error.message : 'Abonnement impossible' }));
		}
	}

	private async pull(batch: Array<{ sessionId: string; userId: string; trackName: TrackName }>): Promise<void> {
		const pc = this.pc;
		const todo = batch.filter((item) => !this.pulled.has(`${item.sessionId}:${item.trackName}`));
		if (!pc || todo.length === 0) {
			return;
		}
		const reply = await api<TracksReply>('POST', this.path('tracks'), {
			connId: this.opts.connId,
			sessionId: this.sessionId,
			tracks: todo.map(({ sessionId, trackName }) => ({ location: 'remote', sessionId, trackName })),
		});
		(reply.tracks ?? []).forEach((result, i) => {
			const item = todo[i];
			if (!item || result.errorCode || !result.mid) {
				return;
			}
			this.byMid.set(result.mid, { userId: item.userId, trackName: item.trackName });
			this.pulled.set(`${item.sessionId}:${item.trackName}`, { mid: result.mid, userId: item.userId, trackName: item.trackName });
		});
		if (reply.requiresImmediateRenegotiation && reply.sessionDescription) {
			await pc.setRemoteDescription(reply.sessionDescription);
			await pc.setLocalDescription(await pc.createAnswer());
			await gathered(pc);
			await api('PUT', this.path('renegotiate'), { connId: this.opts.connId, sessionId: this.sessionId, sessionDescription: pc.localDescription });
		}
	}

	private async dropRemote(keys: string[]): Promise<void> {
		const entries = keys.map((key) => [key, this.pulled.get(key)] as const).filter((e): e is [string, { mid: string; userId: string; trackName: TrackName }] => Boolean(e[1]));
		if (entries.length === 0) {
			return;
		}
		const remotes = { ...this.state.remotes };
		for (const [key, entry] of entries) {
			this.pulled.delete(key);
			this.byMid.delete(entry.mid);
			const slot = SLOT[entry.trackName];
			if (remotes[entry.userId]) {
				remotes[entry.userId] = { ...remotes[entry.userId], [slot]: undefined };
			}
			if (entry.trackName === 'mic') {
				this.unmeter(entry.userId);
			}
		}
		for (const [userId, media] of Object.entries(remotes)) {
			if (!media.audio && !media.cam && !media.screen && !media.screenAudio) {
				delete remotes[userId];
			}
		}
		this.update({ remotes });
		await api('PUT', this.path('tracks/close'), {
			connId: this.opts.connId,
			sessionId: this.sessionId,
			tracks: entries.map(([, entry]) => ({ mid: entry.mid })),
			force: true,
		}).catch(() => undefined);
	}

	private onTrack(event: RTCTrackEvent): void {
		const info = event.transceiver.mid ? this.byMid.get(event.transceiver.mid) : undefined;
		if (!info) {
			return;
		}
		const stream = new MediaStream([event.track]);
		const slot = SLOT[info.trackName];
		this.update({ remotes: { ...this.state.remotes, [info.userId]: { ...this.state.remotes[info.userId], [slot]: stream } } });
		if (info.trackName === 'mic') {
			this.meter(info.userId, stream);
		}
	}

	async setMuted(muted: boolean): Promise<void> {
		if (!muted && !this.local.mic) {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
				const track = stream.getAudioTracks()[0]!;
				this.local.mic = track;
				this.meter(this.opts.myId, stream);
				await this.publish('mic', track);
				this.update({ micAvailable: true, error: null });
			} catch (error) {
				this.update({ error: mediaError(error, 'micro') });
				return;
			}
		}
		if (this.local.mic) {
			this.local.mic.enabled = !muted;
		}
		const deafened = muted ? this.state.deafened : false;
		this.update({ muted, deafened });
		this.opts.sendFlags({ muted, deafened });
	}

	async setDeafened(deafened: boolean): Promise<void> {
		if (deafened) {
			this.mutedBeforeDeafen = this.state.muted;
			if (this.local.mic) {
				this.local.mic.enabled = false;
			}
			this.update({ deafened: true, muted: true });
			this.opts.sendFlags({ deafened: true, muted: true });
			return;
		}
		const muted = this.mutedBeforeDeafen || !this.local.mic;
		if (this.local.mic) {
			this.local.mic.enabled = !muted;
		}
		this.update({ deafened: false, muted });
		this.opts.sendFlags({ deafened: false, muted });
	}

	async setVideo(on: boolean): Promise<void> {
		if (on) {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
				const track = stream.getVideoTracks()[0]!;
				this.local.cam = track;
				await this.publish('cam', track);
				this.update({ video: true, localCam: stream, error: null });
				this.opts.sendFlags({ video: true });
			} catch (error) {
				this.update({ error: mediaError(error, 'caméra') });
			}
			return;
		}
		this.local.cam?.stop();
		delete this.local.cam;
		await this.transceivers.cam?.sender.replaceTrack(null);
		this.update({ video: false, localCam: null });
		this.opts.sendFlags({ video: false });
	}

	async setScreen(on: boolean): Promise<void> {
		if (on) {
			let stream: MediaStream;
			try {
				stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
			} catch (error) {
				if (!(error instanceof DOMException && error.name === 'NotAllowedError')) {
					this.update({ error: mediaError(error, 'partage d’écran') });
				}
				return;
			}
			const video = stream.getVideoTracks()[0]!;
			video.contentHint = 'detail';
			video.addEventListener('ended', () => void this.setScreen(false));
			this.local.screen = video;
			await this.publish('screen', video);
			const sound = stream.getAudioTracks()[0];
			if (sound) {
				this.local['screen-audio'] = sound;
				await this.publish('screen-audio', sound);
			}
			this.update({ screen: true, localScreen: stream });
			this.opts.sendFlags({ screen: true });
			return;
		}
		for (const name of ['screen', 'screen-audio'] as const) {
			this.local[name]?.stop();
			delete this.local[name];
			await this.transceivers[name]?.sender.replaceTrack(null);
		}
		this.update({ screen: false, localScreen: null });
		this.opts.sendFlags({ screen: false });
	}

	private meter(userId: string, stream: MediaStream): void {
		if (!this.audio) {
			return;
		}
		this.unmeter(userId);
		const source = this.audio.createMediaStreamSource(stream);
		const analyser = this.audio.createAnalyser();
		analyser.fftSize = 512;
		source.connect(analyser);
		this.meters.set(userId, { analyser, source, data: new Uint8Array(new ArrayBuffer(analyser.fftSize)) });
	}

	private unmeter(userId: string): void {
		const meter = this.meters.get(userId);
		if (meter) {
			meter.source.disconnect();
			this.meters.delete(userId);
		}
	}

	private measure(): void {
		if (this.audio?.state === 'suspended') {
			void this.audio.resume();
		}
		const speaking = new Set<string>();
		for (const [userId, { analyser, data }] of this.meters) {
			if (userId === this.opts.myId && this.state.muted) {
				continue;
			}
			analyser.getByteTimeDomainData(data);
			let sum = 0;
			for (const value of data) {
				const centered = (value - 128) / 128;
				sum += centered * centered;
			}
			if (Math.sqrt(sum / data.length) > SPEAKING_LEVEL) {
				speaking.add(userId);
			}
		}
		const before = this.state.speaking;
		if (speaking.size !== before.size || [...speaking].some((id) => !before.has(id))) {
			this.update({ speaking });
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		clearInterval(this.meterTimer);
		for (const track of Object.values(this.local)) {
			track?.stop();
		}
		this.pc?.close();
		this.pc = null;
		void this.audio?.close().catch(() => undefined);
	}

	async leave(): Promise<void> {
		this.dispose();
		await api('POST', this.path('leave'), { connId: this.opts.connId }).catch((error: unknown) => {
			if (!(error instanceof ApiError)) {
				throw error;
			}
		});
	}
}
