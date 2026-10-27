import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { ALL_PERMS, DEFAULT_GRADE, P, has } from '../shared/permissions';
import {
	ACCENTS,
	LIMITS,
	type Actor,
	type Attachment,
	type ChannelInput,
	type ChannelOverrides,
	type Grade,
	type Me,
	type Member,
	type User,
	type WorkspaceDetail,
	type WorkspaceSummary,
} from '../shared/types';
import { DUMMY_HASH, hashPassword, randomToken, sha256, verifyPassword } from './crypto';
import { cleanName, denyUnless, fail, readJson, stub, unwrap, workspaceStub, type Ctx, type AppEnv } from './http';
import { resolveAttachments } from './media';
import { authorizeUrl, completeLogin } from './recube';
import { defaultGrades, listGrades, loadActor, loadActors } from './grades';
import { notificationRoutes } from './routes/notifications';
import { mediaRoutes } from './routes/media';
import { categoryRoutes, cleanOverrides } from './routes/categories';
import { commandRoutes } from './routes/commands';
import { rcRoutes } from './routes/rc';
import { chatRoutes } from './routes/chat';
import { dmThreadsRoutes } from './routes/dm-threads';
import { voiceRoutes } from './routes/voice';

const SESSION_COOKIE = 'synq_session';
const OAUTH_COOKIE = 'synq_oauth';
const OAUTH_TTL = 10 * 60 * 1000;
const SESSION_TTL = 30 * 24 * 3600 * 1000;
const INVITE_TTL = 7 * 24 * 3600 * 1000;
// Médias non exécutables uniquement : ni HTML ni SVG servis en ligne sur l'origine.
const INLINE_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'image/avif',
	'video/mp4',
	'video/webm',
	'audio/mpeg',
	'audio/ogg',
	'audio/wav',
	'audio/webm',
	'audio/mp4',
]);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function limited(c: Ctx, key: string): Promise<boolean> {
	const ip = c.req.header('cf-connecting-ip') ?? 'local';
	const { success } = await c.env.AUTH_LIMITER.limit({ key: `${key}:${ip}` });
	return !success;
}

async function sessionUser(c: Ctx): Promise<User | null> {
	const token = getCookie(c, SESSION_COOKIE);
	if (!token) {
		return null;
	}
	return c.env.DB.prepare(
		'SELECT u.id, u.email, u.name, u.avatar_url AS avatarUrl FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?',
	)
		.bind(await sha256(token), Date.now())
		.first<User>();
}

const callbackUrl = (c: Ctx) => `${new URL(c.req.url).origin}/api/auth/recube/callback`;

const safeAvatar = (url: string | null) => (url?.startsWith('https://') ? url.slice(0, 500) : null);

async function openSession(c: Ctx, userId: string): Promise<void> {
	const token = randomToken();
	const now = Date.now();
	await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
		.bind(await sha256(token), userId, now + SESSION_TTL, now)
		.run();
	setCookie(c, SESSION_COOKIE, token, {
		httpOnly: true,
		secure: true,
		sameSite: 'Lax',
		path: '/',
		maxAge: SESSION_TTL / 1000,
	});
}

const app = new Hono<AppEnv>().basePath('/api');

app.onError((error, c) => {
	console.error(JSON.stringify({ level: 'error', path: c.req.path, error: String(error) }));
	return c.json({ error: 'Erreur interne' }, 500);
});

// Mutation ou WebSocket depuis une autre origine : refus (CSRF, CSWSH).
app.use('*', async (c, next) => {
	const origin = c.req.header('Origin');
	const unsafe = c.req.method !== 'GET' || c.req.header('Upgrade') === 'websocket';
	if (unsafe && origin && new URL(origin).host !== new URL(c.req.url).host) {
		return fail(c, 403, 'Origine refusée');
	}
	await next();
});

app.post('/auth/signup', async (c) => {
	const body = await readJson<{ email: string; name: string; password: string }>(c);
	const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	const name = cleanName(body.name);
	const password = typeof body.password === 'string' ? body.password : '';
	if (await limited(c, 'signup')) {
		return fail(c, 429, 'Trop de tentatives, réessaie dans une minute');
	}
	if (!EMAIL_RE.test(email) || email.length > 254) {
		return fail(c, 400, 'Email invalide');
	}
	if (!name) {
		return fail(c, 400, 'Nom requis');
	}
	if (password.length < 8 || password.length > 256) {
		return fail(c, 400, 'Mot de passe : 8 caractères minimum');
	}
	const id = crypto.randomUUID();
	const inserted = await c.env.DB.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (email) DO NOTHING')
		.bind(id, email, name, await hashPassword(password), Date.now())
		.run();
	if (!inserted.meta.changes) {
		return fail(c, 409, 'Un compte existe déjà avec cet email');
	}
	await openSession(c, id);
	return c.json({ id, email, name, avatarUrl: null } satisfies User, 201);
});

