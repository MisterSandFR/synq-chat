import { CANVAS_LIMITS, type CanvasAccess, type CanvasMeta } from '../shared/canvas';

export type CanvasRow = {
	id: string;
	workspace_id: string;
	channel_id: string | null;
	title: string;
	excerpt: string;
	editors: string;
	created_by: string;
	created_at: number;
	updated_at: number;
};

const parseEditors = (raw: string): string[] => {
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
	} catch {
		return [];
	}
};

export const toMeta = (row: CanvasRow, access: CanvasAccess): CanvasMeta => ({
	id: row.id,
	workspaceId: row.workspace_id,
	channelId: row.channel_id,
	title: row.title,
	excerpt: row.excerpt,
	editors: parseEditors(row.editors),
	createdBy: row.created_by,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	access,
});

export const cleanTitle = (raw: unknown) => (typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, CANVAS_LIMITS.title) : '');

export const canvasRow = (db: D1Database, workspaceId: string, id: string) =>
	db.prepare('SELECT * FROM canvases WHERE id = ? AND workspace_id = ?').bind(id, workspaceId).first<CanvasRow>();

export const channelCanvasRow = (db: D1Database, workspaceId: string, channelId: string) =>
	db.prepare('SELECT * FROM canvases WHERE workspace_id = ? AND channel_id = ?').bind(workspaceId, channelId).first<CanvasRow>();

export async function listCanvasRows(db: D1Database, workspaceId: string): Promise<CanvasRow[]> {
	const { results } = await db.prepare('SELECT * FROM canvases WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 500').bind(workspaceId).all<CanvasRow>();
	return results;
}

export async function insertCanvas(db: D1Database, input: { workspaceId: string; channelId: string | null; title: string; createdBy: string }): Promise<CanvasRow> {
	const now = Date.now();
	const row: CanvasRow = {
		id: crypto.randomUUID(),
		workspace_id: input.workspaceId,
		channel_id: input.channelId,
		title: input.title,
		excerpt: '',
		editors: '[]',
		created_by: input.createdBy,
		created_at: now,
		updated_at: now,
	};
	await db
		.prepare('INSERT INTO canvases (id, workspace_id, channel_id, title, excerpt, editors, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(row.id, row.workspace_id, row.channel_id, row.title, row.excerpt, row.editors, row.created_by, row.created_at, row.updated_at)
		.run();
	return row;
}

// Appelé par le DO après une rafale d'éditions.
export async function updateCanvasContent(db: D1Database, id: string, input: { title: string | null; excerpt: string; editors: string[] }): Promise<void> {
	const row = await db.prepare('SELECT editors FROM canvases WHERE id = ?').bind(id).first<{ editors: string }>();
	if (!row) {
		return;
	}
	const editors = [...new Set([...input.editors, ...parseEditors(row.editors)])].slice(0, CANVAS_LIMITS.editors);
	const title = input.title === null ? null : cleanTitle(input.title) || 'Sans titre';
	await db
		.prepare('UPDATE canvases SET title = COALESCE(?, title), excerpt = ?, editors = ?, updated_at = ? WHERE id = ?')
		.bind(title, input.excerpt.slice(0, CANVAS_LIMITS.excerpt), JSON.stringify(editors), Date.now(), id)
		.run();
}

export const deleteCanvasRow = (db: D1Database, id: string) => db.prepare('DELETE FROM canvases WHERE id = ?').bind(id).run();
