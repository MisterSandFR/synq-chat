import type { Context } from 'hono';

import { has } from '../shared/permissions';
import { LIMITS, type Actor, type User } from '../shared/types';
import type { Result } from './result';

export type AppEnv = {
	Bindings: Env;
	Variables: { user: User; actor: Actor; workspaceId: string };
};

export type Ctx = Context<AppEnv>;

export const fail = (c: Ctx, status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 503, error: string) => c.json({ error }, status);

export const unwrap = <T>(c: Ctx, result: Result<T>) => (result.ok ? c.json(result.value) : fail(c, result.status, result.error));

export const cleanName = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, LIMITS.nameLength) : '');

export const workspaceStub = (env: Env, id: string) => env.WORKSPACE.getByName(id);

// Valide seulement après le middleware `/w/:wid/*`.
export const stub = (c: Ctx) => workspaceStub(c.env, c.get('workspaceId'));

export const denyUnless = (c: Ctx, flag: number) => (has(c.get('actor').perms, flag) ? null : fail(c, 403, 'Permission insuffisante'));

export async function readJson<T>(c: Ctx): Promise<Partial<T>> {
	try {
		const body = await c.req.json<T>();
		return body && typeof body === 'object' ? body : {};
	} catch {
		return {};
	}
}
