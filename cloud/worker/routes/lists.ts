import { Hono } from 'hono';

import type { CardLink, ListDetail } from '../../shared/lists';
import { fail, readJson, stub, type AppEnv, type Ctx } from '../http';
import {
	addComment,
	archivedItems,
	columnsOf,
	createItem,
	createList,
	itemHistory,
	itemRow,
	listItems,
	listRow,
	mergeValues,
	newlyAssigned,
	toCsv,
	toSummary,
	touchList,
	updateItem,
	updateList,
	workspaceLists,
	placeList,
	type ListPlace,
	type ListRow,
} from '../lists';
import {
	addCheck,
	addChecklist,
	applyRules,
	checklistsOf,
	cleanFields,
	cleanLabels,
	createRule,
	createView,
	deleteRule,
	deleteView,
	fileKey,
	fileKeys,
	fileRow,
	filesOf,
	insertFile,
	itemDocId,
	itemDocMeta,
	itemPeople,
	labelsOf,
	listViews,
	removeCheck,
	removeChecklist,
	renameChecklist,
	rulesOf,
	sendNotice,
	setRuleEnabled,
	updateCheck,
	updateView,
	type Notice,
} from '../lists-bases';
import { listCanvasRows, scopeOf, workspaceMemberIds } from '../canvases';
import { addLink, checkToCard, duplicateCard, followersOf, moveCard, removeLink, resolveLinks, searchTargets, setFollow, toggleReaction, type ScopedLink } from '../lists-cards';
import { LIMITS } from '../../shared/types';
import { atLeast, type AccessLevel } from '../../shared/access';
import { baseAccess, baseLevel, baseLevels, categoryLevel, loadAccess, pageAccess, reviseCardDocs } from '../access';
import { pagesNotice } from './canvases';
import { CANVAS_LIMITS } from '../../shared/canvas';
import type { CanvasPeer } from '../canvas-doc';

export const listRoutes = new Hono<AppEnv>();

type Rights = { view: boolean; edit: boolean; remove: boolean; level: AccessLevel | null };

async function rightsOf(c: Ctx, row: ListRow): Promise<Rights> {
	const actor = c.get('actor');
	const { pages, data } = await baseAccess(c.env, c.get('workspaceId'), [actor], [row]);
	const level = baseLevel(actor, row, data, pages);
	const edit = atLeast(level, 'edit') && !actor.guest;
	return { view: level !== null, edit, remove: edit && level === 'manage', level };
}

// Liste invisible = 404 : un salon privé ne trahit pas ses listes.
async function loadList(c: Ctx, need: 'view' | 'edit' | 'remove'): Promise<{ row: ListRow; rights: Rights } | Response> {
	const row = await listRow(c.env.DB, c.get('workspaceId'), c.req.param('lid')!);
	const rights = row ? await rightsOf(c, row) : null;
	if (!row || !rights?.view) {
		return fail(c, 404, 'Suivi introuvable');
	}
	if (!rights[need]) {
		return fail(c, 403, 'Permission insuffisante');
	}
	return { row, rights };
}

const changed = (c: Ctx, row: ListRow) =>
	stub(c)
		.listChanged(row.id, row.channel_id)
		.catch(() => undefined);

async function detail(c: Ctx, row: ListRow, rights: Rights): Promise<ListDetail> {
	const [items, views] = await Promise.all([listItems(c.env.DB, row.id), listViews(c.env.DB, row.id)]);
	return { ...toSummary(row), columns: columnsOf(row), labels: labelsOf(row), views, items, canEdit: rights.edit, canDelete: rights.remove, level: rights.level ?? 'view' };
}

listRoutes.get('/w/:wid/lists', async (c) => {
	const rows = await workspaceLists(c.env.DB, c.get('workspaceId'));
	const channel = c.req.query('channel');
	const scoped = channel ? rows.filter((r) => r.channel_id === channel) : rows;
	const levels = await baseLevels(c.env, c.get('workspaceId'), c.get('actor'), scoped);
	return c.json(scoped.flatMap((r) => (levels.has(r.id) ? [{ ...toSummary(r), level: levels.get(r.id)! }] : [])));
});

