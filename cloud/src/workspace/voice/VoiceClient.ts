import type { VoiceFlags, VoiceParticipant } from '../../../shared/types';
import { api, ApiError } from '../../api';

type Kind = 'mic' | 'cam' | 'screen' | 'screen-audio';

export interface RemoteMedia {
	audio?: MediaStream;
	cam?: MediaStream;
	screen?: MediaStream;
	screenAudio?: MediaStream;
}

export interface VoiceSnapshot {
	channelId: string;
	status: 'connecting' | 'connected' | 'reconnecting' | 'error';
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
	onFailed: () => void;
};

type SessionDescription = { type: RTCSdpType; sdp: string };
type TrackResult = { mid?: string; trackName?: string; errorCode?: string; errorDescription?: string };
type TracksReply = { sessionDescription?: SessionDescription; requiresImmediateRenegotiation?: boolean; tracks?: TrackResult[] };
type Wanted = { sessionId: string; userId: string; trackName: string };

// Une connexion par sens : publier et recevoir sur la même fait collisionner les extensions RTP.
type Link = { role: 'publish' | 'receive'; pc: RTCPeerConnection; sessionId: string | null; queue: Promise<unknown>; watchdog?: ReturnType<typeof setTimeout> };

const SPEAKING_LEVEL = 0.035;
// Chrome met 15 à 30 s à déclarer l'échec ICE : on reconnecte plus tôt.
const CONNECT_TIMEOUT = 8000;
const RETRY_DELAYS = [700, 1500, 3000, 6000];
const RETRY_EVERY = 10_000;
// Publication pas encore prête côté SFU, ou panne passagère : on réessaie.
const RETRYABLE = new Set([
	'not_found_track_error',
	'empty_track_error',
	'retryable_transient_error',
	'temporarily_unavailable_error',
	'transport_unavailable_error',
	'internal_error',
]);

const kindOf = (name: string): Kind => (name.startsWith('screen-audio') ? 'screen-audio' : (name.split('-')[0] as Kind));

const SLOT: Record<Kind, keyof RemoteMedia> = { mic: 'audio', cam: 'cam', screen: 'screen', 'screen-audio': 'screenAudio' };

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