app.post('/auth/login', async (c) => {
	const body = await readJson<{ email: string; password: string }>(c);
	const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
	const password = typeof body.password === 'string' ? body.password : '';
	if (await limited(c, `login:${email}`)) {
		return fail(c, 429, 'Trop de tentatives, réessaie dans une minute');
	}
	const row = await c.env.DB.prepare('SELECT id, email, name, avatar_url AS avatarUrl, password_hash FROM users WHERE email = ?')
		.bind(email)
		.first<User & { password_hash: string }>();
	const valid = await verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
	if (!row || !valid) {
		return fail(c, 401, 'Email ou mot de passe incorrect');
	}
	await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(row.id, Date.now()).run();
	await openSession(c, row.id);
	return c.json({ id: row.id, email: row.email, name: row.name, avatarUrl: row.avatarUrl } satisfies User);
});

app.post('/auth/logout', async (c) => {
	const token = getCookie(c, SESSION_COOKIE);
	if (token) {
		await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
	}
	deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
	return c.json({ ok: true });
});

app.get('/auth/providers', (c) => c.json({ recube: Boolean(c.env.RECUBE_CLIENT_ID) }));

app.get('/auth/recube/start', async (c) => {
	if (!c.env.RECUBE_CLIENT_ID) {
		return fail(c, 404, 'SSO Recube non configuré');
	}
	let linkUserId: string | null = null;
	if (c.req.query('link') === '1') {
		const user = await sessionUser(c);
		if (!user) {
			return c.redirect('/?sso_error=session');
		}
		linkUserId = user.id;
	}
	const state = randomToken();
	const nonce = randomToken();
	const verifier = randomToken(48);
	const now = Date.now();
	await c.env.DB.batch([
		c.env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(now),
		c.env.DB.prepare('INSERT INTO oauth_states (state, verifier, nonce, link_user_id, expires_at) VALUES (?, ?, ?, ?, ?)').bind(
			state,
			verifier,
			nonce,
			linkUserId,
			now + OAUTH_TTL,
		),
	]);
	// State lié au navigateur : bloque le login CSRF.
	setCookie(c, OAUTH_COOKIE, state, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/api/auth/recube', maxAge: OAUTH_TTL / 1000 });
	return c.redirect(await authorizeUrl(c.env, callbackUrl(c), state, nonce, verifier));
});

app.get('/auth/recube/callback', async (c) => {
	const state = c.req.query('state');
	const expected = getCookie(c, OAUTH_COOKIE);
	deleteCookie(c, OAUTH_COOKIE, { path: '/api/auth/recube', secure: true });
	if (!state || state !== expected) {
		return c.redirect('/?sso_error=state');
	}
	const pending = await c.env.DB.prepare('DELETE FROM oauth_states WHERE state = ? AND expires_at > ? RETURNING verifier, nonce, link_user_id')
		.bind(state, Date.now())
		.first<{ verifier: string; nonce: string; link_user_id: string | null }>();
	if (!pending) {
		return c.redirect('/?sso_error=state');
	}
	const code = c.req.query('code');
	if (c.req.query('error') || !code) {
		return c.redirect('/?sso_error=denied');
	}
	let profile;
	try {
		profile = await completeLogin(c.env, callbackUrl(c), code, pending.verifier, pending.nonce);
	} catch (error) {
		console.error(JSON.stringify({ level: 'error', message: 'recube sso', error: String(error) }));
		return c.redirect('/?sso_error=provider');
	}
	const avatar = safeAvatar(profile.picture);
	const linked = await c.env.DB.prepare("SELECT user_id FROM identities WHERE provider = 'recube' AND subject = ?")
		.bind(profile.sub)
		.first<{ user_id: string }>();

	if (pending.link_user_id) {
		if (linked && linked.user_id !== pending.link_user_id) {
			return c.redirect('/?sso_error=already_linked');
		}
		if (!linked) {
			const inserted = await c.env.DB.prepare(
				"INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('recube', ?, ?, ?) ON CONFLICT DO NOTHING",
			)
				.bind(profile.sub, pending.link_user_id, Date.now())
				.run();
			if (!inserted.meta.changes) {
				return c.redirect('/?sso_error=already_linked');
			}
		}
		await c.env.DB.prepare('UPDATE users SET avatar_url = COALESCE(avatar_url, ?) WHERE id = ?').bind(avatar, pending.link_user_id).run();
		return c.redirect('/?linked=recube');
	}

	if (linked) {
		// Avatar envoyé par l'utilisateur prioritaire sur celui de Recube.
		await c.env.DB.prepare("UPDATE users SET avatar_url = CASE WHEN avatar_url LIKE '/api/avatars/%' THEN avatar_url ELSE ? END WHERE id = ?")
			.bind(avatar, linked.user_id)
			.run();
		await openSession(c, linked.user_id);
		return c.redirect('/');
	}

	// Jamais de fusion sur l'email : le titulaire du compte local doit lier lui-même.
	const email = profile.email && profile.emailVerified ? profile.email : `${profile.sub}@recube.invalid`;
	const taken = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
	if (taken) {
		return c.redirect('/?sso_error=email_exists');
	}
	const id = crypto.randomUUID();
	const now = Date.now();
	await c.env.DB.batch([
		c.env.DB.prepare("INSERT INTO users (id, email, name, password_hash, avatar_url, created_at) VALUES (?, ?, ?, '', ?, ?)").bind(
			id,
			email,
			profile.name.slice(0, LIMITS.nameLength),
			avatar,
			now,
		),
		c.env.DB.prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('recube', ?, ?, ?)").bind(profile.sub, id, now),
	]);
	await openSession(c, id);
	return c.redirect('/');
});

// Tout ce qui suit exige une session.
app.use('*', async (c, next) => {
	const user = await sessionUser(c);
	if (!user) {
		return fail(c, 401, 'Non connecté');
	}
	c.set('user', user);
	await next();
});

app.get('/me', async (c) => {
	const user = c.get('user');
	const { results } = await c.env.DB.prepare(
		"SELECT w.id, w.name, w.accent, m.role = 'owner' AS owner FROM members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY w.name COLLATE NOCASE",
	)
		.bind(user.id)
		.all<Omit<WorkspaceSummary, 'owner'> & { owner: number }>();
	const [identities, account] = await c.env.DB.batch([
		c.env.DB.prepare('SELECT provider FROM identities WHERE user_id = ?').bind(user.id),
		c.env.DB.prepare("SELECT password_hash != '' AS has_password FROM users WHERE id = ?").bind(user.id),
	]);
	return c.json({
		user,
		workspaces: results.map((w) => ({ ...w, owner: w.owner === 1 })),
		identities: (identities!.results as { provider: string }[]).map((row) => row.provider),
		hasPassword: (account!.results[0] as { has_password: number }).has_password === 1,
	} satisfies Me);
});

app.delete('/me/identities/recube', async (c) => {
	const user = c.get('user');
	const account = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first<{ password_hash: string }>();
	if (!account?.password_hash) {
		return fail(c, 400, 'Compte sans mot de passe : la liaison Recube est ton seul accès');
	}
	await c.env.DB.prepare("DELETE FROM identities WHERE user_id = ? AND provider = 'recube'").bind(user.id).run();
	return c.json({ ok: true });
});

app.patch('/me', async (c) => {
	const user = c.get('user');
	const name = cleanName((await readJson<{ name: string }>(c)).name);
	if (!name) {
		return fail(c, 400, 'Nom requis');
	}
	await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, user.id).run();
	const { results } = await c.env.DB.prepare('SELECT workspace_id FROM members WHERE user_id = ?').bind(user.id).all<{ workspace_id: string }>();
	await Promise.all(results.map((row) => workspaceStub(c.env, row.workspace_id).membersChanged()));
	return c.json({ ...user, name } satisfies User);
});

