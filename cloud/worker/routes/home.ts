import { Hono } from 'hono';

import type { SpaceSummary } from '../../shared/home';
import { stub, type AppEnv } from '../http';

export const homeRoutes = new Hono<AppEnv>();

// Accueil : compteurs sans ouvrir de websocket par espace.
homeRoutes.get('/w/:wid/summary', async (c) => {
	const actor = c.get('actor');
	const [counts, members] = await Promise.all([
		stub(c).homeSummary(actor),
		actor.guest ? null : c.env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND role != 'guest'").bind(c.get('workspaceId')).first<{ n: number }>(),
	]);
	return c.json({ members: members?.n ?? null, unread: counts.unread, mentions: counts.mentions } satisfies SpaceSummary);
});