// Emplacement dans l'arbre : sous une page modifiable, sinon dans une catégorie modifiable, sinon à la racine.
async function placeOf(c: Ctx, parentId: unknown, categoryId: unknown): Promise<ListPlace | Response> {
	const actor = c.get('actor');
	if (typeof parentId === 'string' && parentId) {
		const { byId, levels } = await pageAccess(c.env, c.get('workspaceId'), actor);
		const parent = byId.get(parentId);
		const level = levels.get(parentId);
		if (!parent || !level || parent.archived_at !== null) {
			return fail(c, 404, 'Page parente introuvable');
		}
		return atLeast(level, 'edit') ? { parent_id: parent.id, category_id: null } : fail(c, 403, 'Page parente en lecture seule');
	}
	if (typeof categoryId === 'string' && categoryId) {
		const data = await loadAccess(c.env, c.get('workspaceId'), [actor], []);
		const category = data.categories.get(categoryId);
		const level = category ? categoryLevel(actor, category, data) : null;
		if (!category || !level) {
			return fail(c, 404, 'Catégorie introuvable');
		}
		return atLeast(level, 'edit') ? { parent_id: null, category_id: category.id } : fail(c, 403, 'Catégorie en lecture seule');
	}
	return { parent_id: null, category_id: null };
}

listRoutes.post('/w/:wid/lists', pagesNotice, async (c) => {
	const actor = c.get('actor');
	const input = await readJson<{ title: string; template: string; channelId: string | null; parentId?: string | null; categoryId?: string | null }>(c);
	const channelId = typeof input.channelId === 'string' && input.channelId ? input.channelId : null;
	const [access] = await stub(c).listRights(actor, [channelId]);
	if (actor.guest || !access?.view) {
		return fail(c, channelId && !access?.view ? 404 : 403, channelId && !access?.view ? 'Salon introuvable' : 'Permission insuffisante');
	}
	const place = channelId ? { parent_id: null, category_id: null } : await placeOf(c, input.parentId, input.categoryId);
	if (place instanceof Response) {
		return place;
	}
	const created = await createList(c.env.DB, c.get('workspaceId'), actor.id, { ...input, channelId });
	if (!created.ok) {
		return fail(c, created.status, created.error);
	}
	if (!channelId) {
		await placeList(c.env.DB, created.value, place);
	}
	const row = (await listRow(c.env.DB, c.get('workspaceId'), created.value.id))!;
	await changed(c, row);
	return c.json(await detail(c, row, { view: true, edit: true, remove: true, level: 'manage' }), 201);
});

listRoutes.get('/w/:wid/lists/:lid', async (c) => {
	const found = await loadList(c, 'view');
	return found instanceof Response ? found : c.json(await detail(c, found.row, found.rights));
});

listRoutes.patch('/w/:wid/lists/:lid', pagesNotice, async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const input = await readJson<{ title: string; description: string; columns: unknown; labels: unknown; icon?: string | null; parentId?: string | null; categoryId?: string | null; position?: number }>(c);
	const labels = input.labels === undefined ? null : cleanLabels(input.labels);
	if (labels && !labels.ok) {
		return fail(c, labels.status, labels.error);
	}
	if (input.icon !== undefined && input.icon !== null && (typeof input.icon !== 'string' || !input.icon || input.icon.length > CANVAS_LIMITS.icon)) {
		return fail(c, 400, 'Icône invalide');
	}
	if (input.position !== undefined && (typeof input.position !== 'number' || !Number.isFinite(input.position))) {
		return fail(c, 400, 'Position invalide');
	}
	const moving = input.parentId !== undefined || input.categoryId !== undefined;
	if (moving && found.row.channel_id && (input.parentId || input.categoryId)) {
		return fail(c, 400, 'Le suivi d’un salon reste dans son salon');
	}
	const place = moving
		? await placeOf(c, input.parentId !== undefined ? input.parentId : found.row.parent_id, input.categoryId !== undefined ? input.categoryId : found.row.category_id)
		: { parent_id: found.row.parent_id, category_id: found.row.category_id };
	if (place instanceof Response) {
		return place;
	}
	if (moving || input.position !== undefined) {
		await placeList(c.env.DB, found.row, place, input.position ?? (moving ? undefined : found.row.position));
	}
	if (input.icon !== undefined) {
		await c.env.DB.prepare('UPDATE lists SET icon = ? WHERE id = ?').bind(input.icon, found.row.id).run();
	}
	const updated = await updateList(c.env.DB, found.row, input, labels ? JSON.stringify(labels.value) : found.row.labels);
	if (!updated.ok) {
		return fail(c, updated.status, updated.error);
	}
	await changed(c, found.row);
	// Déplacé : les droits hérités de la page ou de la catégorie peuvent changer.
	if (moving) {
		await reviseCardDocs(c.env, c.get('workspaceId'), found.row.id);
	}
	return c.json(await detail(c, (await listRow(c.env.DB, c.get('workspaceId'), found.row.id))!, found.rights));
});

