import { Hono } from 'hono';

import { CUSTOM_EMOJI_LIMITS, CUSTOM_EMOJI_NAME_RE, CUSTOM_EMOJI_TYPES, type CustomEmoji } from '../../shared/emojis';
import { P } from '../../shared/permissions';
import { denyUnless, fail, readJson, stub, type AppEnv, type Ctx } from '../http';

export const emojiRoutes = new Hono<AppEnv>();

type EmojiRow = { name: string; object_key: string; animated: number; created_by: string; created_at: number };

const BAD_NAME = 'Nom de 2 à 32 caractères : minuscules, chiffres ou _';

const objectPath = (workspaceId: string, key: string) => `emojis/${workspaceId}/${key}`;

const toEmoji = (workspaceId: string, row: EmojiRow): CustomEmoji => ({
	name: row.name,
	url: `/api/emojis/${workspaceId}/${row.object_key}`,
	animated: row.animated === 1,
	createdBy: row.created_by,
	createdAt: row.created_at,
});

const findEmoji = (c: Ctx, name: string) =>
	c.env.DB.prepare('SELECT * FROM custom_emojis WHERE workspace_id = ? AND name = ?').bind(c.get('workspaceId'), name).first<EmojiRow>();

export const customEmojiExists = async (c: Ctx, name: string) => (await findEmoji(c, name)) !== null;

// D1 suit la cascade à la suppression de l'espace, R2 non.
export async function dropEmojis(c: Ctx, workspaceId: string): Promise<void> {
	let cursor: string | undefined;
	do {
		const page = await c.env.FILES.list({ prefix: `emojis/${workspaceId}/`, cursor });
		if (page.objects.length) {
			await c.env.FILES.delete(page.objects.map((o) => o.key));
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
}

emojiRoutes.get('/w/:wid/emojis', async (c) => {
	const workspaceId = c.get('workspaceId');
	const { results } = await c.env.DB.prepare('SELECT * FROM custom_emojis WHERE workspace_id = ? ORDER BY name').bind(workspaceId).all<EmojiRow>();
	return c.json(results.map((row) => toEmoji(workspaceId, row)));
});

// Même flux que le logo : corps brut vers R2, nom dans l'en-tête.
emojiRoutes.post('/w/:wid/emojis', async (c) => {
	const denied = denyUnless(c, P.MANAGE_EMOJIS);
	if (denied) {
		return denied;
	}
	const name = c.req.header('X-Emoji-Name')?.trim() ?? '';
	const type = c.req.header('Content-Type')?.split(';')[0]?.trim() ?? '';
	const size = Number(c.req.header('Content-Length'));
	if (!CUSTOM_EMOJI_NAME_RE.test(name)) {
		return fail(c, 400, BAD_NAME);
	}
	if (!CUSTOM_EMOJI_TYPES.includes(type)) {
		return fail(c, 400, 'Image PNG, GIF, WebP ou JPEG attendue');
	}
	if (!Number.isInteger(size) || size <= 0 || !c.req.raw.body) {
		return fail(c, 400, 'Fichier vide ou taille inconnue');
	}
	if (size > CUSTOM_EMOJI_LIMITS.size) {
		return fail(c, 413, 'Image trop lourde (256 Ko max)');
	}
	const workspaceId = c.get('workspaceId');
	const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM custom_emojis WHERE workspace_id = ?').bind(workspaceId).first<{ n: number }>();
	if ((count?.n ?? 0) >= CUSTOM_EMOJI_LIMITS.count) {
		return fail(c, 400, `${CUSTOM_EMOJI_LIMITS.count} emojis par espace au maximum`);
	}
	if (await findEmoji(c, name)) {
		return fail(c, 409, `:${name}: existe déjà`);
	}
	const key = crypto.randomUUID();
	const stream = new FixedLengthStream(size);
	await Promise.all([c.env.FILES.put(objectPath(workspaceId, key), stream.readable, { httpMetadata: { contentType: type } }), c.req.raw.body.pipeTo(stream.writable)]);
	const row: EmojiRow = { name, object_key: key, animated: type === 'image/gif' ? 1 : 0, created_by: c.get('actor').id, created_at: Date.now() };
	// Deux envois simultanés du même nom : la clé primaire tranche.
	const inserted = await c.env.DB.prepare('INSERT OR IGNORE INTO custom_emojis (workspace_id, name, object_key, animated, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(workspaceId, row.name, row.object_key, row.animated, row.created_by, row.created_at)
		.run();
	if (!inserted.meta.changes) {
		await c.env.FILES.delete(objectPath(workspaceId, key));
		return fail(c, 409, `:${name}: existe déjà`);
	}
	await stub(c).emojisChanged();
	return c.json(toEmoji(workspaceId, row), 201);
});

emojiRoutes.patch('/w/:wid/emojis/:name', async (c) => {
	const denied = denyUnless(c, P.MANAGE_EMOJIS);
	if (denied) {
		return denied;
	}
	const body = await readJson<{ name: string }>(c);
	const next = typeof body.name === 'string' ? body.name.trim() : '';
	if (!CUSTOM_EMOJI_NAME_RE.test(next)) {
		return fail(c, 400, BAD_NAME);
	}
	const current = await findEmoji(c, c.req.param('name'));
	if (!current) {
		return fail(c, 404, 'Emoji introuvable');
	}
	const workspaceId = c.get('workspaceId');
	if (next !== current.name) {
		const renamed = await c.env.DB.prepare('UPDATE OR IGNORE custom_emojis SET name = ? WHERE workspace_id = ? AND name = ?').bind(next, workspaceId, current.name).run();
		if (!renamed.meta.changes) {
			return fail(c, 409, `:${next}: existe déjà`);
		}
		await stub(c).emojisChanged();
	}
	return c.json(toEmoji(workspaceId, { ...current, name: next }));
});

emojiRoutes.delete('/w/:wid/emojis/:name', async (c) => {
	const denied = denyUnless(c, P.MANAGE_EMOJIS);
	if (denied) {
		return denied;
	}
	const current = await findEmoji(c, c.req.param('name'));
	if (!current) {
		return fail(c, 404, 'Emoji introuvable');
	}
	const workspaceId = c.get('workspaceId');
	await c.env.DB.prepare('DELETE FROM custom_emojis WHERE workspace_id = ? AND name = ?').bind(workspaceId, current.name).run();
	await c.env.FILES.delete(objectPath(workspaceId, current.object_key));
	await stub(c).emojisChanged();
	return c.json({ name: current.name });
});

// Session seule, comme les logos ; la clé ne change pas au renommage.
emojiRoutes.get('/emojis/:wid/:key', async (c) => {
	const object = await c.env.FILES.get(objectPath(c.req.param('wid'), c.req.param('key')));
	if (!object) {
		return fail(c, 404, 'Emoji introuvable');
	}
	return new Response(object.body, {
		headers: {
			'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
			'Content-Length': String(object.size),
			'Content-Security-Policy': "default-src 'none'; sandbox",
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, max-age=31536000, immutable',
		},
	});
});
