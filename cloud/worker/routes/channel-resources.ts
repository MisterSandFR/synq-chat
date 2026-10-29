import { Hono } from 'hono';

import type { AccessLevel } from '../../shared/access';
import { CHANNEL_RESOURCE_LIMIT, RESOURCE_KINDS, type ChannelResource, type ChannelResources, type ResourceKind } from '../../shared/channel-resources';
import type { Actor } from '../../shared/types';
import { baseLevel, loadAccess, pageLevel, type PageNode } from '../access';
import { listCanvasRows } from '../canvases';
import { loadActors } from '../grades';
import { fail, readJson, stub, type AppEnv, type Ctx } from '../http';
import { workspaceLists } from '../lists';

export const channelResourceRoutes = new Hono<AppEnv>();

type LinkRow = { kind: ResourceKind; ref_id: string; position: number; added_by: string };

// Salon visible requis ; lier demande d'y écrire ou de le gérer.
export async function channelRights(c: Ctx, channelId: string, actors: Actor[] = []) {
	const rights = await stub(c).channelMembers(c.get('actor'), actors, channelId);
	if (!rights) {
		return fail(c, 404, 'Salon introuvable');
	}
	return rights.send || rights.manage ? rights : fail(c, 403, 'Permission insuffisante');
}

export async function linkResource(c: Ctx, channelId: string, kind: ResourceKind, refId: string): Promise<void> {
	await c.env.DB.prepare(
		`INSERT OR IGNORE INTO channel_resources (workspace_id, channel_id, kind, ref_id, position, added_by)
		SELECT ?1, ?2, ?3, ?4, COALESCE(MAX(position), -1) + 1, ?5 FROM channel_resources WHERE channel_id = ?2`,
	)
		.bind(c.get('workspaceId'), channelId, kind, refId, c.get('actor').id)
		.run();
	await stub(c)
		.resourcesChanged(channelId)
		.catch(() => undefined);
}

export async function linkedIds(c: Ctx, channelId: string, kind: ResourceKind): Promise<Set<string>> {
	const { results } = await c.env.DB.prepare('SELECT ref_id FROM channel_resources WHERE workspace_id = ? AND channel_id = ? AND kind = ?')
		.bind(c.get('workspaceId'), channelId, kind)
		.all<{ ref_id: string }>();
	return new Set(results.map((row) => row.ref_id));
}

// Ressources liées que l'acteur voit, avec les membres du salon qui n'y ont pas accès.
async function describe(c: Ctx, channelId: string, rights: { viewers: string[]; manage: boolean }, actors: Actor[]): Promise<ChannelResource[]> {
	const wid = c.get('workspaceId');
	const actor = c.get('actor');
	const { results: links } = await c.env.DB.prepare('SELECT kind, ref_id, position, added_by FROM channel_resources WHERE workspace_id = ? AND channel_id = ? ORDER BY position')
		.bind(wid, channelId)
		.all<LinkRow>();
	if (!links.length) {
		return [];
	}
	const [pages, lists, data] = await Promise.all([listCanvasRows(c.env.DB, wid), workspaceLists(c.env.DB, wid), loadAccess(c.env, wid)]);
	const byId = new Map(pages.map((row) => [row.id, row]));
	const listById = new Map(lists.map((row) => [row.id, row]));
	const viewers = new Set(rights.viewers);
	const audience = actors.filter((a) => viewers.has(a.id));
	return links.flatMap((link) => {
		const page = link.kind === 'page' ? byId.get(link.ref_id) : undefined;
		const list = link.kind === 'list' ? listById.get(link.ref_id) : undefined;
		const levelOf = (who: Actor): AccessLevel | null => (page && !page.archived_at ? pageLevel(who, page, byId, data) : list ? baseLevel(who, list, data, byId) : null);
		const level = levelOf(actor);
		if (!level) {
			return [];
		}
		const missing = audience.filter((who) => !levelOf(who)).map((who) => who.id);
		return [
			{
				kind: link.kind,
				id: link.ref_id,
				title: (page?.title ?? list?.title) || 'Sans titre',
				icon: page?.icon ?? list?.icon ?? null,
				level,
				addedBy: link.added_by,
				canRemove: rights.manage || link.added_by === actor.id,
				missing: missing.length,
				...(level === 'manage' ? { missingIds: missing } : {}),
			},
		];
	});
}

