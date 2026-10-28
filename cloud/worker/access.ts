import { atLeast, maxLevel, type AccessKind, type AccessLevel, type AccessRule, type AccessSource, type ChannelGrant } from '../shared/access';
import { CANVAS_LIMITS, type CanvasAccess } from '../shared/canvas';
import { memberKey } from '../shared/categories';
import { DEFAULT_GRADE, P, has } from '../shared/permissions';
import type { Actor } from '../shared/types';
import { listCanvasRows } from './canvases';
import { loadActors } from './grades';
import { workspaceStub } from './http';

type RuleRow = { resource_kind: AccessKind; resource_id: string; subject_id: string; level: AccessLevel };

export type CategoryRow = {
	id: string;
	workspace_id: string;
	name: string;
	icon: string | null;
	position: number;
	restricted: number;
	created_by: string;
	created_at: number;
};

// Champs d'accès communs aux lignes canvases, lists et page_categories.
export type Guarded = { id: string; channel_id: string | null; created_by: string; restricted?: number };
export type PageNode = Guarded & { parent_id: string | null; category_id?: string | null; title: string; archived_at?: number | null };

export type AccessData = {
	rules: Map<string, RuleRow[]>;
	categories: Map<string, CategoryRow>;
	grants: Map<string, Map<string, ChannelGrant>>;
};

const key = (kind: AccessKind, id: string) => `${kind}:${id}`;

export async function loadAccess(env: Env, workspaceId: string, actors: Actor[], channelIds: Array<string | null>): Promise<AccessData> {
	const [rules, categories] = await env.DB.batch([
		env.DB.prepare('SELECT resource_kind, resource_id, subject_id, level FROM access_rules WHERE workspace_id = ?').bind(workspaceId),
		env.DB.prepare('SELECT * FROM page_categories WHERE workspace_id = ? ORDER BY position').bind(workspaceId),
	]);
	const data: AccessData = { rules: new Map(), categories: new Map(), grants: new Map() };
	for (const row of rules!.results as RuleRow[]) {
		const k = key(row.resource_kind, row.resource_id);
		data.rules.set(k, [...(data.rules.get(k) ?? []), row]);
	}
	for (const row of categories!.results as CategoryRow[]) {
		data.categories.set(row.id, row);
	}
	const ids = [...new Set(channelIds.filter((id): id is string => !!id))];
	if (ids.length && actors.length) {
		const grants = await workspaceStub(env, workspaceId).accessChannels(actors, ids);
		actors.forEach((actor, i) => data.grants.set(actor.id, new Map(ids.map((id, j) => [id, grants[i]![j]!]))));
	}
	return data;
}

export const isAdmin = (actor: Actor) => !actor.guest && (actor.owner || has(actor.perms, P.ADMINISTRATOR));

// Sans aucune règle : comportement d'avant, tout membre non invité modifie.
export function spaceLevel(actor: Actor): AccessLevel | null {
	if (actor.guest) {
		return null;
	}
	return actor.owner || has(actor.perms, P.MANAGE_CHANNELS) ? 'manage' : 'edit';
}

function ruleLevel(actor: Actor, rules: RuleRow[], restricted: boolean): AccessLevel | null {
	const mine = new Set([memberKey(actor.id), ...(actor.guest ? [] : actor.grades)]);
	let best: AccessLevel | null = null;
	for (const rule of rules) {
		if (mine.has(rule.subject_id) && !(restricted && rule.subject_id === DEFAULT_GRADE)) {
			best = maxLevel(best, rule.level);
		}
	}
	return best;
}

const pageFromChannel = (grant: ChannelGrant | undefined): AccessLevel | null => (!grant?.view ? null : grant.manage ? 'manage' : grant.send ? 'edit' : 'comment');

const baseFromChannel = (grant: ChannelGrant | undefined, actor: Actor): AccessLevel | null =>
	!grant?.view || !grant.room ? null : grant.manage ? 'manage' : actor.guest ? 'view' : 'edit';

export const hasOwn = (kind: AccessKind, node: Guarded, data: AccessData) => Boolean(node.restricted) || (data.rules.get(key(kind, node.id))?.length ?? 0) > 0;

