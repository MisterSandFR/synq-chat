import { Hono } from 'hono';

import { CANVAS_IMAGE_TYPES } from '../../shared/canvas';
import { P, has } from '../../shared/permissions';
import { LIMITS } from '../../shared/types';
import type { CanvasPeer } from '../canvas-doc';
import { canvasRow, channelCanvasRow, cleanTitle, deleteCanvasRow, insertCanvas, listCanvasRows, toMeta, type CanvasRow } from '../canvases';
import { fail, readJson, stub, type AppEnv, type Ctx } from '../http';

export const canvasRoutes = new Hono<AppEnv>();

const FILE_ID = /^[\w-]{1,64}$/;

// Introuvable plutôt qu'interdit : l'existence d'un canevas de salon privé ne fuit pas.
async function load(c: Ctx, id: string) {
	const row = await canvasRow(c.env.DB, c.get('workspaceId'), id);
	if (!row) {
		return null;
	}
	const [access] = await stub(c).canvasAccess(c.get('actor'), [row.channel_id]);
	return access ? { row, access } : null;
}

const imageKey = (row: CanvasRow, fid: string) => `w/${row.workspace_id}/canvas/${row.id}/${fid}`;

canvasRoutes.get('/w/:wid/canvases', async (c) => {
	const rows = await listCanvasRows(c.env.DB, c.get('workspaceId'));
	const rights = rows.length ? await stub(c).canvasAccess(c.get('actor'), rows.map((row) => row.channel_id)) : [];
	return c.json(rows.flatMap((row, i) => (rights[i] ? [toMeta(row, rights[i])] : [])));
});

canvasRoutes.post('/w/:wid/canvases', async (c) => {
	const actor = c.get('actor');
	if (actor.guest) {
		return fail(c, 403, 'Accès invité limité');
	}
	const { title } = await readJson<{ title: string }>(c);
	const row = await insertCanvas(c.env.DB, { workspaceId: c.get('workspaceId'), channelId: null, title: cleanTitle(title) || 'Sans titre', createdBy: actor.id });
	return c.json(toMeta(row, 'write'), 201);
});

// Canevas de l'onglet du salon : renvoyé s'il existe, créé sinon par qui peut écrire.
canvasRoutes.post('/w/:wid/channels/:cid/canvas', async (c) => {
	const actor = c.get('actor');
	const channelId = c.req.param('cid');
	const [access] = await stub(c).canvasAccess(actor, [channelId]);
	if (!access) {
		return fail(c, 404, 'Salon introuvable');
	}
	const existing = await channelCanvasRow(c.env.DB, c.get('workspaceId'), channelId);
	if (existing) {
		return c.json(toMeta(existing, access));
	}
	if (access !== 'write') {
		return fail(c, 403, 'Ce salon n’a pas encore de canevas');
	}
	const { title } = await readJson<{ title: string }>(c);
	try {
		const row = await insertCanvas(c.env.DB, { workspaceId: c.get('workspaceId'), channelId, title: cleanTitle(title) || 'Canevas du salon', createdBy: actor.id });
		return c.json(toMeta(row, 'write'), 201);
	} catch {
		// Création simultanée : l'index unique a gardé l'autre.
		const raced = await channelCanvasRow(c.env.DB, c.get('workspaceId'), channelId);
		return raced ? c.json(toMeta(raced, access)) : fail(c, 409, 'Création impossible, réessaie');
	}
});

canvasRoutes.get('/w/:wid/canvases/:id', async (c) => {
	const found = await load(c, c.req.param('id'));
	return found ? c.json(toMeta(found.row, found.access)) : fail(c, 404, 'Canevas introuvable');
});

canvasRoutes.delete('/w/:wid/canvases/:id', async (c) => {
	const actor = c.get('actor');
	const found = await load(c, c.req.param('id'));
	if (!found) {
		return fail(c, 404, 'Canevas introuvable');
	}
	if (found.row.created_by !== actor.id && !actor.owner && !has(actor.perms, P.MANAGE_CHANNELS)) {
		return fail(c, 403, 'Seul son auteur ou un gestionnaire des salons peut le supprimer');
	}
	await deleteCanvasRow(c.env.DB, found.row.id);
	await c.env.CANVAS_DOC.getByName(found.row.id).wipe();
	const listed = await c.env.FILES.list({ prefix: imageKey(found.row, '') });
	if (listed.objects.length) {
		await c.env.FILES.delete(listed.objects.map((o) => o.key));
	}
	return c.json({ ok: true });
});

canvasRoutes.get('/w/:wid/canvases/:id/ws', async (c) => {
	if (c.req.header('Upgrade') !== 'websocket') {
		return c.text('WebSocket attendu', 426);
	}
	const found = await load(c, c.req.param('id'));
	if (!found) {
		return fail(c, 404, 'Canevas introuvable');
	}
	const peer: CanvasPeer = { canvasId: found.row.id, userId: c.get('actor').id, write: found.access === 'write' };
	const headers = new Headers(c.req.raw.headers);
	headers.set('x-canvas-peer', JSON.stringify(peer));
	return c.env.CANVAS_DOC.getByName(found.row.id).fetch(new Request(c.req.raw, { headers }));
});

// Même plafond que les fichiers du chat ; images seulement, servies sous le contrôle du canevas.
canvasRoutes.post('/w/:wid/canvases/:id/files', async (c) => {
	const found = await load(c, c.req.param('id'));
	if (!found) {
		return fail(c, 404, 'Canevas introuvable');
	}
	if (found.access !== 'write') {
		return fail(c, 403, 'Canevas en lecture seule');
	}
	const type = c.req.header('Content-Type')?.split(';')[0]?.trim() ?? '';
	if (!CANVAS_IMAGE_TYPES.includes(type)) {
		return fail(c, 400, 'Image attendue (PNG, JPEG, GIF, WebP ou AVIF)');
	}
	const size = Number(c.req.header('Content-Length'));
	if (!Number.isInteger(size) || size <= 0) {
		return fail(c, 400, 'Fichier vide ou taille inconnue');
	}
	if (size > LIMITS.fileSize) {
		return fail(c, 413, 'Fichier trop lourd (50 Mo max)');
	}
	const fid = crypto.randomUUID();
	const stream = new FixedLengthStream(size);
	await Promise.all([
		c.env.FILES.put(imageKey(found.row, fid), stream.readable, { httpMetadata: { contentType: type }, customMetadata: { uploadedBy: c.get('actor').id } }),
		c.req.raw.body!.pipeTo(stream.writable),
	]);
	return c.json({ url: `/api/w/${found.row.workspace_id}/canvases/${found.row.id}/files/${fid}` }, 201);
});

canvasRoutes.get('/w/:wid/canvases/:id/files/:fid', async (c) => {
	const fid = c.req.param('fid');
	const found = FILE_ID.test(fid) ? await load(c, c.req.param('id')) : null;
	const object = found ? await c.env.FILES.get(imageKey(found.row, fid)) : null;
	if (!object) {
		return fail(c, 404, 'Image introuvable');
	}
	return new Response(object.body, {
		headers: {
			'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
			'Cache-Control': 'private, max-age=86400',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'",
		},
	});
});
