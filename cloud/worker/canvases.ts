import { atLeast, type AccessLevel } from '../shared/access';
import { CANVAS_LIMITS, type CanvasAccess, type CanvasMeta, type PageComment, type PageRef } from '../shared/canvas';

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
	parent_id: string | null;
	icon: string | null;
	cover_key: string | null;
	position: number;
	archived_at: number | null;
	category_id?: string | null;
	restricted?: number;
};

const parseEditors = (raw: string): string[] => {
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
	} catch {
		return [];
	}
};

export const coverOf = (row: CanvasRow) =>
	!row.cover_key ? null : row.cover_key.startsWith('gradient:') ? row.cover_key : `/api/w/${row.workspace_id}/canvases/${row.id}/files/${row.cover_key}`;

// `write` / `read` : documents d'éléments de base, sans règles propres.
const levelOf = (given: AccessLevel | CanvasAccess): AccessLevel => (given === 'write' ? 'edit' : given === 'read' ? 'view' : given);

export const toMeta = (row: CanvasRow, given: AccessLevel | CanvasAccess): CanvasMeta => ({
	id: row.id,
	workspaceId: row.workspace_id,
	channelId: row.channel_id,
	title: row.title,
	excerpt: row.excerpt,
	editors: parseEditors(row.editors),
	createdBy: row.created_by,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	access: atLeast(levelOf(given), 'edit') ? 'write' : 'read',
	level: levelOf(given),
	categoryId: row.category_id ?? null,
	restricted: Boolean(row.restricted),
	parentId: row.parent_id,
	icon: row.icon,
	cover: coverOf(row),
	position: row.position,
	archivedAt: row.archived_at,
});

export const toRef = (row: CanvasRow): PageRef => ({ id: row.id, title: row.title, icon: row.icon });

export const cleanTitle = (raw: unknown) => (typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, CANVAS_LIMITS.title) : '');

export const canvasRow = (db: D1Database, workspaceId: string, id: string) =>
	db.prepare('SELECT * FROM canvases WHERE id = ? AND workspace_id = ?').bind(id, workspaceId).first<CanvasRow>();

export const channelCanvasRow = (db: D1Database, workspaceId: string, channelId: string) =>
	db.prepare('SELECT * FROM canvases WHERE workspace_id = ? AND channel_id = ?').bind(workspaceId, channelId).first<CanvasRow>();

export async function listCanvasRows(db: D1Database, workspaceId: string): Promise<CanvasRow[]> {
	const { results } = await db.prepare('SELECT * FROM canvases WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?').bind(workspaceId, CANVAS_LIMITS.pages).all<CanvasRow>();
	return results;
}

// Une sous-page hérite des droits de sa racine : salon de la racine, ou espace.
export function scopeOf(row: CanvasRow, byId: Map<string, CanvasRow>): string | null {
	let current = row;
	for (let depth = 0; current.parent_id && depth < CANVAS_LIMITS.depth; depth++) {
		const parent = byId.get(current.parent_id);
		if (!parent) {
			break;
		}
		current = parent;
	}
	return current.channel_id;
}

// Ancêtres du plus proche au plus lointain.
export async function ancestorRows(db: D1Database, workspaceId: string, id: string): Promise<CanvasRow[]> {
	const { results } = await db
		.prepare(
			`WITH RECURSIVE up(id, parent_id, depth) AS (
				SELECT id, parent_id, 0 FROM canvases WHERE id = ? AND workspace_id = ?
				UNION ALL SELECT c.id, c.parent_id, up.depth + 1 FROM canvases c JOIN up ON c.id = up.parent_id WHERE up.depth < ?
			) SELECT canvases.* FROM up JOIN canvases ON canvases.id = up.id WHERE up.depth > 0 ORDER BY up.depth`,
		)
		.bind(id, workspaceId, CANVAS_LIMITS.depth)
		.all<CanvasRow>();
	return results;
}

