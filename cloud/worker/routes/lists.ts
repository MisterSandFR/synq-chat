import { Hono } from 'hono';

import type { ListDetail } from '../../shared/lists';
import { fail, readJson, stub, type AppEnv, type Ctx } from '../http';
import {
	addComment,
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
import { LIMITS } from '../../shared/types';
import type { CanvasPeer } from '../canvas-doc';

export const listRoutes = new Hono<AppEnv>();

type Rights = { view: boolean; edit: boolean; remove: boolean };

async function rightsOf(c: Ctx, row: ListRow): Promise<Rights> {
	const actor = c.get('actor');
	const [access] = await stub(c).listRights(actor, [row.channel_id]);
	const edit = Boolean(access?.view) && !actor.guest;
	return { view: Boolean(access?.view), edit, remove: edit && (row.created_by === actor.id || Boolean(access?.manage)) };
}

// Liste invisible = 404 : un salon privé ne trahit pas ses listes.
async function loadList(c: Ctx, need: 'view' | 'edit' | 'remove'): Promise<{ row: ListRow; rights: Rights } | Response> {
	const row = await listRow(c.env.DB, c.get('workspaceId'), c.req.param('lid')!);
	const rights = row ? await rightsOf(c, row) : null;
	if (!row || !rights?.view) {
		return fail(c, 404, 'Liste introuvable');
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
	return { ...toSummary(row), columns: columnsOf(row), labels: labelsOf(row), views, items, canEdit: rights.edit, canDelete: rights.remove };
}

listRoutes.get('/w/:wid/lists', async (c) => {
	const rows = await workspaceLists(c.env.DB, c.get('workspaceId'));
	const channel = c.req.query('channel');
	const scoped = channel ? rows.filter((r) => r.channel_id === channel) : rows;
	const access = await stub(c).listRights(
		c.get('actor'),
		scoped.map((r) => r.channel_id),
	);
	return c.json(scoped.filter((_, i) => access[i]?.view).map(toSummary));
});

listRoutes.post('/w/:wid/lists', async (c) => {
	const actor = c.get('actor');
	const input = await readJson<{ title: string; template: string; channelId: string | null }>(c);
	const channelId = typeof input.channelId === 'string' && input.channelId ? input.channelId : null;
	const [access] = await stub(c).listRights(actor, [channelId]);
	if (actor.guest || !access?.view) {
		return fail(c, channelId && !access?.view ? 404 : 403, channelId && !access?.view ? 'Salon introuvable' : 'Permission insuffisante');
	}
	const created = await createList(c.env.DB, c.get('workspaceId'), actor.id, { ...input, channelId });
	if (!created.ok) {
		return fail(c, created.status, created.error);
	}
	await changed(c, created.value);
	return c.json(await detail(c, created.value, { view: true, edit: true, remove: true }), 201);
});

listRoutes.get('/w/:wid/lists/:lid', async (c) => {
	const found = await loadList(c, 'view');
	return found instanceof Response ? found : c.json(await detail(c, found.row, found.rights));
});

listRoutes.patch('/w/:wid/lists/:lid', async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const input = await readJson<{ title: string; description: string; columns: unknown; labels: unknown }>(c);
	const labels = input.labels === undefined ? null : cleanLabels(input.labels);
	if (labels && !labels.ok) {
		return fail(c, labels.status, labels.error);
	}
	const updated = await updateList(c.env.DB, found.row, input, labels ? JSON.stringify(labels.value) : found.row.labels);
	if (!updated.ok) {
		return fail(c, updated.status, updated.error);
	}
	await changed(c, found.row);
	return c.json(await detail(c, (await listRow(c.env.DB, c.get('workspaceId'), found.row.id))!, found.rights));
});

listRoutes.delete('/w/:wid/lists/:lid', async (c) => {
	const found = await loadList(c, 'remove');
	if (found instanceof Response) {
		return found;
	}
	const keys = await fileKeys(c.env.DB, c.get('workspaceId'), { listId: found.row.id });
	await c.env.DB.prepare('DELETE FROM lists WHERE id = ?').bind(found.row.id).run();
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
	await notifyAssigned(c, found.row, created.value.id, created.value.title, newlyAssigned(columns, {}, auto.state.values));
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
	const [history, checklists, files] = await Promise.all([itemHistory(c.env.DB, item.id), checklistsOf(c.env.DB, item.id), filesOf(c.env.DB, c.get('workspaceId'), item.id)]);
	return c.json({ item, ...history, checklists, files });
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
	await notifyAssigned(c, found.row, item.id, updated.title, newlyAssigned(columns, item.values, auto.state.values));
	await notifyRules(c, found.row, updated, auto.notices);
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
	const added = await addComment(c.env.DB, found.row, item.id, c.get('user').id, (await readJson<{ body: string }>(c)).body);
	if (!added.ok) {
		return fail(c, added.status, added.error);
	}
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

type ItemInput = { title: string; description: string; values: unknown; position: number; labels: unknown; cover: unknown; startDate: unknown; dueDate: unknown; done: unknown };

// À la création, pas encore de pièce jointe : seule une couleur est acceptée.
const isColorCover = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

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
