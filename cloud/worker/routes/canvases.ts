import { Hono, type MiddlewareHandler } from 'hono';

import { CANVAS_IMAGE_TYPES, CANVAS_LIMITS, PAGE_COVER_RE, pageTemplate, type CanvasAccess, type PagePatch, type PageRelated } from '../../shared/canvas';
import { atLeast } from '../../shared/access';
import { P, has } from '../../shared/permissions';
import { LIMITS } from '../../shared/types';
import { canvasAccessOf, categoryLevel, loadAccess, pageAccess, pageLevel, pageReaders, reviseCardDocs, reviseSockets, subtreeIds } from '../access';
import type { CanvasPeer } from '../canvas-doc';
import {
	ancestorRows,
	archivePage,
	backlinkIds,
	canvasRow,
	cleanTitle,
	commentRow,
	deleteCanvasRow,
	deleteComment,
	descendantIds,
	insertCanvas,
	insertComment,
	listCanvasRows,
	listComments,
	resolveThread,
	restorePage,
	threadExists,
	toMeta,
	toRef,
	updatePageRow,
	workspaceMemberIds,
	type CanvasRow,
} from '../canvases';
import { fail, readJson, stub, type AppEnv, type Ctx } from '../http';
import { channelRights, linkResource } from './channel-resources';

export const canvasRoutes = new Hono<AppEnv>();

// Mutation réussie d'une page, d'une catégorie ou d'un accès : l'arbre des autres se relit.
export const pagesNotice: MiddlewareHandler<AppEnv> = async (c, next) => {
	await next();
	if (c.res.ok) {
		c.executionCtx.waitUntil(
			stub(c as Ctx)
				.pagesChanged()
				.catch(() => undefined),
		);
	}
};

const FILE_ID = /^[\w-]{1,64}$/;

// Introuvable plutôt qu'interdit : l'existence d'un canevas de salon privé ne fuit pas.
async function load(c: Ctx, id: string) {
	const row = await canvasRow(c.env.DB, c.get('workspaceId'), id);
	if (!row) {
		return null;
	}
	const ancestors = row.parent_id ? await ancestorRows(c.env.DB, row.workspace_id, row.id) : [];
	const scope = (ancestors.at(-1) ?? row).channel_id;
	const byId = new Map([row, ...ancestors].map((r) => [r.id, r]));
	const data = await loadAccess(c.env, row.workspace_id);
	const level = pageLevel(c.get('actor'), row, byId, data);
	return level ? { row, access: canvasAccessOf(level), level, ancestors, scope, byId, data } : null;
}

async function visible(c: Ctx) {
	const { rows, byId, levels } = await pageAccess(c.env, c.get('workspaceId'), c.get('actor'));
	return { rows, byId, access: levels };
}

const imageKey = (row: CanvasRow, fid: string) => `w/${row.workspace_id}/canvas/${row.id}/${fid}`;

async function purge(c: Ctx, row: CanvasRow) {
	const ids = [...(await descendantIds(c.env.DB, row.id)).reverse(), row.id];
	for (const id of ids) {
		await deleteCanvasRow(c.env.DB, id);
		// Suivis rangés sous la page : remontés à la racine plutôt que supprimés.
		await c.env.DB.prepare('UPDATE lists SET parent_id = NULL WHERE parent_id = ?').bind(id).run();
		await c.env.DB.prepare("DELETE FROM access_rules WHERE resource_kind = 'page' AND resource_id = ?").bind(id).run();
		await c.env.CANVAS_DOC.getByName(id).wipe();
		const listed = await c.env.FILES.list({ prefix: `w/${row.workspace_id}/canvas/${id}/` });
		if (listed.objects.length) {
			await c.env.FILES.delete(listed.objects.map((o) => o.key));
		}
	}
}

canvasRoutes.get('/w/:wid/canvases', async (c) => {
	const archived = c.req.query('archived') === '1';
	const { rows, access } = await visible(c);
	return c.json(rows.flatMap((row) => (access.has(row.id) && (row.archived_at !== null) === archived ? [toMeta(row, access.get(row.id)!)] : [])));
});

