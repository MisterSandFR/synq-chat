import { levelRank, maxLevel, type AccessKind, type AccessLevel } from '../shared/access';
import { CHANNEL_PAGE_DEFAULT } from '../shared/canvas';
import { memberKey } from '../shared/categories';
import type { ResourceKind } from '../shared/channel-resources';
import { DEFAULT_GRADE } from '../shared/permissions';
import type { Actor } from '../shared/types';
import { isAdmin, ruleLevel, type RuleRow } from './access';
import { loadActors } from './grades';
import { workspaceStub } from './http';

export type ChannelSeen = { view: boolean; send: boolean; room: boolean };
// `memberIds` : participants d'une conversation privée ou de groupe.
export type ChannelAudience = { name: string; memberIds?: string[]; grants: ChannelSeen[] } | null;

type Legacy = { kind: ResourceKind; id: string; channel_id: string; created_by: string; restricted: number; title: string };
type TreeRow = { kind: ResourceKind; id: string; parent_id: string | null; channel_id: string | null; created_by: string };

const ACCESS_KIND: Record<ResourceKind, AccessKind> = { page: 'page', list: 'base' };
const TABLE: Record<ResourceKind, string> = { page: 'canvases', list: 'lists' };

const lowest = (levels: AccessLevel[]) => levels.reduce<AccessLevel | null>((low, l) => (low === null || levelRank(l) < levelRank(low) ? l : low), null);

// Niveau d'avant par acteur, en règles : grade si tous ses titulaires y ont droit, sinon personne.
export function audienceRules(actors: Actor[], levelOf: (actor: Actor) => AccessLevel | null): { restricted: boolean; rules: Map<string, AccessLevel> } {
	const people = actors.filter((actor) => !isAdmin(actor));
	const members = people.filter((actor) => !actor.guest);
	const levels = new Map(people.map((actor) => [actor.id, levelOf(actor)]));
	const rules = new Map<string, AccessLevel>();
	const everyone = members.length > 0 && members.every((actor) => levels.get(actor.id));
	if (everyone) {
		rules.set(DEFAULT_GRADE, lowest(members.map((actor) => levels.get(actor.id)!))!);
	}
	for (const grade of new Set(members.flatMap((actor) => actor.grades).filter((g) => g !== DEFAULT_GRADE))) {
		const holders = members.filter((actor) => actor.grades.includes(grade));
		if (holders.every((actor) => levels.get(actor.id))) {
			const low = lowest(holders.map((actor) => levels.get(actor.id)!));
			if (low && levelRank(low) > levelRank(rules.get(DEFAULT_GRADE))) {
				rules.set(grade, low);
			}
		}
	}
	for (const actor of people) {
		const level = levels.get(actor.id) ?? null;
		const covered = actor.guest ? null : actor.grades.reduce<AccessLevel | null>((best, g) => maxLevel(best, rules.get(g) ?? null), null);
		if (level && levelRank(level) > levelRank(covered)) {
			rules.set(memberKey(actor.id), level);
		}
	}
	// Salon ouvert à tous : la ressource hérite simplement de l'espace.
	if (everyone && rules.size === 1 && rules.get(DEFAULT_GRADE) === 'edit') {
		rules.clear();
	}
	return { restricted: !everyone, rules };
}

const joinNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}` : (names[0] ?? ''));

// Titre par défaut : nom du salon, du groupe, sinon les autres participants de la conversation.
export function defaultTitle(channel: NonNullable<ChannelAudience>, creatorId: string, actors: Actor[]): string {
	if (!channel.memberIds || channel.name) {
		return channel.name;
	}
	const names = channel.memberIds
		.filter((id) => id !== creatorId)
		.flatMap((id) => actors.find((a) => a.id === id)?.name ?? [])
		.sort((a, b) => a.localeCompare(b, 'fr'));
	return names.length === 1 ? `Conversation avec ${names[0]}` : names.length ? joinNames(names) : 'Conversation';
}

// Droit tiré de l'ancien salon : voir, ou modifier si l'on pouvait écrire.
function channelLevel(kind: ResourceKind, actor: Actor, seen: ChannelSeen | undefined): AccessLevel | null {
	if (!seen?.view || (kind === 'list' && !seen.room)) {
		return null;
	}
	return seen.send && !(kind === 'list' && actor.guest) ? 'edit' : 'view';
}

// Anciens rattachements de salon → ressources d'espace à visibilité identique, puis liens de salon.
export async function decoupleWorkspace(env: Env, workspaceId: string): Promise<number> {
	const db = env.DB;
	const [pages, lists, tree, ruleRows, top] = await db.batch([
		db.prepare("SELECT 'page' AS kind, id, channel_id, created_by, restricted, title FROM canvases WHERE workspace_id = ? AND channel_id IS NOT NULL ORDER BY created_at").bind(workspaceId),
		db.prepare("SELECT 'list' AS kind, id, channel_id, created_by, restricted, title FROM lists WHERE workspace_id = ? AND channel_id IS NOT NULL ORDER BY created_at").bind(workspaceId),
		db.prepare("SELECT 'page' AS kind, id, parent_id, channel_id, created_by FROM canvases WHERE workspace_id = ?1 UNION ALL SELECT 'list', id, parent_id, channel_id, created_by FROM lists WHERE workspace_id = ?1").bind(workspaceId),
		db.prepare('SELECT resource_kind, resource_id, subject_id, level FROM access_rules WHERE workspace_id = ?').bind(workspaceId),
		db.prepare(
			'SELECT MIN(p) AS p FROM (SELECT position AS p FROM canvases WHERE workspace_id = ?1 AND parent_id IS NULL AND category_id IS NULL AND channel_id IS NULL UNION ALL SELECT position FROM lists WHERE workspace_id = ?1 AND parent_id IS NULL AND category_id IS NULL AND channel_id IS NULL)',
		).bind(workspaceId),
	]);
	const legacy = [...(pages!.results as Legacy[]), ...(lists!.results as Legacy[])];
	const mark = db.prepare('UPDATE workspaces SET decoupled_at = ? WHERE id = ? AND decoupled_at IS NULL').bind(Date.now(), workspaceId);
	if (!legacy.length) {
		await mark.run();
		return 0;
	}
	const actors = await loadActors(db, workspaceId);
	const channelIds = [...new Set(legacy.map((row) => row.channel_id))];
	const audience = await workspaceStub(env, workspaceId).channelAudience(actors, channelIds);
	const byChannel = new Map(channelIds.map((id, i) => [id, audience[i] ?? null]));
	const rulesOf = new Map<string, RuleRow[]>();
	for (const row of ruleRows!.results as RuleRow[]) {
		const k = `${row.resource_kind}:${row.resource_id}`;
		rulesOf.set(k, [...(rulesOf.get(k) ?? []), row]);
	}
	const owner = actors.find((actor) => actor.owner)?.id ?? null;
	const index = new Map(actors.map((actor, i) => [actor.id, i]));
	const sees = (channelId: string, userId: string) => {
		const i = index.get(userId);
		return i !== undefined && Boolean(byChannel.get(channelId)?.grants[i]?.view);
	};
	const statements: D1PreparedStatement[] = [];
	// Créateur qui ne voyait pas le salon : le passe-droit de créateur revient au propriétaire.
	const nodes = tree!.results as TreeRow[];
	const pageById = new Map(nodes.filter((n) => n.kind === 'page').map((n) => [n.id, n]));
	for (const node of nodes) {
		let current: TreeRow | undefined = node;
		for (let depth = 0; current && !current.channel_id && depth < 32; depth++) {
			current = current.parent_id ? pageById.get(current.parent_id) : undefined;
		}
		const creator = actors.find((actor) => actor.id === node.created_by);
		if (current?.channel_id && owner && !(creator && isAdmin(creator)) && !sees(current.channel_id, node.created_by)) {
			statements.push(db.prepare(`UPDATE ${TABLE[node.kind]} SET created_by = ? WHERE id = ?`).bind(owner, node.id));
		}
	}
	const start = ((top!.results[0] as { p: number | null } | undefined)?.p ?? 0) - legacy.length - 1;
	const renamed: Array<{ id: string; title: string }> = [];
	legacy.forEach((row, i) => {
		const channel = byChannel.get(row.channel_id) ?? null;
		const kind = ACCESS_KIND[row.kind];
		const existing = rulesOf.get(`${kind}:${row.id}`) ?? [];
		if (!row.restricted) {
			const { restricted, rules } = audienceRules(actors, (actor) =>
				maxLevel(channelLevel(row.kind, actor, channel?.grants[index.get(actor.id)!]), ruleLevel(actor, existing, false)),
			);
			statements.push(db.prepare('DELETE FROM access_rules WHERE resource_kind = ? AND resource_id = ?').bind(kind, row.id));
			for (const [subject, level] of rules) {
				statements.push(
					db.prepare('INSERT INTO access_rules (workspace_id, resource_kind, resource_id, subject_id, level) VALUES (?, ?, ?, ?, ?)').bind(workspaceId, kind, row.id, subject, level),
				);
			}
			statements.push(db.prepare(`UPDATE ${TABLE[row.kind]} SET restricted = ? WHERE id = ?`).bind(restricted ? 1 : 0, row.id));
		}
		const blank = !row.title || row.title === CHANNEL_PAGE_DEFAULT || row.title === 'Sans titre';
		const title = (row.kind === 'page' && blank && channel ? defaultTitle(channel, row.created_by, actors) : '') || row.title;
		if (title !== row.title) {
			renamed.push({ id: row.id, title });
		}
		statements.push(
			db.prepare(`UPDATE ${TABLE[row.kind]} SET channel_id = NULL, title = ?, parent_id = NULL, category_id = NULL, position = ? WHERE id = ? AND channel_id = ?`).bind(title, start + i, row.id, row.channel_id),
		);
		if (channel) {
			statements.push(
				db
					.prepare('INSERT OR IGNORE INTO channel_resources (workspace_id, channel_id, kind, ref_id, position, added_by) VALUES (?, ?, ?, ?, ?, ?)')
					.bind(workspaceId, row.channel_id, row.kind, row.id, i, row.created_by),
			);
		}
	});
	await db.batch([...statements, mark]);
	await Promise.all(renamed.map((page) => env.CANVAS_DOC.getByName(page.id).setTitle(page.id, page.title).catch(() => undefined)));
	return legacy.length;
}

const decoupled = new Set<string>();

// Premier accès à l'espace : la reprise passe avant toute lecture de droits.
export async function ensureDecoupled(env: Env, workspaceId: string): Promise<void> {
	if (decoupled.has(workspaceId)) {
		return;
	}
	const row = await env.DB.prepare('SELECT decoupled_at FROM workspaces WHERE id = ?').bind(workspaceId).first<{ decoupled_at: number | null }>();
	if (row && row.decoupled_at === null) {
		await decoupleWorkspace(env, workspaceId);
	}
	decoupled.add(workspaceId);
}

// Cron : reprend quelques espaces pas encore ouverts depuis la mise en production.
export async function decouplePending(env: Env, limit = 5): Promise<void> {
	const { results } = await env.DB.prepare('SELECT id FROM workspaces WHERE decoupled_at IS NULL LIMIT ?').bind(limit).all<{ id: string }>();
	for (const { id } of results) {
		await decoupleWorkspace(env, id).catch(() => undefined);
	}
}