async function members(c: Ctx, channelId: string) {
	const actors = await loadActors(c.env.DB, c.get('workspaceId'));
	const rights = await stub(c).channelMembers(c.get('actor'), actors, channelId);
	return rights ? { rights, actors } : null;
}

channelResourceRoutes.get('/w/:wid/channels/:cid/resources', async (c) => {
	const found = await members(c, c.req.param('cid'));
	if (!found) {
		return fail(c, 404, 'Salon introuvable');
	}
	const items = await describe(c, c.req.param('cid'), found.rights, found.actors);
	return c.json<ChannelResources>({ items, canLink: found.rights.send || found.rights.manage });
});

channelResourceRoutes.post('/w/:wid/channels/:cid/resources', async (c) => {
	const channelId = c.req.param('cid');
	const found = await members(c, channelId);
	if (!found) {
		return fail(c, 404, 'Salon introuvable');
	}
	if (!found.rights.send && !found.rights.manage) {
		return fail(c, 403, 'Permission insuffisante');
	}
	const { kind, id } = await readJson<{ kind: ResourceKind; id: string }>(c);
	if (!kind || !RESOURCE_KINDS.includes(kind) || typeof id !== 'string') {
		return fail(c, 400, 'Ressource invalide');
	}
	const { n } = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM channel_resources WHERE channel_id = ?').bind(channelId).first<{ n: number }>())!;
	if (n >= CHANNEL_RESOURCE_LIMIT) {
		return fail(c, 400, `${CHANNEL_RESOURCE_LIMIT} pages et suivis liés maximum`);
	}
	// Lier ne donne aucun droit : seulement ce que l'acteur voit déjà.
	const wid = c.get('workspaceId');
	const data = await loadAccess(c.env, wid);
	const pages = new Map<string, PageNode>((await listCanvasRows(c.env.DB, wid)).map((row) => [row.id, row]));
	const page = kind === 'page' ? pages.get(id) : undefined;
	const list = kind === 'list' ? (await workspaceLists(c.env.DB, wid)).find((row) => row.id === id) : undefined;
	const level = page && !page.archived_at ? pageLevel(c.get('actor'), page, pages, data) : list ? baseLevel(c.get('actor'), list, data, pages) : null;
	if (!level) {
		return fail(c, 404, 'Ressource introuvable');
	}
	await linkResource(c, channelId, kind, id);
	return c.json<ChannelResources>({ items: await describe(c, channelId, found.rights, found.actors), canLink: true }, 201);
});

channelResourceRoutes.delete('/w/:wid/channels/:cid/resources/:kind/:id', async (c) => {
	const channelId = c.req.param('cid');
	const found = await members(c, channelId);
	if (!found) {
		return fail(c, 404, 'Salon introuvable');
	}
	const link = await c.env.DB.prepare('SELECT added_by FROM channel_resources WHERE workspace_id = ? AND channel_id = ? AND kind = ? AND ref_id = ?')
		.bind(c.get('workspaceId'), channelId, c.req.param('kind'), c.req.param('id'))
		.first<{ added_by: string }>();
	if (!link) {
		return fail(c, 404, 'Lien introuvable');
	}
	if (!found.rights.manage && link.added_by !== c.get('actor').id) {
		return fail(c, 403, 'Seul qui a lié ou qui gère le salon retire le lien');
	}
	await c.env.DB.prepare('DELETE FROM channel_resources WHERE channel_id = ? AND kind = ? AND ref_id = ?').bind(channelId, c.req.param('kind'), c.req.param('id')).run();
	await stub(c)
		.resourcesChanged(channelId)
		.catch(() => undefined);
	return c.json<ChannelResources>({ items: await describe(c, channelId, found.rights, found.actors), canLink: found.rights.send || found.rights.manage });
});
