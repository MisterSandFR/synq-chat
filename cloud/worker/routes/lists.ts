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
	return { ...toSummary(row), columns: columnsOf(row), items: await listItems(c.env.DB, row.id), canEdit: rights.edit, canDelete: rights.remove };
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
	const updated = await updateList(c.env.DB, found.row, await readJson<{ title: string; description: string; columns: unknown }>(c));
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
	await c.env.DB.prepare('DELETE FROM lists WHERE id = ?').bind(found.row.id).run();
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
	const input = await readJson<{ title: string; values: unknown; position: number }>(c);
	const columns = columnsOf(found.row);
	const values = await mergeValues(c.env.DB, c.get('workspaceId'), columns, {}, input.values ?? {});
	if (!values.ok) {
		return fail(c, values.status, values.error);
	}
	const created = await createItem(c.env.DB, found.row, c.get('user').id, input, values.value);
	if (!created.ok) {
		return fail(c, created.status, created.error);
	}
	await notifyAssigned(c, found.row, created.value.id, created.value.title, newlyAssigned(columns, {}, values.value));
	await changed(c, found.row);
	return c.json(created.value, 201);
});

listRoutes.get('/w/:wid/lists/:lid/items/:iid', async (c) => {
	const found = await loadList(c, 'view');
	if (found instanceof Response) {
		return found;
	}
	const item = await itemRow(c.env.DB, found.row.id, c.req.param('iid'));
	return item ? c.json({ item, ...(await itemHistory(c.env.DB, item.id)) }) : fail(c, 404, 'Élément introuvable');
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
	const input = await readJson<{ title: string; description: string; values: unknown; position: number }>(c);
	const columns = columnsOf(found.row);
	const values = await mergeValues(c.env.DB, c.get('workspaceId'), columns, item.values, input.values);
	if (!values.ok) {
		return fail(c, values.status, values.error);
	}
	const updated = await updateItem(c.env.DB, found.row, item, c.get('user').id, input, values.value);
	await notifyAssigned(c, found.row, item.id, updated.title, newlyAssigned(columns, item.values, values.value));
	await changed(c, found.row);
	return c.json(updated);
});

listRoutes.delete('/w/:wid/lists/:lid/items/:iid', async (c) => {
	const found = await loadList(c, 'edit');
	if (found instanceof Response) {
		return found;
	}
	const done = await c.env.DB.batch([c.env.DB.prepare('DELETE FROM list_items WHERE id = ? AND list_id = ?').bind(c.req.param('iid'), found.row.id), touchList(c.env.DB, found.row.id)]);
	if (!done[0]!.meta.changes) {
		return fail(c, 404, 'Élément introuvable');
	}
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