export const rulesOf = (kind: AccessKind, id: string, data: AccessData): AccessRule[] =>
	(data.rules.get(key(kind, id)) ?? []).map((row) => ({ subjectId: row.subject_id, level: row.level }));

function resolve(
	actor: Actor,
	kind: AccessKind,
	node: Guarded,
	data: AccessData,
	channel: (grant: ChannelGrant | undefined) => AccessLevel | null,
	inherit: () => AccessLevel | null,
	creatorOk = true,
): AccessLevel | null {
	if (isAdmin(actor)) {
		return 'manage';
	}
	const fromChannel = node.channel_id ? channel(data.grants.get(actor.id)?.get(node.channel_id)) : null;
	// Créateur qui ne voit plus le salon rattaché : plus de passe-droit.
	if (node.created_by === actor.id && !actor.guest && creatorOk && (!node.channel_id || fromChannel)) {
		return 'manage';
	}
	const rules = data.rules.get(key(kind, node.id)) ?? [];
	if (node.restricted) {
		return ruleLevel(actor, rules, true);
	}
	if (node.channel_id) {
		return maxLevel(fromChannel, ruleLevel(actor, rules, false));
	}
	return rules.length ? ruleLevel(actor, rules, false) : inherit();
}

export const categoryLevel = (actor: Actor, category: CategoryRow, data: AccessData) =>
	resolve(actor, 'page_category', { ...category, channel_id: null }, data, () => null, () => spaceLevel(actor));

// Ancêtre rattaché à un salon que l'acteur ne voit pas.
function channelBlocked(actor: Actor, page: PageNode, byId: Map<string, PageNode>, data: AccessData): boolean {
	let current: PageNode | undefined = page;
	for (let depth = 0; current && depth <= CANVAS_LIMITS.depth; depth++) {
		if (current.channel_id && !data.grants.get(actor.id)?.get(current.channel_id)?.view) {
			return true;
		}
		current = current.parent_id ? byId.get(current.parent_id) : undefined;
	}
	return false;
}

// Héritage : sous-page, page parente, catégorie de la racine, espace.
export function pageLevel(actor: Actor, page: PageNode, byId: Map<string, PageNode>, data: AccessData, depth = 0): AccessLevel | null {
	return resolve(actor, 'page', page, data, pageFromChannel, () => {
		const parent = page.parent_id ? byId.get(page.parent_id) : undefined;
		if (parent && depth < CANVAS_LIMITS.depth) {
			return pageLevel(actor, parent, byId, data, depth + 1);
		}
		const category = page.category_id ? data.categories.get(page.category_id) : undefined;
		return category ? categoryLevel(actor, category, data) : spaceLevel(actor);
	}, !channelBlocked(actor, page, byId, data));
}

export const baseLevel = (actor: Actor, base: Guarded, data: AccessData) =>
	resolve(actor, 'base', base, data, (grant) => baseFromChannel(grant, actor), () => spaceLevel(actor));

export const canvasAccessOf = (level: AccessLevel): CanvasAccess => (atLeast(level, 'edit') ? 'write' : 'read');

type Inherited = { source: AccessSource; rules: AccessRule[]; restricted: boolean };

// Source dont la ressource tient ses droits ; null si elle a des accès propres.
export function inheritedFrom(kind: AccessKind, node: Guarded, byId: Map<string, PageNode>, data: AccessData): Inherited | null {
	if (hasOwn(kind, node, data)) {
		return null;
	}
	if (node.channel_id) {
		return { source: { kind: 'channel', id: node.channel_id }, rules: [], restricted: false };
	}
	if (kind === 'page') {
		let current = node as PageNode;
		for (let depth = 0; depth < CANVAS_LIMITS.depth; depth++) {
			const parent = current.parent_id ? byId.get(current.parent_id) : undefined;
			if (!parent) {
				break;
			}
			if (hasOwn('page', parent, data)) {
				return { source: { kind: 'page', id: parent.id, title: parent.title }, rules: rulesOf('page', parent.id, data), restricted: Boolean(parent.restricted) };
			}
			if (parent.channel_id) {
				return { source: { kind: 'channel', id: parent.channel_id }, rules: [], restricted: false };
			}
			current = parent;
		}
		const category = current.category_id ? data.categories.get(current.category_id) : undefined;
		if (category && hasOwn('page_category', { ...category, channel_id: null }, data)) {
			return { source: { kind: 'page_category', id: category.id, title: category.name }, rules: rulesOf('page_category', category.id, data), restricted: Boolean(category.restricted) };
		}
	}
	return { source: { kind: 'space' }, rules: [], restricted: false };
}