type PageInput = { title?: string; parentId?: string | null; categoryId?: string | null; template?: string; icon?: string };

async function createPage(c: Ctx, body: PageInput): Promise<CanvasRow | Response> {
	const actor = c.get('actor');
	if (actor.guest) {
		return fail(c, 403, 'Accès invité limité');
	}
	const template = body.template ? pageTemplate(body.template) : null;
	if (body.template && !template) {
		return fail(c, 400, 'Modèle inconnu');
	}
	let parentId: string | null = null;
	if (body.parentId) {
		const parent = await load(c, body.parentId);
		if (!parent || parent.row.archived_at !== null) {
			return fail(c, 404, 'Page parente introuvable');
		}
		if (parent.access !== 'write') {
			return fail(c, 403, 'Page parente en lecture seule');
		}
		parentId = parent.row.id;
	}
	const title = cleanTitle(body.title) || template?.title || 'Sans titre';
	const icon = typeof body.icon === 'string' && body.icon.length <= CANVAS_LIMITS.icon ? body.icon : (template?.icon ?? null);
	let categoryId: string | null = null;
	if (body.categoryId && !parentId) {
		const data = await loadAccess(c.env, c.get('workspaceId'));
		const category = data.categories.get(body.categoryId);
		const level = category ? categoryLevel(actor, category, data) : null;
		if (!category || !level) {
			return fail(c, 404, 'Catégorie introuvable');
		}
		if (!atLeast(level, 'edit')) {
			return fail(c, 403, 'Catégorie en lecture seule');
		}
		categoryId = category.id;
	}
	const row = await insertCanvas(c.env.DB, { workspaceId: c.get('workspaceId'), channelId: null, title, createdBy: actor.id, parentId, icon });
	if (categoryId) {
		await updatePageRow(c.env.DB, row.id, { category_id: categoryId });
		row.category_id = categoryId;
	}
	if (template) {
		await c.env.CANVAS_DOC.getByName(row.id).seed(row.id, title, template.blocks);
	}
	return row;
}

canvasRoutes.post('/w/:wid/canvases', pagesNotice, async (c) => {
	const made = await createPage(c, await readJson<PageInput>(c));
	return made instanceof Response ? made : c.json(toMeta(made, 'manage'), 201);
});

// Nouvelle page liée au salon : page d'espace ordinaire, le lien ne donne aucun droit.
canvasRoutes.post('/w/:wid/channels/:cid/canvas', pagesNotice, async (c) => {
	const channelId = c.req.param('cid');
	const rights = await channelRights(c, channelId);
	if (rights instanceof Response) {
		return rights;
	}
	const made = await createPage(c, await readJson<PageInput>(c));
	if (made instanceof Response) {
		return made;
	}
	await linkResource(c, channelId, 'page', made.id);
	return c.json(toMeta(made, 'manage'), 201);
});

canvasRoutes.get('/w/:wid/canvases/:id', async (c) => {
	const found = await load(c, c.req.param('id'));
	return found ? c.json(toMeta(found.row, found.level)) : fail(c, 404, 'Canevas introuvable');
});

