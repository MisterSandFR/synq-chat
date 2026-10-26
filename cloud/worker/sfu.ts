const SFU_BASE = 'https://rtc.live.cloudflare.com/v1';

export type SfuReply = { status: number; data: Record<string, unknown> };

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

export const voiceEnabled = (env: Env) => Boolean(env.REALTIME_APP_ID && env.REALTIME_APP_SECRET);

export async function sfu(env: Env, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<SfuReply> {
	const res = await fetch(`${SFU_BASE}/apps/${env.REALTIME_APP_ID}${path}`, {
		method,
		headers: { Authorization: `Bearer ${env.REALTIME_APP_SECRET}`, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	return { status: res.status, data };
}

const STUN_ONLY: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

export async function iceServers(env: Env, userId: string): Promise<IceServer[]> {
	if (!env.TURN_KEY_ID || !env.TURN_KEY_SECRET) {
		return STUN_ONLY;
	}
	const res = await fetch(`${SFU_BASE}/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${env.TURN_KEY_SECRET}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ ttl: 12 * 3600, customIdentifier: userId }),
	});
	if (!res.ok) {
		return STUN_ONLY;
	}
	const { iceServers: servers } = await res.json<{ iceServers: IceServer[] }>();
	// Port 53 bloqué par les navigateurs : attente inutile avant timeout.
	return servers.map((server) => ({
		...server,
		urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter((url) => !url.includes(':53')),
	}));
}