// Pages visibles de l'acteur, avec leur niveau.
export async function pageAccess(env: Env, workspaceId: string, actor: Actor) {
	const rows = await listCanvasRows(env.DB, workspaceId);
	const byId = new Map(rows.map((row) => [row.id, row]));
	const data = await loadAccess(env, workspaceId, [actor], rows.map((row) => row.channel_id));
	const levels = new Map<string, AccessLevel>();
	for (const row of rows) {
		const level = pageLevel(actor, row, byId, data);
		if (level) {
			levels.set(row.id, level);
		}
	}
	return { rows, byId, levels, data };
}

export async function readableBases(env: Env, workspaceId: string, actor: Actor, bases: Guarded[]): Promise<Set<string>> {
	const data = await loadAccess(env, workspaceId, [actor], bases.map((base) => base.channel_id));
	return new Set(bases.filter((base) => baseLevel(actor, base, data)).map((base) => base.id));
}

// Membres parmi `userIds` qui voient la page (mentions).
export async function pageReaders(env: Env, workspaceId: string, page: PageNode, byId: Map<string, PageNode>, userIds: string[]): Promise<string[]> {
	const wanted = new Set(userIds);
	const actors = (await loadActors(env.DB, workspaceId)).filter((actor) => wanted.has(actor.id));
	const data = await loadAccess(env, workspaceId, actors, [...byId.values()].map((row) => row.channel_id));
	return actors.filter((actor) => pageLevel(actor, page, byId, data)).map((actor) => actor.id);
}

// Pages dont l'un des ancêtres (ou elles-mêmes) est dans `roots`.
export function subtreeIds(roots: Set<string>, byId: Map<string, PageNode>): string[] {
	return [...byId.values()]
		.filter((row) => {
			let current: PageNode | undefined = row;
			for (let depth = 0; current && depth <= CANVAS_LIMITS.depth; depth++) {
				if (roots.has(current.id)) {
					return true;
				}
				current = current.parent_id ? byId.get(current.parent_id) : undefined;
			}
			return false;
		})
		.map((row) => row.id);
}

// Révocation : chaque CanvasDoc ferme ou bascule en lecture les sockets selon les droits recalculés.
export async function reviseSockets(env: Env, workspaceId: string, pageIds: string[]): Promise<void> {
	if (!pageIds.length) {
		return;
	}
	const peers = await Promise.all(pageIds.map((id) => env.CANVAS_DOC.getByName(id).peerIds()));
	const wanted = new Set(peers.flat());
	if (!wanted.size) {
		return;
	}
	const rows = await listCanvasRows(env.DB, workspaceId);
	const byId = new Map<string, PageNode>(rows.map((row) => [row.id, row]));
	const actors = new Map((await loadActors(env.DB, workspaceId)).filter((actor) => wanted.has(actor.id)).map((actor) => [actor.id, actor]));
	const data = await loadAccess(env, workspaceId, [...actors.values()], rows.map((row) => row.channel_id));
	await Promise.all(
		pageIds.map(async (id, i) => {
			const page = byId.get(id);
			const users = peers[i]!;
			if (!users.length) {
				return;
			}
			const rights: Record<string, 'none' | 'read' | 'write'> = {};
			for (const userId of users) {
				const actor = actors.get(userId);
				const level = actor && page ? pageLevel(actor, page, byId, data) : null;
				rights[userId] = !level ? 'none' : atLeast(level, 'edit') && !page?.archived_at ? 'write' : 'read';
			}
			await env.CANVAS_DOC.getByName(id).revise(rights);
		}),
	);
}
