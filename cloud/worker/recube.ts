import { verifyWithJwks } from 'hono/jwt';

import { sha256 } from './crypto';

export interface RecubeProfile {
	sub: string;
	email: string | null;
	emailVerified: boolean;
	name: string;
	picture: string | null;
}

interface Discovery {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	userinfo_endpoint: string;
	jwks_uri: string;
}

type Claims = Record<string, unknown>;

let cached: Discovery | null = null;

async function discover(issuer: string): Promise<Discovery> {
	if (cached?.issuer === issuer) {
		return cached;
	}
	const res = await fetch(`${issuer}/.well-known/openid-configuration`);
	if (!res.ok) {
		throw new Error(`discovery HTTP ${res.status}`);
	}
	const value = await res.json<Discovery>();
	if (value.issuer !== issuer) {
		throw new Error(`issuer inattendu : ${value.issuer}`);
	}
	cached = value;
	return value;
}

export async function authorizeUrl(env: Env, redirectUri: string, state: string, nonce: string, verifier: string): Promise<string> {
	const { authorization_endpoint } = await discover(env.RECUBE_ISSUER);
	const url = new URL(authorization_endpoint);
	url.search = new URLSearchParams({
		response_type: 'code',
		client_id: env.RECUBE_CLIENT_ID,
		redirect_uri: redirectUri,
		scope: 'openid profile email',
		state,
		nonce,
		code_challenge: await sha256(verifier),
		code_challenge_method: 'S256',
	}).toString();
	return url.toString();
}

const str = (value: unknown) => (typeof value === 'string' && value ? value : null);

export async function completeLogin(env: Env, redirectUri: string, code: string, verifier: string, nonce: string): Promise<RecubeProfile> {
	const meta = await discover(env.RECUBE_ISSUER);
	const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
	if (env.RECUBE_CLIENT_SECRET) {
		headers.Authorization = `Basic ${btoa(`${encodeURIComponent(env.RECUBE_CLIENT_ID)}:${encodeURIComponent(env.RECUBE_CLIENT_SECRET)}`)}`;
	}
	const tokenRes = await fetch(meta.token_endpoint, {
		method: 'POST',
		headers,
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			code_verifier: verifier,
			client_id: env.RECUBE_CLIENT_ID,
		}),
	});
	if (!tokenRes.ok) {
		throw new Error(`token HTTP ${tokenRes.status}`);
	}
	const tokens = await tokenRes.json<{ id_token?: string; access_token?: string }>();
	if (!tokens.id_token || !tokens.access_token) {
		throw new Error('réponse token incomplète');
	}
	const idClaims = (await verifyWithJwks(tokens.id_token, {
		jwks_uri: meta.jwks_uri,
		allowedAlgorithms: ['RS256'],
		verification: { iss: meta.issuer, aud: env.RECUBE_CLIENT_ID },
	})) as Claims;
	if (idClaims.nonce !== nonce) {
		throw new Error('nonce invalide');
	}
	const sub = str(idClaims.sub);
	if (!sub) {
		throw new Error('sub manquant');
	}

	const infoRes = await fetch(meta.userinfo_endpoint, { headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' } });
	if (!infoRes.ok) {
		throw new Error(`userinfo HTTP ${infoRes.status}`);
	}
	const info = await infoRes.json<Claims>();
	// Userinfo d'un autre sujet : réponse substituée, on rejette.
	if (info.sub !== sub) {
		throw new Error('sub userinfo différent');
	}
	const claims = { ...idClaims, ...info };
	return {
		sub,
		email: str(claims.email)?.toLowerCase() ?? null,
		emailVerified: claims.email_verified === true,
		name: str(claims.name) ?? str(claims.preferred_username) ?? 'Joueur Recube',
		picture: str(claims.picture),
	};
}