listRoutes.delete('/w/:wid/lists/:lid', pagesNotice, async (c) => {
	const found = await loadList(c, 'remove');
	if (found instanceof Response) {
		return found;
	}
	const keys = await fileKeys(c.env.DB, c.get('workspaceId'), { listId: found.row.id });
	await c.env.DB.batch([
		c.env.DB.prepare('DELETE FROM lists WHERE id = ?').bind(found.row.id),
		c.env.DB.prepare("DELETE FROM access_rules WHERE resource_kind = 'base' AND resource_id = ?").bind(found.row.id),
	]);
	c.executionCtx.waitUntil(keys.length ? c.env.FILES.delete(keys) : Promise.resolve());
	await changed(c, found.row);
	return c.json(null);
});

async function notifyAssigned(c: Ctx, row: ListRow, itemId: string, title: string, people: string[]): Promise<void> {
	if (people.length) {
		await stub(c)
			.listAssigned(c.get('actor'), people, { workspaceId: c.get('workspaceId'), listId: row.id, itemId, channelId: row.channel_id, listTitle: row.title, itemTitle: title })
			.catch(() => undefined);
	}
}

listRoutes.post('/w/:wid/lists/:lid/items', async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const input = await readJson<ItemInput>(c);
	const columns = columnsOf(found.row);
	const values = await mergeValues(c.env.DB, c.get('workspaceId'), columns, {}, input.values ?? {});
	if (!values.ok) {
		return fail(c, values.status, values.error);
	}
	const fields = await cleanFields(c.env.DB, found.row, null, { ...input, cover: isColorCover(input.cover) ? input.cover : undefined });
	if (!fields.ok) {
		return fail(c, fields.status, fields.error);
	}
	const auto = applyRules(await rulesOf(c.env.DB, found.row.id), columns, {}, { values: values.value, fields: fields.value });
	const created = await createItem(c.env.DB, found.row, c.get('user').id, input, auto.state.values, auto.state.fields);
	if (!created.ok) {
		return fail(c, created.status, created.error);
	}
	await notifyAssigned(c, found.row, created.value.id, created.value.title, [...newlyAssigned(columns, {}, auto.state.values), ...auto.state.fields.members]);
	await notifyRules(c, found.row, created.value, auto.notices);
	await changed(c, found.row);
	return c.json(created.value, 201);
});

listRoutes.get('/w/:wid/lists/:lid/items/:iid', async (c) => {
	const found = await loadList(c, 'view');
	if (found instanceof Response) {
		return found;
	}
	const item = await itemRow(c.env.DB, found.row.id, c.req.param('iid'));
	if (!item) {
		return fail(c, 404, 'Élément introuvable');
	}
	const [history, checklists, files, links, followers] = await Promise.all([
		itemHistory(c.env.DB, item.id),
		checklistsOf(c.env.DB, item.id),
		filesOf(c.env.DB, c.get('workspaceId'), item.id),
		resolveLinks(c.env.DB, c.get('workspaceId'), item.id),
		followersOf(c.env.DB, item.id),
	]);
	return c.json({ item, ...history, checklists, files, links: await visibleLinks(c, links), following: followers.includes(c.get('actor').id) });
});

