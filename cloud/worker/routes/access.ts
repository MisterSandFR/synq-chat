import { Hono } from 'hono';

import { ACCESS_KINDS, ACCESS_LIMITS, isAccessLevel, type AccessInfo, type AccessKind, type AccessLevel, type AccessRule, type PageCategory } from '../../shared/access';
import { CANVAS_LIMITS } from '../../shared/canvas';
import { memberKey } from '../../shared/categories';
import { DEFAULT_GRADE } from '../../shared/permissions';
import type { Actor } from '../../shared/types';
import {
	baseLevel,
	categoryLevel,
	inheritedFrom,
	loadAccess,
	pageLevel,
	reviseCardDocs,
	reviseSockets,
	rulesOf,
	spaceLevel,
	subtreeIds,
	type AccessData,
	type CategoryRow,
	type Guarded,
	type PageNode,
} from '../access';
import { listCanvasRows } from '../canvases';
import { listGrades, loadActors } from '../grades';
import { fail, readJson, stub, type AppEnv, type Ctx } from '../http';
import { pagesNotice } from './canvases';
import { listRow } from '../lists';

export const accessRoutes = new Hono<AppEnv>();

const TABLES: Record<AccessKind, string> = { page: 'canvases', page_category: 'page_categories', base: 'lists' };

type Target = { kind: AccessKind; node: Guarded; byId: Map<string, PageNode> };

const categoryRow = (c: Ctx, id: string) =>
	c.env.DB.prepare('SELECT * FROM page_categories WHERE id = ? AND workspace_id = ?').bind(id, c.get('workspaceId')).first<CategoryRow>();

async function target(c: Ctx, kind: AccessKind, id: string): Promise<Target | null> {
	if (kind === 'page') {
		const byId = new Map<string, PageNode>((await listCanvasRows(c.env.DB, c.get('workspaceId'))).map((row) => [row.id, row]));
		const node = byId.get(id);
		return node ? { kind, node, byId } : null;
	}
	if (kind === 'base') {
		const node = await listRow(c.env.DB, c.get('workspaceId'), id);
		const byId = node?.parent_id ? new Map<string, PageNode>((await listCanvasRows(c.env.DB, c.get('workspaceId'))).map((row) => [row.id, row])) : new Map<string, PageNode>();
		return node ? { kind, node, byId } : null;
	}
	const node = await categoryRow(c, id);
	return node ? { kind, node, byId: new Map() } : null;
}

function levelOf(actor: Actor, t: Target, data: AccessData): AccessLevel | null {
	if (t.kind === 'page') {
		return pageLevel(actor, t.node as PageNode, t.byId, data);
	}
	return t.kind === 'page_category' ? categoryLevel(actor, t.node as unknown as CategoryRow, data) : baseLevel(actor, t.node, data, t.byId);
}

async function describe(c: Ctx, t: Target): Promise<AccessInfo | null> {
	const actors = await loadActors(c.env.DB, c.get('workspaceId'));
	const data = await loadAccess(c.env, c.get('workspaceId'));
	const level = levelOf(c.get('actor'), t, data);
	if (!level) {
		return null;
	}
	const inherited = inheritedFrom(t.kind, t.node, t.byId, data);
	return {
		level,
		own: !inherited,
		restricted: inherited ? inherited.restricted : Boolean(t.node.restricted),
		rules: inherited ? inherited.rules : rulesOf(t.kind, t.node.id, data),
		inherited: inherited?.source ?? null,
		count: actors.filter((actor) => levelOf(actor, t, data)).length,
	};
}

async function load(c: Ctx): Promise<Target | Response> {
	const kind = c.req.param('kind') as AccessKind;
	const t = ACCESS_KINDS.includes(kind) ? await target(c, kind, c.req.param('id')!) : null;
	return t ?? fail(c, 404, 'Ressource introuvable');
}

accessRoutes.get('/w/:wid/access/:kind/:id', async (c) => {
	const t = await load(c);
	if (t instanceof Response) {
		return t;
	}
	const info = await describe(c, t);
	return info ? c.json(info) : fail(c, 404, 'Ressource introuvable');
});

