import { Hono } from 'hono';

import { VOICE_TRACK_RE } from '../../shared/types';
import { fail, readJson, stub, unwrap, type AppEnv, type Ctx } from '../http';
import { iceServers, sfu, voiceEnabled } from '../sfu';

export const voiceRoutes = new Hono<AppEnv>();

type SessionDescription = { type: 'offer' | 'answer'; sdp: string };
type TrackRequest = { location: 'local' | 'remote'; mid?: string; trackName: string; sessionId?: string };

const isDescription = (value: unknown): value is SessionDescription =>
	typeof value === 'object' && value !== null && ['offer', 'answer'].includes((value as SessionDescription).type) && typeof (value as SessionDescription).sdp === 'string';

const sfuReply = (c: Ctx, reply: { status: number; data: Record<string, unknown> }) => c.json(reply.data, reply.status as 200);

function logSfuErrors(c: Ctx, operation: string, reply: { status: number; data: Record<string, unknown> }): void {
	const items = ((reply.data.tracks as Array<{ trackName?: string; mid?: string; errorCode?: string; errorDescription?: string }> | undefined) ?? []).filter((t) => t.errorCode);
	if (reply.status >= 300 || reply.data.errorCode || items.length) {
		console.log(
			JSON.stringify({ level: 'warn', message: 'sfu error', operation, status: reply.status, error: reply.data.errorCode ?? null, description: reply.data.errorDescription ?? null, items, user: c.get('actor').id }),
		);
	}
}

voiceRoutes.use('/w/:wid/voice/*', async (c, next) => {
	if (!voiceEnabled(c.env)) {
		return c.json({ error: 'Vocal non configuré' }, 503);
	}
	await next();
});

voiceRoutes.post('/w/:wid/voice/join', async (c) => {
	const { channelId, connId } = await readJson<{ channelId: string; connId: string }>(c);
	if (typeof channelId !== 'string' || typeof connId !== 'string') {
		return fail(c, 400, 'Requête invalide');
	}
	const joined = await stub(c).voiceJoin(c.get('actor'), connId, channelId);
	if (!joined.ok) {
		return fail(c, joined.status, joined.error);
	}
	return c.json({ iceServers: await iceServers(c.env, c.get('actor').id), participants: joined.value });
});

// Créée juste avant sa première négociation : une session SFU jamais connectée expire.
voiceRoutes.post('/w/:wid/voice/session', async (c) => {
	const { connId, role } = await readJson<{ connId: string; role: 'publish' | 'receive' }>(c);
	if (typeof connId !== 'string' || (role !== 'publish' && role !== 'receive')) {
		return fail(c, 400, 'Requête invalide');
	}
	const created = await sfu(c.env, 'POST', '/sessions/new');
	const sessionId = created.data.sessionId;
	if (typeof sessionId !== 'string') {
		return c.json({ error: 'Serveur vocal indisponible' }, 502);
	}
	const stored = await stub(c).voiceSession(c.get('actor'), connId, role, sessionId);
	if (!stored.ok) {
		return fail(c, stored.status, stored.error);
	}
	return c.json({ sessionId });
});

voiceRoutes.post('/w/:wid/voice/leave', async (c) => {
	const { connId } = await readJson<{ connId: string }>(c);
	if (typeof connId === 'string') {
		await stub(c).voiceLeave(c.get('actor'), connId);
	}
	return c.json({ ok: true });
});

voiceRoutes.post('/w/:wid/voice/tracks', async (c) => {
	const body = await readJson<{ connId: string; sessionId: string; sessionDescription: SessionDescription; tracks: TrackRequest[] }>(c);
	const { connId, sessionId, tracks } = body;
	if (typeof connId !== 'string' || typeof sessionId !== 'string' || !Array.isArray(tracks) || tracks.length === 0 || tracks.length > 32) {
		return fail(c, 400, 'Requête invalide');
	}
	const actor = c.get('actor');
	const local = tracks.every((t) => t.location === 'local');
	const remote = tracks.every((t) => t.location === 'remote');
	if (local) {
		const valid = isDescription(body.sessionDescription) && tracks.every((t) => typeof t.mid === 'string' && VOICE_TRACK_RE.test(t.trackName));
		if (!valid || !(await stub(c).voiceMayPublish(actor, connId, sessionId, tracks.map((t) => t.trackName)))) {
			return fail(c, 403, 'Publication refusée');
		}
		const reply = await sfu(c.env, 'POST', `/sessions/${sessionId}/tracks/new`, {
			sessionDescription: body.sessionDescription,
			tracks: tracks.map(({ location, mid, trackName }) => ({ location, mid, trackName })),
		});
		const results = (reply.data.tracks as Array<{ trackName: string; errorCode?: string }> | undefined) ?? [];
		logSfuErrors(c, 'publish', reply);
		const published = results.filter((t) => !t.errorCode).map((t) => t.trackName);
		if (reply.status < 300 && published.length) {
			await stub(c).voicePublished(actor, connId, sessionId, published);
		}
		return sfuReply(c, reply);
	}
	if (remote) {
		const remoteIds = tracks.map((t) => t.sessionId);
		const valid = remoteIds.every((id) => typeof id === 'string') && tracks.every((t) => VOICE_TRACK_RE.test(t.trackName));
		if (!valid || !(await stub(c).voiceCanPull(actor, connId, sessionId, remoteIds as string[]))) {
			return fail(c, 403, 'Abonnement refusé');
		}
		const reply = await sfu(c.env, 'POST', `/sessions/${sessionId}/tracks/new`, {
			tracks: tracks.map(({ location, sessionId: remoteSession, trackName }) => ({ location, sessionId: remoteSession, trackName })),
		});
		logSfuErrors(c, 'pull', reply);
		return sfuReply(c, reply);
	}
	return fail(c, 400, 'Pistes locales et distantes mélangées');
});