canvasRoutes.patch('/w/:wid/canvases/:id', pagesNotice, async (c) => {
	const found = await load(c, c.req.param('id'));
	if (!found) {
		return fail(c, 404, 'Page introuvable');
	}
	if (found.access !== 'write') {
		return fail(c, 403, 'Page en lecture seule');
	}
	const body = await readJson<PagePatch>(c);
	const { row } = found;
	const fields: Parameters<typeof updatePageRow>[2] = {};
	if (body.title !== undefined) {
		fields.title = cleanTitle(body.title) || 'Sans titre';
		await c.env.CANVAS_DOC.getByName(row.id).setTitle(row.id, fields.title);
	}
	if (body.icon !== undefined) {
		if (body.icon !== null && (typeof body.icon !== 'string' || !body.icon || body.icon.length > CANVAS_LIMITS.icon)) {
			return fail(c, 400, 'Icône invalide');
		}
		fields.icon = body.icon;
	}
	if (body.cover !== undefined) {
		if (body.cover !== null && (typeof body.cover !== 'string' || !(PAGE_COVER_RE.test(body.cover) || FILE_ID.test(body.cover)))) {
			return fail(c, 400, 'Couverture invalide');
		}
		fields.cover_key = body.cover;
	}
	if (body.parentId !== undefined && body.parentId !== row.parent_id) {
		if (body.parentId !== null) {
			const target = await load(c, body.parentId);
			if (!target || target.row.archived_at !== null) {
				return fail(c, 404, 'Page de destination introuvable');
			}
			if (target.access !== 'write') {
				return fail(c, 403, 'Page de destination en lecture seule');
			}
			if (target.row.id === row.id || target.ancestors.some((a) => a.id === row.id)) {
				return fail(c, 409, 'Une page ne peut pas entrer dans ses propres sous-pages');
			}
		}
		fields.parent_id = body.parentId;
	}
	if (body.categoryId !== undefined && body.categoryId !== row.category_id) {
		if (body.categoryId !== null) {
			const category = typeof body.categoryId === 'string' ? found.data.categories.get(body.categoryId) : undefined;
			const level = category ? categoryLevel(c.get('actor'), category, found.data) : null;
			if (!category || !level) {
				return fail(c, 404, 'Catégorie introuvable');
			}
			if (!atLeast(level, 'edit')) {
				return fail(c, 403, 'Catégorie en lecture seule');
			}
		}
		fields.category_id = body.categoryId;
	}
	if (body.position !== undefined) {
		if (typeof body.position !== 'number' || !Number.isFinite(body.position)) {
			return fail(c, 400, 'Position invalide');
		}
		fields.position = body.position;
	}
	await updatePageRow(c.env.DB, row.id, fields);
	if (body.archived === true && row.archived_at === null) {
		await archivePage(c.env.DB, row.id, Date.now());
	} else if (body.archived === false && row.archived_at !== null) {
		await restorePage(c.env.DB, row);
	}
	// Déplacée : ses droits et ceux de ses sous-pages peuvent changer.
	if (fields.parent_id !== undefined || fields.category_id !== undefined) {
		const rows = await listCanvasRows(c.env.DB, row.workspace_id);
		await reviseSockets(c.env, row.workspace_id, subtreeIds(new Set([row.id]), new Map(rows.map((r) => [r.id, r]))));
		await reviseCardDocs(c.env, row.workspace_id);
	}
	const fresh = await load(c, row.id);
	return fresh ? c.json(toMeta(fresh.row, fresh.level)) : c.json({ ok: true });
});

canvasRoutes.post('/w/:wid/canvases/:id/duplicate', pagesNotice, async (c) => {
	const actor = c.get('actor');
	const found = await load(c, c.req.param('id'));
	if (!found || actor.guest) {
		return fail(c, 404, 'Page introuvable');
	}
	if (found.access !== 'write' || found.row.channel_id) {
		return fail(c, 403, 'Cette page ne peut pas être dupliquée');
	}
	const title = cleanTitle(`${found.row.title} (copie)`);
	const cover = found.row.cover_key?.startsWith('gradient:') ? found.row.cover_key : null;
	const row = await insertCanvas(c.env.DB, { workspaceId: found.row.workspace_id, channelId: null, title, createdBy: actor.id, parentId: found.row.parent_id, icon: found.row.icon, coverKey: cover });
	const state = await c.env.CANVAS_DOC.getByName(found.row.id).exportState();
	await c.env.CANVAS_DOC.getByName(row.id).importState(row.id, state, title);
	return c.json(toMeta(row, 'manage'), 201);
});