export async function descendantIds(db: D1Database, id: string): Promise<string[]> {
	const { results } = await db
		.prepare(
			`WITH RECURSIVE down(id, depth) AS (
				SELECT id, 0 FROM canvases WHERE id = ?
				UNION ALL SELECT c.id, down.depth + 1 FROM canvases c JOIN down ON c.parent_id = down.id WHERE down.depth < ?
			) SELECT id FROM down WHERE depth > 0`,
		)
		.bind(id, CANVAS_LIMITS.depth)
		.all<{ id: string }>();
	return results.map((r) => r.id);
}

export async function nextPosition(db: D1Database, workspaceId: string, parentId: string | null): Promise<number> {
	const row = await db
		.prepare('SELECT MAX(position) AS top FROM canvases WHERE workspace_id = ? AND parent_id IS ?')
		.bind(workspaceId, parentId)
		.first<{ top: number | null }>();
	return (row?.top ?? 0) + 1;
}

export async function insertCanvas(
	db: D1Database,
	input: { workspaceId: string; channelId: string | null; title: string; createdBy: string; parentId?: string | null; icon?: string | null; coverKey?: string | null },
): Promise<CanvasRow> {
	const now = Date.now();
	const parentId = input.parentId ?? null;
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
		parent_id: parentId,
		icon: input.icon ?? null,
		cover_key: input.coverKey ?? null,
		position: await nextPosition(db, input.workspaceId, parentId),
		archived_at: null,
	};
	await db
		.prepare('INSERT INTO canvases (id, workspace_id, channel_id, title, excerpt, editors, created_by, created_at, updated_at, parent_id, icon, cover_key, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
		.bind(row.id, row.workspace_id, row.channel_id, row.title, row.excerpt, row.editors, row.created_by, row.created_at, row.updated_at, row.parent_id, row.icon, row.cover_key, row.position)
		.run();
	return row;
}

