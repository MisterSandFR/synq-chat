import type { MiddlewareHandler } from 'hono';

import type { AuditEntry, AuditKind, AuditPage } from '../shared/audit';
import { stub, type AppEnv } from './http';

type Rule = { method: string; re: RegExp; action: string; kind: AuditKind };

const rule = (method: string, re: RegExp, action: string, kind: AuditKind): Rule => ({ method, re, action, kind });

// Chemins relatifs à /api/w/:wid ; le premier groupe capturé est la cible.
const RULES: Rule[] = [
	rule('PATCH', /^\/info$/, 'workspace.update', 'workspace'),
	rule('POST', /^\/logo$/, 'workspace.update', 'workspace'),
	rule('DELETE', /^\/logo$/, 'workspace.update', 'workspace'),
	rule('PUT', /^\/layout$/, 'layout.update', 'workspace'),
	rule('POST', /^\/invites$/, 'invite.create', 'invite'),
	rule('DELETE', /^\/members\/([^/]+)$/, 'member.kick', 'member'),
	rule('PUT', /^\/members\/([^/]+)\/grades$/, 'member.grades', 'member'),
	rule('POST', /^\/grades$/, 'grade.create', 'grade'),
	rule('PUT', /^\/grades\/order$/, 'grade.reorder', 'grade'),
	rule('PATCH', /^\/grades\/([^/]+)$/, 'grade.update', 'grade'),
	rule('DELETE', /^\/grades\/([^/]+)$/, 'grade.delete', 'grade'),
	rule('POST', /^\/channels$/, 'channel.create', 'channel'),
	rule('PATCH', /^\/channels\/([^/]+)$/, 'channel.update', 'channel'),
	rule('DELETE', /^\/channels\/([^/]+)$/, 'channel.delete', 'channel'),
	rule('PUT', /^\/channels\/([^/]+)\/overrides$/, 'channel.permissions', 'channel'),
	rule('POST', /^\/channels\/([^/]+)\/sync$/, 'channel.sync', 'channel'),
	rule('PUT', /^\/channels\/([^/]+)\/announcement$/, 'channel.announcement', 'channel'),
	rule('POST', /^\/categories$/, 'category.create', 'category'),
	rule('PATCH', /^\/categories\/([^/]+)$/, 'category.update', 'category'),
	rule('DELETE', /^\/categories\/([^/]+)$/, 'category.delete', 'category'),
	rule('PUT', /^\/categories\/([^/]+)\/overrides$/, 'category.permissions', 'category'),
	rule('POST', /^\/commands$/, 'command.create', 'command'),
	rule('PATCH', /^\/commands\/([^/]+)$/, 'command.update', 'command'),
	rule('DELETE', /^\/commands\/([^/]+)$/, 'command.delete', 'command'),
	rule('POST', /^\/channels\/([^/]+)\/webhooks$/, 'webhook.create', 'channel'),
	rule('POST', /^\/webhooks\/([^/]+)\/rotate$/, 'webhook.rotate', 'webhook'),
	rule('DELETE', /^\/webhooks\/([^/]+)$/, 'webhook.delete', 'webhook'),
	rule('POST', /^\/voice\/move$/, 'voice.move', 'voice'),
	rule('POST', /^\/voice\/moderate$/, 'voice.moderate', 'voice'),
	rule('POST', /^\/dms\/([^/]+)\/guests$/, 'guest.invite', 'guest'),
	rule('DELETE', /^\/dms\/[^/]+\/guests\/([^/]+)$/, 'guest.revoke', 'guest'),
];

export type AuditInput = Omit<AuditEntry, 'id' | 'at'>;

const str = (value: unknown) => (typeof value === 'string' && value ? value.slice(0, 120) : null);

// Après la route : seules les actions réussies sont journalisées.
export const auditTrail: MiddlewareHandler<AppEnv> = async (c, next) => {
	await next();
	if (c.req.method === 'GET' || c.res.status >= 300) {
		return;
	}
	const path = c.req.path.replace(/^\/api\/w\/[^/]+/, '');
	const found = RULES.find((r) => r.method === c.req.method && r.re.test(path));
	if (!found) {
		return;
	}
	// Corps déjà lu par la route : Hono le garde en cache.
	const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
	const reply = (await c.res.clone().json().catch(() => null)) as Record<string, unknown> | null;
	const targetId = found.re.exec(path)?.[1] ?? str(body?.userId) ?? str(reply?.id);
	const keys = body ? Object.keys(body).filter((key) => !/secret|password|token/i.test(key)) : [];
	const detail = found.kind === 'voice' ? str(body?.action) ?? (body?.channelId ? 'move' : null) : keys.length && c.req.method !== 'POST' ? keys.join(', ').slice(0, 200) : null;
	const actor = c.get('actor');
	try {
		await stub(c).recordAudit({
			actorId: actor.id,
			actorName: actor.name,
			action: found.action,
			kind: found.kind,
			targetId,
			targetName: str(reply?.name) ?? str(body?.name) ?? str(reply?.email) ?? null,
			detail,
		});
	} catch (error) {
		console.error(JSON.stringify({ level: 'error', message: 'audit', error: String(error) }));
	}
};

const KEEP = 5000;

export function insertAudit(sql: SqlStorage, entry: AuditInput): void {
	sql.exec(
		'INSERT INTO audit (at, actor_id, actor_name, action, kind, target_id, target_name, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		Date.now(),
		entry.actorId,
		entry.actorName,
		entry.action,
		entry.kind,
		entry.targetId,
		entry.targetName,
		entry.detail,
	);
	sql.exec('DELETE FROM audit WHERE id <= (SELECT id FROM audit ORDER BY id DESC LIMIT 1 OFFSET ?)', KEEP);
}

type AuditRow = { id: number; at: number; actor_id: string; actor_name: string; action: string; kind: AuditKind; target_id: string | null; target_name: string | null; detail: string | null };

export function readAudit(sql: SqlStorage, kind: AuditKind | null, before: number | null, limit = 50): AuditPage {
	const rows = sql
		.exec<AuditRow>('SELECT * FROM audit WHERE (?1 IS NULL OR kind = ?1) AND (?2 IS NULL OR id < ?2) ORDER BY id DESC LIMIT ?3', kind, before, limit + 1)
		.toArray();
	const items = rows.slice(0, limit).map((r) => ({
		id: r.id,
		at: r.at,
		actorId: r.actor_id,
		actorName: r.actor_name,
		action: r.action,
		kind: r.kind,
		targetId: r.target_id,
		targetName: r.target_name,
		detail: r.detail,
	}));
	return { items, next: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
}

export const AUDIT_MIGRATION = `CREATE TABLE audit (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	at INTEGER NOT NULL,
	actor_id TEXT NOT NULL,
	actor_name TEXT NOT NULL,
	action TEXT NOT NULL,
	kind TEXT NOT NULL,
	target_id TEXT,
	target_name TEXT,
	detail TEXT
);
CREATE INDEX audit_kind ON audit (kind, id);`;