canvasRoutes.get('/w/:wid/canvases/:id/related', async (c) => {
	const found = await load(c, c.req.param('id'));
	if (!found) {
		return fail(c, 404, 'Page introuvable');
	}
	const { rows, byId, access } = await visible(c);
	const live = (row: CanvasRow | undefined): row is CanvasRow => !!row && row.archived_at === null && access.has(row.id);
	const sources = await backlinkIds(c.env.DB, found.row.id);
	const related: PageRelated = {
		ancestors: [...found.ancestors].reverse().map(toRef),
		children: rows
			.filter((row) => row.parent_id === found.row.id && live(row))
			.sort((a, b) => a.position - b.position)
			.map(toRef),
		backlinks: sources
			.map((id) => byId.get(id))
			.filter(live)
			.map(toRef),
	};
	return c.json(related);
});

canvasRoutes.delete('/w/:wid/canvases/:id', pagesNotice, async (c) => {
	const actor = c.get('actor');
	const found = await load(c, c.req.param('id'));
	if (!found) {
		return fail(c, 404, 'Canevas introuvable');
	}
	if (found.level !== 'manage' && found.row.created_by !== actor.id) {
		return fail(c, 403, 'Accès complet requis pour supprimer cette page');
	}
	await purge(c, found.row);
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
	// Page archivée : consultable, plus modifiable.
	const peer: CanvasPeer = { canvasId: found.row.id, userId: c.get('actor').id, write: found.access === 'write' && found.row.archived_at === null };
	const headers = new Headers(c.req.raw.headers);
	headers.set('x-canvas-peer', JSON.stringify(peer));
	return c.env.CANVAS_DOC.getByName(found.row.id).fetch(new Request(c.req.raw, { headers }));
});

