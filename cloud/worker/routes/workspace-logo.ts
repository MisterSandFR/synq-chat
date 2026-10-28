import { Hono } from 'hono';

import { P } from '../../shared/permissions';
import { AVATAR_TYPES, RC_LIMITS } from '../../shared/rc';
import { denyUnless, fail, stub, type AppEnv, type Ctx } from '../http';

export const workspaceLogoRoutes = new Hono<AppEnv>();

const LOGO_PATH = '/api/workspace-logos/';

export const logoUrl = (workspaceId: string, key: string | null | undefined) => (key ? `${LOGO_PATH}${workspaceId}/${key}` : null);

export async function dropLogo(c: Ctx, workspaceId: string, key: string | null | undefined): Promise<void> {
	if (key) {
		await c.env.FILES.delete(`workspace-logos/${workspaceId}/${key}`);
	}
}

async function currentKey(c: Ctx): Promise<string | null> {
	const row = await c.env.DB.prepare('SELECT logo_key FROM workspaces WHERE id = ?').bind(c.get('workspaceId')).first<{ logo_key: string | null }>();
	return row?.logo_key ?? null;
}

// Même flux que l'avatar : corps brut vers R2, images non exécutables seulement.
workspaceLogoRoutes.post('/w/:wid/logo', async (c) => {
	const denied = denyUnless(c, P.MANAGE_WORKSPACE);
	if (denied) {
		return denied;
	}
	const type = c.req.header('Content-Type')?.split(';')[0]?.trim() ?? '';
	const size = Number(c.req.header('Content-Length'));
	if (!AVATAR_TYPES.includes(type)) {
		return fail(c, 400, 'Image PNG, JPEG, GIF ou WebP attendue');
	}
	if (!Number.isInteger(size) || size <= 0 || !c.req.raw.body) {
		return fail(c, 400, 'Fichier vide ou taille inconnue');
	}
	if (size > RC_LIMITS.avatarSize) {
		return fail(c, 413, 'Image trop lourde (2 Mo max)');
	}
	const workspaceId = c.get('workspaceId');
	const id = crypto.randomUUID();
	const stream = new FixedLengthStream(size);
	await Promise.all([c.env.FILES.put(`workspace-logos/${workspaceId}/${id}`, stream.readable, { httpMetadata: { contentType: type } }), c.req.raw.body.pipeTo(stream.writable)]);
	const previous = await currentKey(c);
	await c.env.DB.prepare('UPDATE workspaces SET logo_key = ? WHERE id = ?').bind(id, workspaceId).run();
	await dropLogo(c, workspaceId, previous);
	await stub(c).membersChanged();
	return c.json({ logoUrl: logoUrl(workspaceId, id) }, 201);
});

workspaceLogoRoutes.delete('/w/:wid/logo', async (c) => {
	const denied = denyUnless(c, P.MANAGE_WORKSPACE);
	if (denied) {
		return denied;
	}
	const workspaceId = c.get('workspaceId');
	const previous = await currentKey(c);
	if (previous) {
		await c.env.DB.prepare('UPDATE workspaces SET logo_key = NULL WHERE id = ?').bind(workspaceId).run();
		await dropLogo(c, workspaceId, previous);
		await stub(c).membersChanged();
	}
	return c.json({ logoUrl: null });
});

// Session seule, comme les avatars : la page d'invitation l'affiche avant l'adhésion.
workspaceLogoRoutes.get('/workspace-logos/:wid/:id', async (c) => {
	const object = await c.env.FILES.get(`workspace-logos/${c.req.param('wid')}/${c.req.param('id')}`);
	if (!object) {
		return fail(c, 404, 'Logo introuvable');
	}
	return new Response(object.body, {
		headers: {
			'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
			'Content-Length': String(object.size),
			'Content-Security-Policy': "default-src 'none'; sandbox",
			'X-Content-Type-Options': 'nosniff',
			// Clé neuve à chaque envoi : contenu immuable.
			'Cache-Control': 'private, max-age=31536000, immutable',
		},
	});
});