accessRoutes.put('/w/:wid/access/:kind/:id', pagesNotice, async (c) => {
	const t = await load(c);
	if (t instanceof Response) {
		return t;
	}
	const before = await describe(c, t);
	if (!before) {
		return fail(c, 404, 'Ressource introuvable');
	}
	if (before.level !== 'manage') {
		return fail(c, 403, 'Accès complet requis pour régler le partage');
	}
	const body = await readJson<{ inherit?: boolean; restricted?: boolean; rules?: AccessRule[] }>(c);
	const inherit = body.inherit === true;
	const restricted = !inherit && body.restricted === true;
	if (!inherit && (!Array.isArray(body.rules) || body.rules.length > ACCESS_LIMITS.rules)) {
		return fail(c, 400, `${ACCESS_LIMITS.rules} règles maximum`);
	}
	const [grades, actors] = await Promise.all([listGrades(c.env.DB, c.get('workspaceId')), loadActors(c.env.DB, c.get('workspaceId'))]);
	const known = new Set([...grades.map((grade) => grade.id), ...actors.map((actor) => memberKey(actor.id))]);
	const rules = new Map<string, AccessLevel>();
	for (const rule of inherit ? [] : body.rules!) {
		if (!rule || typeof rule.subjectId !== 'string' || !known.has(rule.subjectId) || !isAccessLevel(rule.level)) {
			return fail(c, 400, 'Règle invalide');
		}
		// Restreint : l'accès général n'a plus de sens.
		if (!(restricted && rule.subjectId === DEFAULT_GRADE)) {
			rules.set(rule.subjectId, rule.level);
		}
	}
	const wid = c.get('workspaceId');
	await c.env.DB.batch([
		c.env.DB.prepare('DELETE FROM access_rules WHERE resource_kind = ? AND resource_id = ?').bind(t.kind, t.node.id),
		...[...rules].map(([subject, level]) =>
			c.env.DB.prepare('INSERT INTO access_rules (workspace_id, resource_kind, resource_id, subject_id, level) VALUES (?, ?, ?, ?, ?)').bind(wid, t.kind, t.node.id, subject, level),
		),
		c.env.DB.prepare(`UPDATE ${TABLES[t.kind]} SET restricted = ? WHERE id = ?`).bind(restricted ? 1 : 0, t.node.id),
	]);
	const fresh = (await target(c, t.kind, t.node.id))!;
	if (t.kind === 'base') {
		await stub(c)
			.listChanged(t.node.id, t.node.channel_id ?? null)
			.catch(() => undefined);
		await reviseCardDocs(c.env, wid, t.node.id);
	} else {
		const pages = t.kind === 'page' ? fresh.byId : new Map<string, PageNode>((await listCanvasRows(c.env.DB, wid)).map((row) => [row.id, row]));
		const roots = t.kind === 'page' ? new Set([t.node.id]) : new Set([...pages.values()].filter((row) => row.category_id === t.node.id).map((row) => row.id));
		await reviseSockets(c.env, wid, subtreeIds(roots, pages));
		await reviseCardDocs(c.env, wid);
	}
	const info = await describe(c, fresh);
	return info ? c.json(info) : c.json(null);
});

// --- Catégories de pages ---

const toCategory = (row: CategoryRow, level: AccessLevel): PageCategory => ({
	id: row.id,
	workspaceId: row.workspace_id,
	name: row.name,
	icon: row.icon,
	position: row.position,
	restricted: Boolean(row.restricted),
	createdBy: row.created_by,
	level,
});

const cleanName = (raw: unknown) => (typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, ACCESS_LIMITS.categoryName) : '');

async function categoryFor(c: Ctx): Promise<{ row: CategoryRow; level: AccessLevel } | Response> {
	const row = await categoryRow(c, c.req.param('id')!);
	const data = row ? await loadAccess(c.env, c.get('workspaceId')) : null;
	const level = row && data ? categoryLevel(c.get('actor'), row, data) : null;
	if (!row || !level) {
		return fail(c, 404, 'Catégorie introuvable');
	}
	return level === 'manage' ? { row, level } : fail(c, 403, 'Accès complet requis sur cette catégorie');
}