// Même plafond que les fichiers du chat ; `?kind=file` accepte tout type pour les pièces jointes.
canvasRoutes.post('/w/:wid/canvases/:id/files', async (c) => {
	const found = await load(c, c.req.param('id'));
	if (!found) {
		return fail(c, 404, 'Canevas introuvable');
	}
	if (found.access !== 'write') {
		return fail(c, 403, 'Canevas en lecture seule');
	}
	const attachment = c.req.query('kind') === 'file';
	const type = c.req.header('Content-Type')?.split(';')[0]?.trim() || 'application/octet-stream';
	if (!attachment && !CANVAS_IMAGE_TYPES.includes(type)) {
		return fail(c, 400, 'Image attendue (PNG, JPEG, GIF, WebP ou AVIF)');
	}
	const size = Number(c.req.header('Content-Length'));
	if (!Number.isInteger(size) || size <= 0) {
		return fail(c, 400, 'Fichier vide ou taille inconnue');
	}
	if (size > LIMITS.fileSize) {
		return fail(c, 413, 'Fichier trop lourd (50 Mo max)');
	}
	const name = (c.req.query('name') ?? '').replace(/[\r\n"\\]/g, '').slice(0, 200) || 'fichier';
	const fid = crypto.randomUUID();
	const stream = new FixedLengthStream(size);
	await Promise.all([
		c.env.FILES.put(imageKey(found.row, fid), stream.readable, { httpMetadata: { contentType: type }, customMetadata: { uploadedBy: c.get('actor').id, name } }),
		c.req.raw.body!.pipeTo(stream.writable),
	]);
	return c.json({ id: fid, url: `/api/w/${found.row.workspace_id}/canvases/${found.row.id}/files/${fid}`, name, size, type }, 201);
});

canvasRoutes.get('/w/:wid/canvases/:id/files/:fid', async (c) => {
	const fid = c.req.param('fid');
	const found = FILE_ID.test(fid) ? await load(c, c.req.param('id')) : null;
	const object = found ? await c.env.FILES.get(imageKey(found.row, fid)) : null;
	if (!object) {
		return fail(c, 404, 'Image introuvable');
	}
	const type = object.httpMetadata?.contentType ?? 'application/octet-stream';
	const headers: Record<string, string> = {
		'Content-Type': type,
		'Cache-Control': 'private, max-age=86400',
		'X-Content-Type-Options': 'nosniff',
		'Content-Security-Policy': "default-src 'none'",
	};
	// Tout ce qui n'est pas une image se télécharge, jamais rendu dans l'origine.
	if (!CANVAS_IMAGE_TYPES.includes(type)) {
		headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(object.customMetadata?.name ?? 'fichier')}`;
	}
	return new Response(object.body, { headers });
});

canvasRoutes.get('/w/:wid/canvases/:id/comments', async (c) => {
	const found = await load(c, c.req.param('id'));
	return found ? c.json(await listComments(c.env.DB, found.row.id)) : fail(c, 404, 'Page introuvable');
});

canvasRoutes.post('/w/:wid/canvases/:id/comments', async (c) => {
	const actor = c.get('actor');
	const found = await load(c, c.req.param('id'));
	if (!found) {
		return fail(c, 404, 'Page introuvable');
	}
	const body = await readJson<{ threadId?: string; quote?: string; body?: string; mentions?: string[] }>(c);
	const text = typeof body.body === 'string' ? body.body.trim().slice(0, CANVAS_LIMITS.comment) : '';
	if (!text) {
		return fail(c, 400, 'Commentaire vide');
	}
	const threadId = typeof body.threadId === 'string' && FILE_ID.test(body.threadId) ? body.threadId : null;
	if (!threadId) {
		return fail(c, 400, 'Fil invalide');
	}
	const existing = await threadExists(c.env.DB, found.row.id, threadId);
	// Ouvrir un fil pose une marque dans le document : réservé à qui peut écrire.
	if (!existing && found.access !== 'write') {
		return fail(c, 403, 'Page en lecture seule');
	}
	if (!atLeast(found.level, 'comment')) {
		return fail(c, 403, 'Tu ne peux pas commenter cette page');
	}
	const quote = existing ? '' : typeof body.quote === 'string' ? body.quote.slice(0, CANVAS_LIMITS.quote) : '';
	const comment = await insertComment(c.env.DB, { canvasId: found.row.id, threadId, quote, authorId: actor.id, body: text });
	const asked = Array.isArray(body.mentions) ? body.mentions.filter((id): id is string => typeof id === 'string' && id !== actor.id).slice(0, 20) : [];
	const members = await workspaceMemberIds(c.env.DB, found.row.workspace_id, asked);
	const mentioned = members.length ? await pageReaders(c.env, found.row.workspace_id, found.row, found.byId, members) : [];
	if (mentioned.length) {
		await stub(c).pageMentioned(actor, mentioned, { workspaceId: found.row.workspace_id, scope: found.scope, pageId: found.row.id, threadId, title: found.row.title, body: text });
	}
	return c.json(comment, 201);
});

canvasRoutes.patch('/w/:wid/canvases/:id/comments/:cid', async (c) => {
	const found = await load(c, c.req.param('id'));
	const comment = found ? await commentRow(c.env.DB, found.row.id, c.req.param('cid')) : null;
	if (!found || !comment) {
		return fail(c, 404, 'Commentaire introuvable');
	}
	if (found.access !== 'write' && comment.author_id !== c.get('actor').id) {
		return fail(c, 403, 'Page en lecture seule');
	}
	const { resolved } = await readJson<{ resolved?: boolean }>(c);
	await resolveThread(c.env.DB, found.row.id, comment.thread_id, resolved === true);
	return c.json(await listComments(c.env.DB, found.row.id));
});

canvasRoutes.delete('/w/:wid/canvases/:id/comments/:cid', async (c) => {
	const actor = c.get('actor');
	const found = await load(c, c.req.param('id'));
	const comment = found ? await commentRow(c.env.DB, found.row.id, c.req.param('cid')) : null;
	if (!found || !comment) {
		return fail(c, 404, 'Commentaire introuvable');
	}
	if (comment.author_id !== actor.id && !actor.owner && !has(actor.perms, P.MANAGE_CHANNELS)) {
		return fail(c, 403, 'Seul son auteur peut supprimer ce commentaire');
	}
	await deleteComment(c.env.DB, comment.id);
	return c.json({ ok: true });
});