// Le SFU exige un transport établi avant toute renégociation qui suit la première.
function connected(pc: RTCPeerConnection, timeout = 10_000): Promise<void> {
	if (!pc.remoteDescription || pc.connectionState === 'connected') {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const done = () => {
			if (pc.connectionState === 'connected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
				pc.removeEventListener('connectionstatechange', done);
				resolve();
			}
		};
		pc.addEventListener('connectionstatechange', done);
		setTimeout(resolve, timeout);
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
	private publisher: Link | null = null;
	private receiver: Link | null = null;
	private seq = 0;
	private readonly published: Partial<Record<Kind, { transceiver: RTCRtpTransceiver; name: string }>> = {};
	private readonly local: Partial<Record<Kind, MediaStreamTrack>> = {};
	private readonly pulled = new Map<string, { mid: string; userId: string; trackName: string }>();
	private readonly byMid = new Map<string, { userId: string; trackName: string }>();
	private readonly attempts = new Map<string, number>();
	private wanted = new Map<string, Wanted>();
	private audio: AudioContext | null = null;
	private readonly meters = new Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; data: Uint8Array<ArrayBuffer> }>();
	private meterTimer: ReturnType<typeof setInterval> | undefined;
	private readonly disconnectTimers = new Map<Link, ReturnType<typeof setTimeout>>();
	private retryTimer: ReturnType<typeof setTimeout> | undefined;
	private iceServers: RTCIceServer[] = [];
	private resets: number[] = [];
	private disposed = false;
	private failed = false;
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

	private run<T>(link: Link, task: () => Promise<T>): Promise<T> {
		const next = link.queue.then(task, task);
		link.queue = next.catch(() => undefined);
		return next;
	}

	private path(suffix: string): string {
		return `/w/${this.opts.workspaceId}/voice/${suffix}`;
	}

	private diag(kind: string, detail: Record<string, unknown>): void {
		void api('POST', this.path('diag'), { kind, ua: navigator.userAgent, ...detail }).catch(() => undefined);
	}

	private link(role: Link['role'], iceServers: RTCIceServer[]): Link {
		const pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
		const link: Link = { role, pc, sessionId: null, queue: Promise.resolve() };
		pc.onconnectionstatechange = () => this.onConnectionState(link);
		return link;
	}

	// Demandée juste avant la première négociation : une session inutilisée expire côté SFU.
	private async session(link: Link): Promise<string> {
		if (!link.sessionId) {
			const created = await api<{ sessionId: string }>('POST', this.path('session'), { connId: this.opts.connId, role: link.role });
			link.sessionId = created.sessionId;
		}
		return link.sessionId;
	}

	// 410 : session perdue ; 504 : réponse perdue, état SFU inconnu. Réessayer ne suffit pas.
	private lost(link: Link, error: unknown): boolean {
		if (!(error instanceof ApiError) || (error.status !== 410 && error.status !== 504)) {
			return false;
		}
		if (link === this.receiver) {
			this.resetReceiver(`http_${error.status}`);
		} else if (link === this.publisher) {
			void this.fail(link, `http_${error.status}`);
		}
		return true;
	}

	// Seule la réception est refaite : la publication continue, les autres ne voient pas de coupure.
	private resetReceiver(reason: string): void {
		const old = this.receiver;
		if (!old || this.disposed) {
			return;
		}
		const now = Date.now();
		this.resets = [...this.resets.filter((at) => now - at < 60_000), now];
		if (this.resets.length > 3) {
			void this.fail(old, reason);
			return;
		}
		this.diag('receiver_reset', { reason });
		clearTimeout(old.watchdog);
		clearTimeout(this.disconnectTimers.get(old));
		clearTimeout(this.retryTimer);
		this.retryTimer = undefined;
		old.pc.onconnectionstatechange = null;
		old.pc.ontrack = null;
		old.pc.close();
		for (const entry of this.pulled.values()) {
			this.unmeter(entry.userId);
		}
		this.pulled.clear();
		this.byMid.clear();
		this.attempts.clear();
		this.receiver = this.link('receive', this.iceServers);
		this.receiver.pc.ontrack = (event) => this.onTrack(event);
		this.update({ remotes: {} });
		this.schedulePull();
	}

	async join(): Promise<VoiceParticipant[]> {
		const joined = await api<{ iceServers: RTCIceServer[]; participants: VoiceParticipant[] }>('POST', this.path('join'), {
			channelId: this.opts.channelId,
			connId: this.opts.connId,
		});
		this.iceServers = joined.iceServers;
		this.publisher = this.link('publish', joined.iceServers);
		this.receiver = this.link('receive', joined.iceServers);
		this.receiver.pc.ontrack = (event) => this.onTrack(event);
		this.audio = new AudioContext();
		this.meterTimer = setInterval(() => this.measure(), 150);
		this.update({ status: 'connected' });
		this.sync(joined.participants);
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
		return joined.participants;
	}

	private onConnectionState(link: Link): void {
		if (this.disposed) {
			return;
		}
		const { pc } = link;
		clearTimeout(this.disconnectTimers.get(link));
		if (pc.connectionState === 'connected') {
			const other = link === this.publisher ? this.receiver : this.publisher;
			if (!other?.pc.remoteDescription || other.pc.connectionState === 'connected') {
				this.update({ status: 'connected' });
			}
		} else if (pc.connectionState === 'disconnected') {
			// Coupure brève tolérée : le navigateur retrouve souvent le chemin seul.
			this.update({ status: 'reconnecting' });
			this.disconnectTimers.set(
				link,
				setTimeout(() => pc.connectionState === 'disconnected' && void this.fail(link, 'disconnected'), 6000),
			);
		} else if (pc.connectionState === 'failed') {
			void this.fail(link, 'failed');
		}
	}

	private armWatchdog(link: Link): void {
		if (link.watchdog || link.pc.connectionState === 'connected') {
			return;
		}
		link.watchdog = setTimeout(() => {
			if (!this.disposed && link.pc.connectionState !== 'connected') {
				void this.fail(link, 'timeout');
			}
		}, CONNECT_TIMEOUT);
	}

	private async fail(link: Link, reason: string): Promise<void> {
		if (this.disposed || this.failed) {
			return;
		}
		this.failed = true;
		let pair: Record<string, unknown> | null = null;
		try {
			const stats = await link.pc.getStats();
			stats.forEach((report) => {
				if (report.type === 'candidate-pair' && (report.nominated || report.selected)) {
					const local = stats.get(report.localCandidateId);
					const remote = stats.get(report.remoteCandidateId);
					pair = { state: report.state, local: local?.candidateType, protocol: local?.protocol, relay: local?.relayProtocol, remote: remote?.candidateType };
				}
			});
		} catch {
			// Stats indisponibles après fermeture.
		}
		this.diag('pc_failed', { role: link.role, reason, ice: link.pc.iceConnectionState, gathering: link.pc.iceGatheringState, pair });
		this.update({ status: 'reconnecting', error: null });
		this.opts.onFailed();
	}

	private publish(kind: Kind, track: MediaStreamTrack): Promise<void> {
		const link = this.publisher;
		if (!link) {
			return Promise.resolve();
		}
		return this.run(link, async () => {
			const { pc } = link;
			const existing = this.published[kind];
			if (existing) {
				await existing.transceiver.sender.replaceTrack(track);
				return;
			}
			await connected(pc);
			const sessionId = await this.session(link);
			const name = kind === 'mic' ? 'mic' : `${kind}-${++this.seq}`;
			const transceiver = pc.addTransceiver(track, { direction: 'sendonly' });
			await pc.setLocalDescription(await pc.createOffer());
			await gathered(pc);
			const reply = await api<TracksReply>('POST', this.path('tracks'), {
				connId: this.opts.connId,
				sessionId,
				sessionDescription: pc.localDescription,
				tracks: [{ location: 'local', mid: transceiver.mid, trackName: name }],
			});
			if (reply.sessionDescription) {
				await pc.setRemoteDescription(reply.sessionDescription);
				this.armWatchdog(link);
			}
			const failed = reply.tracks?.find((t) => t.errorCode);
			if (failed) {
				this.diag('publish_error', { name, code: failed.errorCode, description: failed.errorDescription });
				throw new Error('Publication refusée par le serveur vocal');
			}
			this.published[kind] = { transceiver, name };
		}).catch((error: unknown) => {
			this.lost(link, error);
			throw error;
		});
	}

	// Une piste sans paquets 30 s est supprimée par le SFU : on la ferme proprement plutôt que de la vider.
	private unpublish(kind: Kind): Promise<void> {
		const link = this.publisher;
		if (!link) {
			return Promise.resolve();
		}
		return this.run(link, async () => {
			const { pc } = link;
			const entry = this.published[kind];
			if (!entry) {
				return;
			}
			delete this.published[kind];
			await connected(pc);
			const mid = entry.transceiver.mid;
			entry.transceiver.stop();
			await pc.setLocalDescription(await pc.createOffer());
			await gathered(pc);
			const reply = await api<TracksReply>('PUT', this.path('tracks/close'), {
				connId: this.opts.connId,
				sessionId: link.sessionId,
				sessionDescription: pc.localDescription,
				tracks: [{ mid }],
				trackNames: [entry.name],
				force: false,
			});
			if (reply.sessionDescription) {
				await pc.setRemoteDescription(reply.sessionDescription);
			}
		});
	}

	sync(participants: VoiceParticipant[]): void {
		if (!this.receiver || this.disposed) {
			return;
		}
		const wanted = new Map<string, Wanted>();
		for (const p of participants) {
			if (p.userId === this.opts.myId || !p.sessionId) {
				continue;
			}
			for (const name of p.tracks) {
				wanted.set(`${p.sessionId}:${name}`, { sessionId: p.sessionId, userId: p.userId, trackName: name });
			}
		}
		this.wanted = wanted;
		const gone = [...this.pulled.keys()].filter((key) => !wanted.has(key));
		const link = this.receiver;
		if (gone.length) {
			void this.run(link, () => this.dropRemote(link, gone));
		}
		this.schedulePull();
	}

	private schedulePull(): void {
		const link = this.receiver;
		if (!link || this.disposed) {
			return;
		}
		void this.run(link, () => this.pull(link)).catch((error) => {
			if (!this.lost(link, error)) {
				this.diag('pull_exception', { message: error instanceof Error ? error.message : String(error) });
			}
		});
	}

	private async pull(link: Link): Promise<void> {
		const todo = [...this.wanted].filter(([key]) => !this.pulled.has(key));
		if (this.disposed || todo.length === 0) {
			return;
		}
		const { pc } = link;
		await connected(pc);
		const sessionId = await this.session(link);
		const reply = await api<TracksReply>('POST', this.path('tracks'), {
			connId: this.opts.connId,
			sessionId,
			tracks: todo.map(([, item]) => ({ location: 'remote', sessionId: item.sessionId, trackName: item.trackName })),
		});
		if (link !== this.receiver) {
			return;
		}
		const retry: string[] = [];
		(reply.tracks ?? []).forEach((result, i) => {
			const entry = todo[i];
			if (!entry) {
				return;
			}
			const [key, item] = entry;
			if (result.errorCode || !result.mid) {
				const attempt = (this.attempts.get(key) ?? 0) + 1;
				this.attempts.set(key, attempt);
				// Signalé une seule fois, puis on continue d'essayer tant que la piste est attendue.
				if (attempt === RETRY_DELAYS.length + 1) {
					this.diag('pull_error', { trackName: item.trackName, code: result.errorCode, description: result.errorDescription, attempt });
				}
				if (!result.errorCode || RETRYABLE.has(result.errorCode)) {
					retry.push(key);
				}
				return;
			}
			this.attempts.delete(key);
			this.byMid.set(result.mid, { userId: item.userId, trackName: item.trackName });
			this.pulled.set(key, { mid: result.mid, userId: item.userId, trackName: item.trackName });
		});
		if (reply.requiresImmediateRenegotiation && reply.sessionDescription) {
			await pc.setRemoteDescription(reply.sessionDescription);
			await pc.setLocalDescription(await pc.createAnswer());
			await gathered(pc);
			await api('PUT', this.path('renegotiate'), { connId: this.opts.connId, sessionId: link.sessionId, sessionDescription: pc.localDescription });
			this.armWatchdog(link);
		}
		if (retry.length && !this.retryTimer) {
			const attempt = Math.min(...retry.map((key) => this.attempts.get(key) ?? 1));
			this.retryTimer = setTimeout(() => {
				this.retryTimer = undefined;
				this.schedulePull();
			}, RETRY_DELAYS[attempt - 1] ?? RETRY_EVERY);
		}
	}

	private async dropRemote(link: Link, keys: string[]): Promise<void> {
		const entries = keys.flatMap((key) => {
			const entry = this.pulled.get(key);
			return entry ? [[key, entry] as const] : [];
		});
		if (entries.length === 0) {
			return;
		}
		const remotes = { ...this.state.remotes };
		for (const [key, entry] of entries) {
			this.pulled.delete(key);
			this.byMid.delete(entry.mid);
			this.attempts.delete(key);
			const slot = SLOT[kindOf(entry.trackName)];
			if (remotes[entry.userId]) {
				remotes[entry.userId] = { ...remotes[entry.userId], [slot]: undefined };
			}
			if (kindOf(entry.trackName) === 'mic') {
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
			sessionId: link.sessionId,
			tracks: entries.map(([, entry]) => ({ mid: entry.mid })),
			force: true,
		}).catch(() => undefined);
	}

	private onTrack(event: RTCTrackEvent): void {
		const info = event.transceiver.mid ? this.byMid.get(event.transceiver.mid) : undefined;
		if (!info) {
			return;
		}
		const kind = kindOf(info.trackName);
		const stream = new MediaStream([event.track]);
		this.update({ remotes: { ...this.state.remotes, [info.userId]: { ...this.state.remotes[info.userId], [SLOT[kind]]: stream } } });
		if (kind === 'mic') {
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
		// Micro coupé : la piste continue d'envoyer du silence, le SFU la garde.
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
			let stream: MediaStream;
			try {
				stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
			} catch (error) {
				this.update({ error: mediaError(error, 'caméra') });
				return;
			}
			const track = stream.getVideoTracks()[0]!;
			this.local.cam = track;
			this.update({ video: true, localCam: stream, error: null });
			try {
				await this.publish('cam', track);
				this.opts.sendFlags({ video: true });
			} catch (error) {
				track.stop();
				delete this.local.cam;
				this.update({ video: false, localCam: null, error: error instanceof Error ? error.message : 'Caméra indisponible' });
			}
			return;
		}
		this.local.cam?.stop();
		delete this.local.cam;
		this.update({ video: false, localCam: null });
		this.opts.sendFlags({ video: false });
		await this.unpublish('cam').catch(() => undefined);
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
			this.update({ screen: true, localScreen: stream, error: null });
			try {
				await this.publish('screen', video);
				const sound = stream.getAudioTracks()[0];
				if (sound) {
					this.local['screen-audio'] = sound;
					await this.publish('screen-audio', sound);
				}
				this.opts.sendFlags({ screen: true });
			} catch (error) {
				stream.getTracks().forEach((t) => t.stop());
				this.update({ screen: false, localScreen: null, error: error instanceof Error ? error.message : 'Partage indisponible' });
			}
			return;
		}
		if (!this.state.screen) {
			return;
		}
		for (const kind of ['screen', 'screen-audio'] as const) {
			this.local[kind]?.stop();
			delete this.local[kind];
		}
		this.update({ screen: false, localScreen: null });
		this.opts.sendFlags({ screen: false });
		await this.unpublish('screen').catch(() => undefined);
		await this.unpublish('screen-audio').catch(() => undefined);
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
		clearTimeout(this.retryTimer);
		this.disconnectTimers.forEach((timer) => clearTimeout(timer));
		clearTimeout(this.publisher?.watchdog);
		clearTimeout(this.receiver?.watchdog);
		for (const track of Object.values(this.local)) {
			track?.stop();
		}
		this.publisher?.pc.close();
		this.receiver?.pc.close();
		this.publisher = null;
		this.receiver = null;
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