listRoutes.patch('/w/:wid/lists/:lid/items/:iid', async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const item = await itemRow(c.env.DB, found.row.id, c.req.param('iid'));
	if (!item) {
		return fail(c, 404, 'Élément introuvable');
	}
	const input = await readJson<ItemInput>(c);
	const columns = columnsOf(found.row);
	const values = await mergeValues(c.env.DB, c.get('workspaceId'), columns, item.values, input.values);
	if (!values.ok) {
		return fail(c, values.status, values.error);
	}
	const fields = await cleanFields(c.env.DB, found.row, item, input);
	if (!fields.ok) {
		return fail(c, fields.status, fields.error);
	}
	const auto = applyRules(await rulesOf(c.env.DB, found.row.id), columns, item.values, { values: values.value, fields: fields.value });
	const updated = await updateItem(c.env.DB, found.row, item, c.get('user').id, input, auto.state.values, auto.state.fields, auto.fired);
	await notifyAssigned(c, found.row, item.id, updated.title, [...newlyAssigned(columns, item.values, auto.state.values), ...updated.members.filter((id) => !item.members.includes(id))]);
	await notifyRules(c, found.row, updated, auto.notices);
	if (updated.done !== item.done || Boolean(updated.archivedAt) !== Boolean(item.archivedAt)) {
		await notifyFollowers(c, found.row, updated, updated.archivedAt && !item.archivedAt ? 'Carte archivée' : updated.done && !item.done ? 'Carte terminée' : 'Carte rouverte');
	}
	await changed(c, found.row);
	return c.json(updated);
});

listRoutes.delete('/w/:wid/lists/:lid/items/:iid', async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const keys = await fileKeys(c.env.DB, c.get('workspaceId'), { listId: found.row.id, itemId: c.req.param('iid') });
	const done = await c.env.DB.batch([c.env.DB.prepare('DELETE FROM list_items WHERE id = ? AND list_id = ?').bind(c.req.param('iid'), found.row.id), touchList(c.env.DB, found.row.id)]);
	if (!done[0]!.meta.changes) {
		return fail(c, 404, 'Élément introuvable');
	}
	c.executionCtx.waitUntil(keys.length ? c.env.FILES.delete(keys) : Promise.resolve());
	await changed(c, found.row);
	return c.json(null);
});

listRoutes.post('/w/:wid/lists/:lid/items/:iid/comments', async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const item = await itemRow(c.env.DB, found.row.id, c.req.param('iid'));
	if (!item) {
		return fail(c, 404, 'Élément introuvable');
	}
	const input = await readJson<{ body: string; mentions: unknown }>(c);
	const added = await addComment(c.env.DB, found.row, item.id, c.get('user').id, input.body);
	if (!added.ok) {
		return fail(c, added.status, added.error);
	}
	const actor = c.get('actor');
	const asked = Array.isArray(input.mentions) ? input.mentions.filter((id): id is string => typeof id === 'string').slice(0, 20) : [];
	const mentioned = asked.length ? await workspaceMemberIds(c.env.DB, c.get('workspaceId'), asked) : [];
	await sendNotice(c.env, found.row, actor.id, mentioned, item, `${actor.name} t’a mentionné dans un commentaire`).catch(() => undefined);
	await notifyFollowers(c, found.row, item, `Nouveau commentaire de ${actor.name}`, mentioned);
	await changed(c, found.row);
	return c.json(added.value, 201);
});