accessRoutes.get('/w/:wid/page-categories', async (c) => {
	const actor = c.get('actor');
	const data = await loadAccess(c.env, c.get('workspaceId'));
	return c.json(
		[...data.categories.values()].flatMap((row) => {
			const level = categoryLevel(actor, row, data);
			return level ? [toCategory(row, level)] : [];
		}),
	);
});

accessRoutes.post('/w/:wid/page-categories', pagesNotice, async (c) => {
	const actor = c.get('actor');
	if (!spaceLevel(actor)) {
		return fail(c, 403, 'Accès invité limité');
	}
	const body = await readJson<{ name?: string; icon?: string | null }>(c);
	const name = cleanName(body.name);
	if (!name) {
		return fail(c, 400, 'Nom requis');
	}
	const wid = c.get('workspaceId');
	const stats = await c.env.DB.prepare('SELECT COUNT(*) AS n, MAX(position) AS top FROM page_categories WHERE workspace_id = ?')
		.bind(wid)
		.first<{ n: number; top: number | null }>();
	if ((stats?.n ?? 0) >= ACCESS_LIMITS.categories) {
		return fail(c, 400, `${ACCESS_LIMITS.categories} catégories maximum`);
	}
	const icon = typeof body.icon === 'string' && body.icon && body.icon.length <= CANVAS_LIMITS.icon ? body.icon : null;
	const row: CategoryRow = { id: crypto.randomUUID(), workspace_id: wid, name, icon, position: (stats?.top ?? 0) + 1, restricted: 0, created_by: actor.id, created_at: Date.now() };
	await c.env.DB.prepare('INSERT INTO page_categories (id, workspace_id, name, icon, position, restricted, created_by, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
		.bind(row.id, wid, name, icon, row.position, actor.id, row.created_at)
		.run();
	return c.json(toCategory(row, 'manage'), 201);
});

accessRoutes.patch('/w/:wid/page-categories/:id', pagesNotice, async (c) => {
	const found = await categoryFor(c);
	if (found instanceof Response) {
		return found;
	}
	const body = await readJson<{ name?: string; icon?: string | null; position?: number }>(c);
	const row = { ...found.row };
	if (body.name !== undefined) {
		row.name = cleanName(body.name);
		if (!row.name) {
			return fail(c, 400, 'Nom requis');
		}
	}
	if (body.icon !== undefined) {
		if (body.icon !== null && (typeof body.icon !== 'string' || !body.icon || body.icon.length > CANVAS_LIMITS.icon)) {
			return fail(c, 400, 'Icône invalide');
		}
		row.icon = body.icon;
	}
	if (body.position !== undefined) {
		if (typeof body.position !== 'number' || !Number.isFinite(body.position)) {
			return fail(c, 400, 'Position invalide');
		}
		row.position = body.position;
	}
	await c.env.DB.prepare('UPDATE page_categories SET name = ?, icon = ?, position = ? WHERE id = ?').bind(row.name, row.icon, row.position, row.id).run();
	return c.json(toCategory(row, found.level));
});

// Les pages de la catégorie reviennent sans catégorie.
accessRoutes.delete('/w/:wid/page-categories/:id', pagesNotice, async (c) => {
	const found = await categoryFor(c);
	if (found instanceof Response) {
		return found;
	}
	const wid = c.get('workspaceId');
	await c.env.DB.batch([
		c.env.DB.prepare('UPDATE canvases SET category_id = NULL WHERE workspace_id = ? AND category_id = ?').bind(wid, found.row.id),
		c.env.DB.prepare('UPDATE lists SET category_id = NULL WHERE workspace_id = ? AND category_id = ?').bind(wid, found.row.id),
		c.env.DB.prepare("DELETE FROM access_rules WHERE resource_kind = 'page_category' AND resource_id = ?").bind(found.row.id),
		c.env.DB.prepare('DELETE FROM page_categories WHERE id = ?').bind(found.row.id),
	]);
	return c.json({ ok: true });
});