voiceRoutes.put('/w/:wid/voice/renegotiate', async (c) => {
	const { connId, sessionId, sessionDescription } = await readJson<{ connId: string; sessionId: string; sessionDescription: SessionDescription }>(c);
	if (typeof connId !== 'string' || typeof sessionId !== 'string' || !isDescription(sessionDescription)) {
		return fail(c, 400, 'Requête invalide');
	}
	if (!(await stub(c).voiceOwns(c.get('actor'), connId, sessionId))) {
		return fail(c, 403, 'Session inconnue');
	}
	const reply = await sfu(c.env, 'PUT', `/sessions/${sessionId}/renegotiate`, { sessionDescription });
	logSfuErrors(c, 'renegotiate', reply);
	return sfuReply(c, reply);
});

voiceRoutes.put('/w/:wid/voice/tracks/close', async (c) => {
	const body = await readJson<{
		connId: string;
		sessionId: string;
		sessionDescription: SessionDescription;
		tracks: Array<{ mid: string }>;
		force: boolean;
		trackNames: string[];
	}>(c);
	const { connId, sessionId, tracks } = body;
	if (typeof connId !== 'string' || typeof sessionId !== 'string' || !Array.isArray(tracks) || !tracks.every((t) => typeof t.mid === 'string')) {
		return fail(c, 400, 'Requête invalide');
	}
	if (!(await stub(c).voiceOwns(c.get('actor'), connId, sessionId))) {
		return fail(c, 403, 'Session inconnue');
	}
	const reply = await sfu(c.env, 'PUT', `/sessions/${sessionId}/tracks/close`, {
		tracks: tracks.map(({ mid }) => ({ mid })),
		...(isDescription(body.sessionDescription) ? { sessionDescription: body.sessionDescription } : {}),
		force: body.force === true,
	});
	const names = Array.isArray(body.trackNames) ? body.trackNames.filter((n) => typeof n === 'string' && VOICE_TRACK_RE.test(n)) : [];
	if (reply.status < 300 && names.length) {
		await stub(c).voiceUnpublished(c.get('actor'), connId, sessionId, names);
	}
	return sfuReply(c, reply);
});

voiceRoutes.post('/w/:wid/voice/move', async (c) => {
	const { userId, channelId } = await readJson<{ userId: string; channelId: string }>(c);
	if (typeof userId !== 'string' || typeof channelId !== 'string') {
		return fail(c, 400, 'Requête invalide');
	}
	return unwrap(c, await stub(c).voiceMove(c.get('actor'), userId, channelId));
});

voiceRoutes.post('/w/:wid/voice/moderate', async (c) => {
	const { userId, action } = await readJson<{ userId: string; action: 'mute' | 'kick' }>(c);
	if (typeof userId !== 'string' || (action !== 'mute' && action !== 'kick')) {
		return fail(c, 400, 'Requête invalide');
	}
	return unwrap(c, await stub(c).voiceModerate(c.get('actor'), userId, action));
});

// Diagnostic envoyé par le navigateur quand le média échoue : seule trace côté serveur d'un souci WebRTC.
voiceRoutes.post('/w/:wid/voice/diag', async (c) => {
	const body = await readJson<Record<string, unknown>>(c);
	console.log(JSON.stringify({ level: 'warn', message: 'voice diag', user: c.get('actor').id, detail: JSON.stringify(body).slice(0, 4000) }));
	return c.json({ ok: true });
});