listRoutes.get('/w/:wid/lists/:lid/export', async (c) => {
	const found = await loadList(c, 'view');
	if (found instanceof Response) {
		return found;
	}
	const { results } = await c.env.DB.prepare('SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?').bind(c.get('workspaceId')).all<{ id: string; name: string }>();
	const body = toCsv(columnsOf(found.row), await listItems(c.env.DB, found.row.id), new Map(results.map((r) => [r.id, r.name])));
	const name = found.row.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'liste';
	return new Response(body, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="liste.csv"; filename*=UTF-8''${encodeURIComponent(name)}.csv`,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
		},
	});
});

// --- Bases : champs natifs, vues, checklists, pièces jointes, automatisations, document ---

type ItemInput = {
	title: string;
	description: string;
	values: unknown;
	position: number;
	labels: unknown;
	cover: unknown;
	startDate: unknown;
	dueDate: unknown;
	done: unknown;
	icon: unknown;
	coverMode: unknown;
	coverY: unknown;
	members: unknown;
	startTime: unknown;
	dueTime: unknown;
	reminder: unknown;
	estimate: unknown;
	estimateUnit: unknown;
	archived: unknown;
	template: unknown;
};

// À la création, pas encore de pièce jointe : seule une couleur ou un dégradé est accepté.
const isColorCover = (value: unknown) => typeof value === 'string' && (/^#[0-9a-f]{6}$/i.test(value) || value.startsWith('grad:'));

async function notifyRules(c: Ctx, row: ListRow, item: { id: string; title: string; values: Record<string, unknown> }, notices: Notice[]): Promise<void> {
	for (const notice of notices) {
		const people = notice.user ? [notice.user] : itemPeople(columnsOf(row), item.values as never);
		await sendNotice(c.env, row, c.get('actor').id, people, item, `Automatisation · ${notice.text}`).catch(() => undefined);
	}
}

async function loadItem(c: Ctx, need: 'view' | 'edit') {
	const found = await loadList(c, need);
	if (found instanceof Response) {
		return found;
	}
	const item = await itemRow(c.env.DB, found.row.id, c.req.param('iid')!);
	return item ? { ...found, item } : fail(c, 404, 'Élément introuvable');
}

listRoutes.post('/w/:wid/lists/:lid/views', async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const created = await createView(c.env.DB, found.row, c.get('actor').id, await readJson<{ name: string; kind: string; config: unknown }>(c));
	if (!created.ok) {
		return fail(c, created.status, created.error);
	}
	await changed(c, found.row);
	return c.json(created.value, 201);
});

listRoutes.patch('/w/:wid/lists/:lid/views/:vid', async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const updated = await updateView(c.env.DB, found.row, c.req.param('vid'), await readJson<{ name: string; config: unknown; position: number }>(c));
	if (!updated.ok) {
		return fail(c, updated.status, updated.error);
	}
	await changed(c, found.row);
	return c.json(updated.value);
});

listRoutes.delete('/w/:wid/lists/:lid/views/:vid', async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const done = await deleteView(c.env.DB, found.row, c.req.param('vid'));
	if (!done.ok) {
		return fail(c, done.status, done.error);
	}
	await changed(c, found.row);
	return c.json(null);
});

listRoutes.post('/w/:wid/lists/:lid/items/:iid/checklists', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const created = await addChecklist(c.env.DB, found.item.id, (await readJson<{ title: string }>(c)).title);
	if (!created.ok) {
		return fail(c, created.status, created.error);
	}
	await changed(c, found.row);
	return c.json(created.value, 201);
});

listRoutes.patch('/w/:wid/lists/:lid/items/:iid/checklists/:clid', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const done = await renameChecklist(c.env.DB, found.item.id, c.req.param('clid'), (await readJson<{ title: string }>(c)).title);
	return done.ok ? c.json(null) : fail(c, done.status, done.error);
});

listRoutes.delete('/w/:wid/lists/:lid/items/:iid/checklists/:clid', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const done = await removeChecklist(c.env.DB, found.item.id, c.req.param('clid'));
	if (!done.ok) {
		return fail(c, done.status, done.error);
	}
	await changed(c, found.row);
	return c.json(null);
});

listRoutes.post('/w/:wid/lists/:lid/items/:iid/checklists/:clid/checks', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const created = await addCheck(c.env.DB, c.get('workspaceId'), found.item.id, c.req.param('clid'), await readJson<{ text: string; assignee: string | null; due: string | null }>(c));
	if (!created.ok) {
		return fail(c, created.status, created.error);
	}
	if (created.value.assignee) {
		await notifyAssigned(c, found.row, found.item.id, found.item.title, [created.value.assignee]);
	}
	await changed(c, found.row);
	return c.json(created.value, 201);
});

listRoutes.patch('/w/:wid/lists/:lid/items/:iid/checks/:chid', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const updated = await updateCheck(c.env.DB, c.get('workspaceId'), found.item.id, c.req.param('chid'), await readJson<{ text: string; done: boolean; assignee: string | null; due: string | null; position: number }>(c));
	if (!updated.ok) {
		return fail(c, updated.status, updated.error);
	}
	if (updated.value.assigned) {
		await notifyAssigned(c, found.row, found.item.id, found.item.title, [updated.value.assigned]);
	}
	await changed(c, found.row);
	return c.json(updated.value.check);
});

listRoutes.delete('/w/:wid/lists/:lid/items/:iid/checks/:chid', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const done = await removeCheck(c.env.DB, found.item.id, c.req.param('chid'));
	if (!done.ok) {
		return fail(c, done.status, done.error);
	}
	await changed(c, found.row);
	return c.json(null);
});

// Même plafond que les fichiers du chat ; servis sous le contrôle de la base.
listRoutes.post('/w/:wid/lists/:lid/items/:iid/files', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	if (found.item.attachments >= 30) {
		return fail(c, 409, 'Trop de pièces jointes');
	}
	const size = Number(c.req.header('Content-Length'));
	if (!Number.isInteger(size) || size <= 0) {
		return fail(c, 400, 'Fichier vide ou taille inconnue');
	}
	if (size > LIMITS.fileSize) {
		return fail(c, 413, 'Fichier trop lourd (50 Mo max)');
	}
	const type = (c.req.header('Content-Type')?.split(';')[0]?.trim() || 'application/octet-stream').slice(0, 100);
	let name = 'fichier';
	try {
		name = decodeURIComponent(c.req.header('X-File-Name') ?? '').trim().slice(0, 200) || name;
	} catch {
		// Nom mal encodé : nom générique.
	}
	const id = crypto.randomUUID();
	const stream = new FixedLengthStream(size);
	await Promise.all([
		c.env.FILES.put(fileKey(c.get('workspaceId'), found.row.id, id), stream.readable, { httpMetadata: { contentType: type }, customMetadata: { uploadedBy: c.get('actor').id } }),
		c.req.raw.body!.pipeTo(stream.writable),
	]);
	const file = await insertFile(c.env.DB, c.get('workspaceId'), { id, item_id: found.item.id, list_id: found.row.id, name, size, type, created_by: c.get('actor').id, created_at: Date.now() });
	await changed(c, found.row);
	return c.json(file, 201);
});

listRoutes.get('/w/:wid/lists/:lid/files/:fid', async (c) => {
	const found = await loadList(c, 'view');
	if (found instanceof Response) {
		return found;
	}
	const row = await fileRow(c.env.DB, found.row.id, c.req.param('fid'));
	const object = row ? await c.env.FILES.get(fileKey(c.get('workspaceId'), found.row.id, row.id)) : null;
	if (!row || !object) {
		return fail(c, 404, 'Fichier introuvable');
	}
	const inline = /^image\/(png|jpeg|gif|webp|avif)$/.test(row.type);
	return new Response(object.body, {
		headers: {
			// Type déclaré par l'envoyeur : rendu seulement pour les images sûres.
			'Content-Type': inline ? row.type : 'application/octet-stream',
			'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
			'Cache-Control': 'private, max-age=86400',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'; sandbox",
		},
	});
});

listRoutes.delete('/w/:wid/lists/:lid/items/:iid/files/:fid', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const fid = c.req.param('fid');
	const done = await c.env.DB.batch([
		c.env.DB.prepare('DELETE FROM list_attachments WHERE id = ? AND item_id = ?').bind(fid, found.item.id),
		c.env.DB.prepare('UPDATE list_items SET cover = NULL WHERE id = ? AND cover = ?').bind(found.item.id, `file:${fid}`),
	]);
	if (!done[0]!.meta.changes) {
		return fail(c, 404, 'Fichier introuvable');
	}
	c.executionCtx.waitUntil(c.env.FILES.delete(fileKey(c.get('workspaceId'), found.row.id, fid)));
	await changed(c, found.row);
	return c.json(null);
});

listRoutes.get('/w/:wid/lists/:lid/rules', async (c) => {
	const found = await loadList(c, 'view');
	return found instanceof Response ? found : c.json(await rulesOf(c.env.DB, found.row.id));
});

listRoutes.post('/w/:wid/lists/:lid/rules', async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const created = await createRule(c.env.DB, found.row, columnsOf(found.row), c.get('actor').id, await readJson<{ trigger: unknown; action: unknown }>(c));
	return created.ok ? c.json(created.value, 201) : fail(c, created.status, created.error);
});

listRoutes.patch('/w/:wid/lists/:lid/rules/:rid', async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const done = await setRuleEnabled(c.env.DB, found.row, c.req.param('rid'), (await readJson<{ enabled: boolean }>(c)).enabled);
	return done.ok ? c.json(null) : fail(c, done.status, done.error);
});

listRoutes.delete('/w/:wid/lists/:lid/rules/:rid', async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const done = await deleteRule(c.env.DB, found.row, c.req.param('rid'));
	return done.ok ? c.json(null) : fail(c, done.status, done.error);
});

// Document collaboratif : créé au premier accès en écriture, servi avec les droits de la base.
listRoutes.post('/w/:wid/lists/:lid/items/:iid/page', async (c) => {
	const found = await loadItem(c, 'view');
	if (found instanceof Response) {
		return found;
	}
	const docId = await itemDocId(c.env.DB, found.item.id, found.rights.edit);
	if (!docId) {
		return fail(c, 404, 'Pas encore de document');
	}
	if (!found.item.pageId) {
		await changed(c, found.row);
	}
	return c.json(itemDocMeta(found.row, found.item, docId, found.rights.edit));
});

listRoutes.get('/w/:wid/lists/:lid/items/:iid/page/ws', async (c) => {
	const found = await loadItem(c, 'view');
	if (found instanceof Response) {
		return found;
	}
	const docId = await itemDocId(c.env.DB, found.item.id, false);
	if (!docId) {
		return fail(c, 404, 'Pas encore de document');
	}
	if (c.req.header('Upgrade') !== 'websocket') {
		return fail(c, 400, 'WebSocket attendu');
	}
	const peer: CanvasPeer = { canvasId: docId, userId: c.get('actor').id, write: found.rights.edit };
	const headers = new Headers(c.req.raw.headers);
	headers.set('x-canvas-peer', JSON.stringify(peer));
	return c.env.CANVAS_DOC.getByName(docId).fetch(new Request(c.req.raw, { headers }));
});

// --- Cartes riches : dupliquer, déplacer, archives, suivi, liens, réactions ---

async function notifyFollowers(c: Ctx, row: ListRow, item: { id: string; title: string }, title: string, skip: string[] = []): Promise<void> {
	const followers = (await followersOf(c.env.DB, item.id)).filter((id) => !skip.includes(id));
	await sendNotice(c.env, row, c.get('actor').id, followers, item, title).catch(() => undefined);
}

// Droits relus par les vérifications existantes : base de la carte liée, portée de la page.
async function visibleLinks(c: Ctx, links: ScopedLink[]): Promise<CardLink[]> {
	const listIds = [...new Set(links.filter((l) => l.kind === 'card').map((l) => l.listId!))];
	const rows = await Promise.all(listIds.map((id) => listRow(c.env.DB, c.get('workspaceId'), id)));
	const rights = await Promise.all(rows.map((row) => (row ? rightsOf(c, row) : null)));
	const seen = new Set(listIds.filter((_, i) => rights[i]?.view));
	const pages = links.filter((l) => l.kind === 'page');
	const access = pages.length ? await stub(c).canvasAccess(c.get('actor'), pages.map((l) => l.scope)) : [];
	const open = new Set(pages.filter((_, i) => access[i]).map((l) => l.id));
	return links.filter((l) => (l.kind === 'card' ? seen.has(l.listId!) : open.has(l.id))).map(({ scope: _scope, ...link }) => link);
}

listRoutes.get('/w/:wid/lists/:lid/archived', async (c) => {
	const found = await loadList(c, 'view');
	return found instanceof Response ? found : c.json(await archivedItems(c.env.DB, found.row.id));
});

listRoutes.post('/w/:wid/lists/:lid/items/:iid/duplicate', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const input = await readJson<{ title: string; template: boolean; values: unknown }>(c);
	const template = input.template === true;
	const values = await mergeValues(c.env.DB, c.get('workspaceId'), columnsOf(found.row), found.item.values, input.values);
	if (!values.ok) {
		return fail(c, values.status, values.error);
	}
	const fromTemplate = found.item.template && !template;
	const title = typeof input.title === 'string' && input.title.trim() ? input.title : fromTemplate ? found.item.title : `${found.item.title || 'Sans titre'} (copie)`;
	const created = await duplicateCard(c.env.DB, found.row, found.item, c.get('actor').id, { title, template, values: values.value });
	if (!created.ok) {
		return fail(c, created.status, created.error);
	}
	if (fromTemplate) {
		await notifyAssigned(c, found.row, created.value.id, created.value.title, created.value.members);
	}
	await changed(c, found.row);
	return c.json(created.value, 201);
});

// Écriture exigée des deux côtés ; base cible invisible = introuvable.
listRoutes.post('/w/:wid/lists/:lid/items/:iid/move', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const input = await readJson<{ listId: string }>(c);
	const target = typeof input.listId === 'string' ? await listRow(c.env.DB, c.get('workspaceId'), input.listId) : null;
	const rights = target ? await rightsOf(c, target) : null;
	if (!target || !rights?.view) {
		return fail(c, 404, 'Suivi introuvable');
	}
	if (!rights.edit) {
		return fail(c, 403, 'Permission insuffisante');
	}
	const moved = await moveCard(c.env, found.row, target, found.item, c.get('actor').id);
	if (!moved.ok) {
		return fail(c, moved.status, moved.error);
	}
	c.executionCtx.waitUntil(moved.value.stale.length ? c.env.FILES.delete(moved.value.stale) : Promise.resolve());
	await notifyFollowers(c, target, moved.value.item, `Carte déplacée vers ${target.title}`);
	await Promise.all([changed(c, found.row), changed(c, target)]);
	return c.json(moved.value.item);
});

listRoutes.post('/w/:wid/lists/:lid/items/:iid/checks/:chid/convert', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const created = await checkToCard(c.env.DB, found.row, found.item, c.req.param('chid'), c.get('actor').id);
	if (!created.ok) {
		return fail(c, created.status, created.error);
	}
	await notifyAssigned(c, found.row, created.value.id, created.value.title, created.value.members);
	await changed(c, found.row);
	return c.json(created.value, 201);
});

listRoutes.put('/w/:wid/lists/:lid/items/:iid/follow', async (c) => {
	const found = await loadItem(c, 'view');
	if (found instanceof Response) {
		return found;
	}
	const on = (await readJson<{ on: boolean }>(c)).on;
	if (typeof on !== 'boolean') {
		return fail(c, 400, 'Valeur invalide');
	}
	await setFollow(c.env.DB, found.item.id, c.get('actor').id, on);
	return c.json({ following: on });
});

async function targetVisible(c: Ctx, kind: unknown, id: unknown): Promise<boolean> {
	if (typeof id !== 'string') {
		return false;
	}
	if (kind === 'card') {
		const owner = await c.env.DB.prepare('SELECT list_id FROM list_items WHERE id = ?').bind(id).first<{ list_id: string }>();
		const row = owner ? await listRow(c.env.DB, c.get('workspaceId'), owner.list_id) : null;
		return Boolean(row && (await rightsOf(c, row)).view);
	}
	const rows = await listCanvasRows(c.env.DB, c.get('workspaceId'));
	const byId = new Map(rows.map((r) => [r.id, r]));
	const page = byId.get(id);
	return Boolean(page && (await stub(c).canvasAccess(c.get('actor'), [scopeOf(page, byId)]))[0]);
}

listRoutes.post('/w/:wid/lists/:lid/items/:iid/links', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const input = await readJson<{ kind: string; id: string }>(c);
	if ((input.kind === 'card' || input.kind === 'page') && !(await targetVisible(c, input.kind, input.id))) {
		return fail(c, 404, 'Cible introuvable');
	}
	const done = await addLink(c.env.DB, c.get('workspaceId'), found.item, c.get('actor').id, input);
	if (!done.ok) {
		return fail(c, done.status, done.error);
	}
	await changed(c, found.row);
	return c.json(await visibleLinks(c, await resolveLinks(c.env.DB, c.get('workspaceId'), found.item.id)), 201);
});

listRoutes.delete('/w/:wid/lists/:lid/items/:iid/links/:kind/:ref', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const done = await removeLink(c.env.DB, found.item.id, c.req.param('kind'), c.req.param('ref'));
	if (!done.ok) {
		return fail(c, done.status, done.error);
	}
	await changed(c, found.row);
	return c.json(null);
});

listRoutes.get('/w/:wid/lists/:lid/items/:iid/link-targets', async (c) => {
	const found = await loadItem(c, 'view');
	if (found instanceof Response) {
		return found;
	}
	const targets = await searchTargets(c.env.DB, c.get('workspaceId'), c.req.query('q') ?? '', found.item.id);
	return c.json(await visibleLinks(c, targets));
});

listRoutes.post('/w/:wid/lists/:lid/items/:iid/comments/:cid/reactions', async (c) => {
	const found = await loadItem(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const done = await toggleReaction(c.env.DB, found.item.id, c.req.param('cid'), c.get('actor').id, (await readJson<{ emoji: string }>(c)).emoji);
	if (!done.ok) {
		return fail(c, done.status, done.error);
	}
	await changed(c, found.row);
	return c.json(null);
});
