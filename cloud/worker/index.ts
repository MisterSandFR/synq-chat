import app from './app';
import { sendReminders } from './calendar';

export { Workspace } from './workspace';

const HASHED = /^\/assets\//;

export default {
	async fetch(request, env, ctx) {
		if (HASHED.test(new URL(request.url).pathname)) {
			const res = await env.ASSETS.fetch(request);
			// Fichier absent (déploiement en cours) : jamais la page SPA sous une URL de JS, sinon le cache la garde.
			if (!res.ok || res.headers.get('content-type')?.includes('text/html')) {
				return new Response('Introuvable', { status: 404, headers: { 'Cache-Control': 'no-store' } });
			}
			const headers = new Headers(res.headers);
			headers.set('Cache-Control', 'public, max-age=31536000, immutable');
			return new Response(res.body, { status: res.status, headers });
		}
		return app.fetch(request, env, ctx);
	},
	async scheduled(_controller, env, ctx) {
		ctx.waitUntil(sendReminders(env, Date.now()));
	},
} satisfies ExportedHandler<Env>;