app.post('/workspaces', async (c) => {
	const user = c.get('user');
	const body = await readJson<{ name: string; accent: string }>(c);
	const name = cleanName(body.name);
	const accent = typeof body.accent === 'string' && HEX_RE.test(body.accent) ? body.accent.toUpperCase() : ACCENTS[0];
	if (!name) {
		return fail(c, 400, 'Nom d’espace requis');
	}
	const id = crypto.randomUUID();
	const now = Date.now();
	await c.env.DB.batch([
		c.env.DB.prepare('INSERT INTO workspaces (id, name, owner_id, accent, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, name, user.id, accent, now),
		c.env.DB.prepare("INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, now),
		...defaultGrades(c.env.DB, id),
	]);
	const channels = await workspaceStub(c.env, id).setup();
	return c.json({ id, name, accent, owner: true, channels }, 201);
});

app.get('/invites/:code', async (c) => {
	const invite = await c.env.DB.prepare(
		'SELECT w.id, w.name FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.code = ? AND i.expires_at > ?',
	)
		.bind(c.req.param('code'), Date.now())
		.first<{ id: string; name: string }>();
	return invite ? c.json({ workspaceId: invite.id, workspaceName: invite.name }) : fail(c, 404, 'Invitation invalide ou expirée');
});

app.post('/invites/:code/accept', async (c) => {
	const user = c.get('user');
	const invite = await c.env.DB.prepare('SELECT workspace_id FROM invites WHERE code = ? AND expires_at > ?')
		.bind(c.req.param('code'), Date.now())
		.first<{ workspace_id: string }>();
	if (!invite) {
		return fail(c, 404, 'Invitation invalide ou expirée');
	}
	const inserted = await c.env.DB.prepare(
		"INSERT INTO members (workspace_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?) ON CONFLICT DO NOTHING",
	)
		.bind(invite.workspace_id, user.id, Date.now())
		.run();
	if (inserted.meta.changes) {
		await workspaceStub(c.env, invite.workspace_id).memberJoined(user.id);
	}
	return c.json({ workspaceId: invite.workspace_id });
});

// Routes d'espace : membre requis, grades et permissions relus à chaque requête.
app.use('/w/:wid/*', async (c, next) => {
	const workspaceId = c.req.param('wid');
	const actor = await loadActor(c.env.DB, workspaceId, c.get('user').id);
	if (!actor) {
		return fail(c, 404, 'Espace introuvable');
	}
	c.set('workspaceId', workspaceId);
	c.set('actor', actor);
	await next();
});

const refreshActors = async (c: Ctx) => stub(c).refreshActors(await loadActors(c.env.DB, c.get('workspaceId')));

app.get('/w/:wid/info', async (c) => {
	const workspaceId = c.get('workspaceId');
	const actor = c.get('actor');
	const [workspace, members, links] = await c.env.DB.batch([
		c.env.DB.prepare('SELECT id, name, accent FROM workspaces WHERE id = ?').bind(workspaceId),
		c.env.DB.prepare(
			"SELECT u.id, u.name, u.avatar_url AS avatarUrl, m.role = 'owner' AS owner FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? ORDER BY u.name COLLATE NOCASE",
		).bind(workspaceId),
		c.env.DB.prepare('SELECT user_id, grade_id FROM member_grades WHERE workspace_id = ?').bind(workspaceId),
	]);
	const gradesOf = new Map<string, string[]>();
	for (const link of links!.results as Array<{ user_id: string; grade_id: string }>) {
		gradesOf.set(link.user_id, [...(gradesOf.get(link.user_id) ?? []), link.grade_id]);
	}
	const { id, name, accent } = workspace!.results[0] as { id: string; name: string; accent: string };
	return c.json({
		id,
		name,
		accent,
		owner: actor.owner,
		perms: actor.perms,
		top: actor.top,
		grades: await listGrades(c.env.DB, workspaceId),
		members: (members!.results as Array<Omit<Member, 'owner' | 'gradeIds'> & { owner: number }>).map((m) => ({
			...m,
			owner: m.owner === 1,
			gradeIds: gradesOf.get(m.id) ?? [],
		})),
	} satisfies WorkspaceDetail);
});

app.patch('/w/:wid/info', async (c) => {
	const denied = denyUnless(c, P.MANAGE_WORKSPACE);
	if (denied) {
		return denied;
	}
	const body = await readJson<{ name: string; accent: string }>(c);
	const name = body.name === undefined ? null : cleanName(body.name);
	if (name === '') {
		return fail(c, 400, 'Nom d’espace requis');
	}
	const accent = typeof body.accent === 'string' && HEX_RE.test(body.accent) ? body.accent.toUpperCase() : null;
	if (body.accent !== undefined && !accent) {
		return fail(c, 400, 'Couleur invalide');
	}
	await c.env.DB.prepare('UPDATE workspaces SET name = COALESCE(?, name), accent = COALESCE(?, accent) WHERE id = ?')
		.bind(name, accent, c.get('workspaceId'))
		.run();
	await stub(c).membersChanged();
	return c.json({ ok: true });
});

app.delete('/w/:wid/info', async (c) => {
	if (!c.get('actor').owner) {
		return fail(c, 403, 'Réservé au propriétaire');
	}
	await stub(c).destroy();
	await c.env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(c.get('workspaceId')).run();
	return c.json({ ok: true });
});

app.post('/w/:wid/invites', async (c) => {
	const denied = denyUnless(c, P.CREATE_INVITES);
	if (denied) {
		return denied;
	}
	const code = randomToken(9);
	const now = Date.now();
	await c.env.DB.prepare('INSERT INTO invites (code, workspace_id, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
		.bind(code, c.get('workspaceId'), c.get('actor').id, now + INVITE_TTL, now)
		.run();
	return c.json({ code, expiresAt: now + INVITE_TTL }, 201);
});

app.delete('/w/:wid/members/:uid', async (c) => {
	const actor = c.get('actor');
	const targetId = c.req.param('uid');
	const target = await loadActor(c.env.DB, c.get('workspaceId'), targetId);
	if (!target) {
		return fail(c, 404, 'Membre introuvable');
	}
	const self = targetId === actor.id;
	if (target.owner) {
		return fail(c, 403, self ? 'Le propriétaire ne peut pas quitter son espace' : 'Impossible de retirer le propriétaire');
	}
	const allowed = self || actor.owner || (has(actor.perms, P.KICK_MEMBERS) && target.top < actor.top);
	if (!allowed) {
		return fail(c, 403, 'Retrait non autorisé');
	}
	await c.env.DB.prepare('DELETE FROM members WHERE workspace_id = ? AND user_id = ?').bind(c.get('workspaceId'), targetId).run();
	await stub(c).memberRemoved(targetId);
	return c.json({ ok: true });
});

// Grades : on ne touche qu'aux grades strictement sous son plus haut grade.
app.get('/w/:wid/grades', async (c) => c.json(await listGrades(c.env.DB, c.get('workspaceId'))));

const gradeInput = async (c: Ctx) => {
	const body = await readJson<{ name: string; color: string; permissions: number }>(c);
	return {
		name: body.name === undefined ? undefined : cleanName(body.name).slice(0, 32),
		color: body.color === undefined ? undefined : body.color === '' || (typeof body.color === 'string' && HEX_RE.test(body.color)) ? body.color.toUpperCase() : null,
		permissions: body.permissions === undefined ? undefined : Number.isInteger(body.permissions) ? body.permissions & ALL_PERMS : null,
	};
};

// Un grade ne peut recevoir que des permissions que son auteur possède.
const grantable = (actor: Actor, permissions: number) => actor.owner || has(actor.perms, P.ADMINISTRATOR) || (permissions & ~actor.perms) === 0;

app.post('/w/:wid/grades', async (c) => {
	const denied = denyUnless(c, P.MANAGE_GRADES);
	if (denied) {
		return denied;
	}
	const actor = c.get('actor');
	const input = await gradeInput(c);
	if (!input.name) {
		return fail(c, 400, 'Nom du grade requis');
	}
	if (input.color === null || input.permissions === null) {
		return fail(c, 400, 'Couleur ou permissions invalides');
	}
	const permissions = input.permissions ?? 0;
	if (!grantable(actor, permissions)) {
		return fail(c, 403, 'Tu ne peux pas donner une permission que tu n’as pas');
	}
	const workspaceId = c.get('workspaceId');
	const id = crypto.randomUUID();
	// Nouveau grade juste au-dessus du grade par défaut.
	await c.env.DB.batch([
		c.env.DB.prepare('UPDATE grades SET position = position + 1 WHERE workspace_id = ? AND position >= 1').bind(workspaceId),
		c.env.DB.prepare('INSERT INTO grades (workspace_id, id, name, color, position, permissions) VALUES (?, ?, ?, ?, 1, ?)').bind(
			workspaceId,
			id,
			input.name,
			input.color ?? '',
			permissions,
		),
	]);
	await refreshActors(c);
	return c.json((await listGrades(c.env.DB, workspaceId)).find((g) => g.id === id), 201);
});

const editableGrade = async (c: Ctx, gradeId: string) => {
	const actor = c.get('actor');
	const grade = await c.env.DB.prepare('SELECT id, name, color, position, permissions FROM grades WHERE workspace_id = ? AND id = ?')
		.bind(c.get('workspaceId'), gradeId)
		.first<Grade>();
	if (!grade) {
		return { error: fail(c, 404, 'Grade introuvable') };
	}
	if (!has(actor.perms, P.MANAGE_GRADES) || (!actor.owner && grade.position >= actor.top && grade.id !== DEFAULT_GRADE)) {
		return { error: fail(c, 403, 'Grade égal ou supérieur au tien') };
	}
	return { grade };
};

app.patch('/w/:wid/grades/:gid', async (c) => {
	const { grade, error } = await editableGrade(c, c.req.param('gid'));
	if (error) {
		return error;
	}
	const input = await gradeInput(c);
	if (input.name === '' || input.color === null || input.permissions === null) {
		return fail(c, 400, 'Nom, couleur ou permissions invalides');
	}
	const actor = c.get('actor');
	const permissions = input.permissions ?? grade.permissions;
	if (!grantable(actor, permissions & ~grade.permissions)) {
		return fail(c, 403, 'Tu ne peux pas donner une permission que tu n’as pas');
	}
	await c.env.DB.prepare('UPDATE grades SET name = ?, color = ?, permissions = ? WHERE workspace_id = ? AND id = ?')
		.bind(input.name ?? grade.name, input.color ?? grade.color, permissions, c.get('workspaceId'), grade.id)
		.run();
	await refreshActors(c);
	return c.json({ ...grade, name: input.name ?? grade.name, color: input.color ?? grade.color, permissions } satisfies Grade);
});

app.delete('/w/:wid/grades/:gid', async (c) => {
	const { grade, error } = await editableGrade(c, c.req.param('gid'));
	if (error) {
		return error;
	}
	if (grade.id === DEFAULT_GRADE) {
		return fail(c, 400, 'Le grade par défaut ne peut pas être supprimé');
	}
	const workspaceId = c.get('workspaceId');
	await c.env.DB.batch([
		c.env.DB.prepare('DELETE FROM grades WHERE workspace_id = ? AND id = ?').bind(workspaceId, grade.id),
		c.env.DB.prepare('UPDATE grades SET position = position - 1 WHERE workspace_id = ? AND position > ?').bind(workspaceId, grade.position),
	]);
	await stub(c).gradeDeleted(grade.id);
	await refreshActors(c);
	return c.json({ ok: true });
});

// Ordre complet des grades hors défaut, du plus bas au plus haut ; les grades au-dessus de soi restent en place.
app.put('/w/:wid/grades/order', async (c) => {
	const denied = denyUnless(c, P.MANAGE_GRADES);
	if (denied) {
		return denied;
	}
	const actor = c.get('actor');
	const { ids } = await readJson<{ ids: string[] }>(c);
	const workspaceId = c.get('workspaceId');
	const grades = (await listGrades(c.env.DB, workspaceId)).filter((g) => g.id !== DEFAULT_GRADE);
	if (!Array.isArray(ids) || ids.length !== grades.length || new Set(ids).size !== ids.length || !ids.every((id) => grades.some((g) => g.id === id))) {
		return fail(c, 400, 'Ordre invalide');
	}
	const position = (id: string) => ids.indexOf(id) + 1;
	const locked = grades.filter((g) => !actor.owner && g.position >= actor.top);
	if (locked.some((g) => position(g.id) !== g.position)) {
		return fail(c, 403, 'Tu ne peux pas déplacer un grade égal ou supérieur au tien');
	}
	await c.env.DB.batch(ids.map((id) => c.env.DB.prepare('UPDATE grades SET position = ? WHERE workspace_id = ? AND id = ?').bind(position(id), workspaceId, id)));
	await refreshActors(c);
	return c.json(await listGrades(c.env.DB, workspaceId));
});

app.put('/w/:wid/members/:uid/grades', async (c) => {
	const denied = denyUnless(c, P.MANAGE_GRADES);
	if (denied) {
		return denied;
	}
	const actor = c.get('actor');
	const workspaceId = c.get('workspaceId');
	const targetId = c.req.param('uid');
	const target = await loadActor(c.env.DB, workspaceId, targetId);
	if (!target) {
		return fail(c, 404, 'Membre introuvable');
	}
	if (target.owner || (!actor.owner && targetId !== actor.id && target.top >= actor.top)) {
		return fail(c, 403, 'Membre de grade égal ou supérieur au tien');
	}
	const { gradeIds } = await readJson<{ gradeIds: string[] }>(c);
	const grades = await listGrades(c.env.DB, workspaceId);
	const wanted = new Set(Array.isArray(gradeIds) ? gradeIds.filter((id) => id !== DEFAULT_GRADE) : []);
	if (![...wanted].every((id) => grades.some((g) => g.id === id))) {
		return fail(c, 400, 'Grade inconnu');
	}
	// Seuls les grades sous le sien peuvent être ajoutés ou retirés.
	const current = new Set(target.grades.filter((id) => id !== DEFAULT_GRADE));
	const changed = grades.filter((g) => wanted.has(g.id) !== current.has(g.id));
	if (!actor.owner && changed.some((g) => g.position >= actor.top)) {
		return fail(c, 403, 'Tu ne peux attribuer que des grades inférieurs au tien');
	}
	await c.env.DB.batch([
		c.env.DB.prepare('DELETE FROM member_grades WHERE workspace_id = ? AND user_id = ?').bind(workspaceId, targetId),
		...[...wanted].map((id) => c.env.DB.prepare('INSERT INTO member_grades (workspace_id, user_id, grade_id) VALUES (?, ?, ?)').bind(workspaceId, targetId, id)),
	]);
	await refreshActors(c);
	return c.json({ gradeIds: [...wanted] });
});

app.get('/w/:wid/channels', async (c) => c.json(await stub(c).channels(c.get('actor'))));

app.post('/w/:wid/channels', async (c) => unwrap(c, await stub(c).createChannel(c.get('actor'), await readJson<ChannelInput>(c))));

app.patch('/w/:wid/channels/:cid', async (c) =>
	unwrap(c, await stub(c).updateChannel(c.get('actor'), c.req.param('cid'), await readJson<ChannelInput>(c))),
);

app.delete('/w/:wid/channels/:cid', async (c) => unwrap(c, await stub(c).deleteChannel(c.get('actor'), c.req.param('cid'))));

app.get('/w/:wid/channels/:cid/overrides', async (c) => unwrap(c, await stub(c).getOverrides(c.get('actor'), c.req.param('cid'))));

app.put('/w/:wid/channels/:cid/overrides', async (c) => {
	const clean = await cleanOverrides(c, (await readJson<{ overrides: ChannelOverrides }>(c)).overrides);
	if (!clean) {
		return fail(c, 400, 'Surcharges invalides');
	}
	return unwrap(c, await stub(c).setOverrides(c.get('actor'), c.req.param('cid'), clean));
});

const cursor = (value: string | undefined) => {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : undefined;
};

app.get('/w/:wid/channels/:cid/messages', async (c) =>
	unwrap(
		c,
		await stub(c).listMessages(c.get('actor'), c.req.param('cid'), {
			before: cursor(c.req.query('before')),
			after: cursor(c.req.query('after')),
			around: cursor(c.req.query('around')),
		}),
	),
);

app.get('/w/:wid/search', async (c) => {
	const q = (c.req.query('q') ?? '').slice(0, 200);
	return c.json(await stub(c).search(c.get('actor'), q));
});

app.post('/w/:wid/channels/:cid/messages', async (c) => {
	const body = await readJson<{ body: string; attachmentKey: string; attachmentKeys: string[]; replyTo: number }>(c);
	// `attachmentKey` seul : clients d'avant les pièces jointes multiples.
	const keys: unknown[] = Array.isArray(body.attachmentKeys) ? body.attachmentKeys : body.attachmentKey === undefined ? [] : [body.attachmentKey];
	const attachments = await resolveAttachments(c.env.FILES, c.get('workspaceId'), keys);
	if (!attachments.ok) {
		return fail(c, attachments.status, attachments.error);
	}
	const text = typeof body.body === 'string' ? body.body : '';
	const replyTo = Number.isInteger(body.replyTo) ? (body.replyTo as number) : null;
	return unwrap(c, await stub(c).postMessage(c.get('actor'), c.req.param('cid'), text, attachments.value, replyTo));
});

app.patch('/w/:wid/messages/:mid', async (c) => {
	const { body } = await readJson<{ body: string }>(c);
	return unwrap(c, await stub(c).editMessage(c.get('actor'), Number(c.req.param('mid')), typeof body === 'string' ? body : ''));
});

app.delete('/w/:wid/messages/:mid', async (c) => unwrap(c, await stub(c).deleteMessage(c.get('actor'), Number(c.req.param('mid')))));

app.post('/w/:wid/channels/:cid/read', async (c) => {
	await stub(c).markRead(c.get('actor').id, c.req.param('cid'));
	return c.json({ ok: true });
});

// Flux direct vers R2 : la taille annoncée sert de plafond, rien n'est bufferisé.
async function storeUpload(c: Ctx): Promise<Attachment | Response> {
	const size = Number(c.req.header('Content-Length'));
	if (!Number.isInteger(size) || size <= 0) {
		return fail(c, 400, 'Fichier vide ou taille inconnue');
	}
	if (size > LIMITS.fileSize) {
		return fail(c, 413, 'Fichier trop lourd (50 Mo max)');
	}
	let name = 'fichier';
	try {
		name = decodeURIComponent(c.req.header('X-File-Name') ?? '') || name;
	} catch {
		// Nom mal encodé : nom générique.
	}
	name = name.replace(/[/\\\0]/g, '_').slice(0, 120);
	const type = c.req.header('Content-Type')?.split(';')[0]?.trim() || 'application/octet-stream';
	const key = `w/${c.get('workspaceId')}/${crypto.randomUUID()}`;
	const stream = new FixedLengthStream(size);
	const [object] = await Promise.all([
		c.env.FILES.put(key, stream.readable, { httpMetadata: { contentType: type }, customMetadata: { name, uploadedBy: c.get('actor').id } }),
		c.req.raw.body!.pipeTo(stream.writable),
	]);
	return { key, name, size: object?.size ?? size, type };
}

app.post('/w/:wid/files', async (c) => {
	const stored = await storeUpload(c);
	return stored instanceof Response ? stored : c.json(stored, 201);
});

app.get('/w/:wid/files/:fid', async (c) => {
	const key = `w/${c.get('workspaceId')}/${c.req.param('fid')}`;
	const ranged = c.req.header('Range') !== undefined;
	const object = await c.env.FILES.get(key, ranged ? { range: c.req.raw.headers } : {});
	if (!object || !(await stub(c).canReadFile(c.get('actor'), key, object.customMetadata?.uploadedBy))) {
		return fail(c, 404, 'Fichier introuvable');
	}
	const type = object.httpMetadata?.contentType ?? 'application/octet-stream';
	const inline = INLINE_TYPES.has(type);
	const headers = new Headers({
		'Content-Type': inline ? type : 'application/octet-stream',
		'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(object.customMetadata?.name ?? 'fichier')}`,
		'Content-Security-Policy': "default-src 'none'; sandbox",
		'X-Content-Type-Options': 'nosniff',
		'Cache-Control': 'private, max-age=3600',
		'Accept-Ranges': 'bytes',
		ETag: object.httpEtag,
	});
	const range = object.range as { offset?: number; length?: number } | undefined;
	if (ranged && range && range.offset !== undefined && range.length !== undefined) {
		headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
		headers.set('Content-Length', String(range.length));
		return new Response(object.body, { status: 206, headers });
	}
	headers.set('Content-Length', String(object.size));
	return new Response(object.body, { headers });
});

app.get('/w/:wid/channels/:cid/drive', async (c) => unwrap(c, await stub(c).driveList(c.get('actor'), c.req.param('cid'), c.req.query('folder') || null)));

app.post('/w/:wid/channels/:cid/drive/folders', async (c) => {
	const { name, parentId } = await readJson<{ name: string; parentId: string }>(c);
	return unwrap(c, await stub(c).driveCreateFolder(c.get('actor'), c.req.param('cid'), typeof parentId === 'string' ? parentId : null, String(name ?? '')));
});

app.patch('/w/:wid/drive/folders/:id', async (c) => {
	const { name } = await readJson<{ name: string }>(c);
	return unwrap(c, await stub(c).driveRenameFolder(c.get('actor'), c.req.param('id'), String(name ?? '')));
});

app.delete('/w/:wid/drive/folders/:id', async (c) => unwrap(c, await stub(c).driveDeleteFolder(c.get('actor'), c.req.param('id'))));

app.post('/w/:wid/channels/:cid/drive/files', async (c) => {
	const stored = await storeUpload(c);
	if (stored instanceof Response) {
		return stored;
	}
	const result = await stub(c).driveAddFile(c.get('actor'), c.req.param('cid'), c.req.query('folder') || null, stored);
	if (!result.ok) {
		await c.env.FILES.delete(stored.key);
	}
	return result.ok ? c.json(result.value, 201) : fail(c, result.status, result.error);
});

app.patch('/w/:wid/drive/files/:id', async (c) => {
	const body = await readJson<{ name: string; folderId: string | null }>(c);
	return unwrap(
		c,
		await stub(c).driveUpdateFile(c.get('actor'), c.req.param('id'), {
			name: typeof body.name === 'string' ? body.name : undefined,
			folderId: body.folderId === null || typeof body.folderId === 'string' ? body.folderId : undefined,
		}),
	);
});

app.delete('/w/:wid/drive/files/:id', async (c) => unwrap(c, await stub(c).driveDeleteFile(c.get('actor'), c.req.param('id'))));

app.route('/', notificationRoutes);
app.route('/', mediaRoutes);
app.route('/', categoryRoutes);
app.route('/', commandRoutes);
app.route('/', rcRoutes);
app.route('/', chatRoutes);
app.route('/', dmThreadsRoutes);
app.route('/', voiceRoutes);

app.get('/w/:wid/ws', async (c) => {
	if (c.req.header('Upgrade') !== 'websocket') {
		return c.text('WebSocket attendu', 426);
	}
	const headers = new Headers(c.req.raw.headers);
	headers.set('x-synq-actor', JSON.stringify(c.get('actor')));
	return stub(c).fetch(new Request(c.req.raw, { headers }));
});

app.all('*', (c) => fail(c, 404, 'Route inconnue'));

export default app;