export async function updatePageRow(db: D1Database, id: string, fields: Partial<Pick<CanvasRow, 'title' | 'icon' | 'cover_key' | 'parent_id' | 'position' | 'category_id'>>): Promise<void> {
	const keys = Object.keys(fields) as Array<keyof typeof fields>;
	if (!keys.length) {
		return;
	}
	await db
		.prepare(`UPDATE canvases SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
		.bind(...keys.map((k) => fields[k] ?? null), Date.now(), id)
		.run();
}

// L'archivage emporte les sous-pages ; la restauration ne ramène que celles archivées en même temps.
export async function archivePage(db: D1Database, id: string, at: number): Promise<void> {
	const ids = [id, ...(await descendantIds(db, id))];
	await db.batch(ids.map((pid) => db.prepare('UPDATE canvases SET archived_at = ? WHERE id = ? AND archived_at IS NULL').bind(at, pid)));
}

export async function restorePage(db: D1Database, row: CanvasRow): Promise<void> {
	const ids = await descendantIds(db, row.id);
	const parent = row.parent_id ? await db.prepare('SELECT archived_at FROM canvases WHERE id = ?').bind(row.parent_id).first<{ archived_at: number | null }>() : null;
	const detach = row.parent_id !== null && (!parent || parent.archived_at !== null);
	await db.batch([
		db.prepare(`UPDATE canvases SET archived_at = NULL${detach ? ', parent_id = NULL' : ''} WHERE id = ?`).bind(row.id),
		...ids.map((pid) => db.prepare('UPDATE canvases SET archived_at = NULL WHERE id = ? AND archived_at = ?').bind(pid, row.archived_at)),
	]);
}

// Appelé par le DO après une rafale d'éditions.
export async function updateCanvasContent(db: D1Database, id: string, input: { title: string | null; excerpt: string; editors: string[]; links?: string[] }): Promise<void> {
	const row = await db.prepare('SELECT editors, workspace_id FROM canvases WHERE id = ?').bind(id).first<{ editors: string; workspace_id: string }>();
	if (!row) {
		return;
	}
	const editors = [...new Set([...input.editors, ...parseEditors(row.editors)])].slice(0, CANVAS_LIMITS.editors);
	const title = input.title === null ? null : cleanTitle(input.title) || 'Sans titre';
	const statements = [
		db
			.prepare('UPDATE canvases SET title = COALESCE(?, title), excerpt = ?, editors = ?, updated_at = ? WHERE id = ?')
			.bind(title, input.excerpt.slice(0, CANVAS_LIMITS.excerpt), JSON.stringify(editors), Date.now(), id),
	];
	if (input.links) {
		statements.push(db.prepare('DELETE FROM canvas_links WHERE source_id = ?').bind(id));
		// Cibles filtrées sur l'espace : un identifiant collé d'ailleurs ne crée pas de lien.
		for (const target of [...new Set(input.links)].filter((t) => t !== id).slice(0, 200)) {
			statements.push(db.prepare('INSERT OR IGNORE INTO canvas_links (source_id, target_id) SELECT ?, id FROM canvases WHERE id = ? AND workspace_id = ?').bind(id, target, row.workspace_id));
		}
	}
	await db.batch(statements);
}

export async function backlinkIds(db: D1Database, id: string): Promise<string[]> {
	const { results } = await db.prepare('SELECT source_id FROM canvas_links WHERE target_id = ?').bind(id).all<{ source_id: string }>();
	return results.map((r) => r.source_id);
}

export const deleteCanvasRow = (db: D1Database, id: string) => db.prepare('DELETE FROM canvases WHERE id = ?').bind(id).run();

type CommentRow = { id: string; canvas_id: string; thread_id: string; quote: string; author_id: string; body: string; created_at: number; resolved_at: number | null };

const toComment = (row: CommentRow): PageComment => ({
	id: row.id,
	threadId: row.thread_id,
	quote: row.quote,
	authorId: row.author_id,
	body: row.body,
	createdAt: row.created_at,
	resolvedAt: row.resolved_at,
});

export async function listComments(db: D1Database, canvasId: string): Promise<PageComment[]> {
	const { results } = await db.prepare('SELECT * FROM canvas_comments WHERE canvas_id = ? ORDER BY created_at LIMIT 1000').bind(canvasId).all<CommentRow>();
	return results.map(toComment);
}

export const commentRow = (db: D1Database, canvasId: string, id: string) =>
	db.prepare('SELECT * FROM canvas_comments WHERE id = ? AND canvas_id = ?').bind(id, canvasId).first<CommentRow>();

export const threadExists = async (db: D1Database, canvasId: string, threadId: string) =>
	(await db.prepare('SELECT 1 AS ok FROM canvas_comments WHERE canvas_id = ? AND thread_id = ? LIMIT 1').bind(canvasId, threadId).first()) !== null;

export async function insertComment(db: D1Database, input: { canvasId: string; threadId: string; quote: string; authorId: string; body: string }): Promise<PageComment> {
	const row: CommentRow = { id: crypto.randomUUID(), canvas_id: input.canvasId, thread_id: input.threadId, quote: input.quote, author_id: input.authorId, body: input.body, created_at: Date.now(), resolved_at: null };
	await db
		.prepare('INSERT INTO canvas_comments (id, canvas_id, thread_id, quote, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
		.bind(row.id, row.canvas_id, row.thread_id, row.quote, row.author_id, row.body, row.created_at)
		.run();
	return toComment(row);
}

export const resolveThread = (db: D1Database, canvasId: string, threadId: string, resolved: boolean) =>
	db.prepare('UPDATE canvas_comments SET resolved_at = ? WHERE canvas_id = ? AND thread_id = ?').bind(resolved ? Date.now() : null, canvasId, threadId).run();

export const deleteComment = (db: D1Database, id: string) => db.prepare('DELETE FROM canvas_comments WHERE id = ?').bind(id).run();

export async function workspaceMemberIds(db: D1Database, workspaceId: string, ids: string[]): Promise<string[]> {
	if (!ids.length) {
		return [];
	}
	const { results } = await db
		.prepare(`SELECT user_id FROM members WHERE workspace_id = ? AND user_id IN (${ids.map(() => '?').join(', ')})`)
		.bind(workspaceId, ...ids)
		.all<{ user_id: string }>();
	return results.map((r) => r.user_id);
}
