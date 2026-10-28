import { DurableObject } from 'cloudflare:workers';

import type { UserEvent } from '../shared/user-events';

// Un objet par utilisateur : relaie à ses onglets ce qui change hors d'un espace ouvert (calendrier).
export class UserHub extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	async fetch(): Promise<Response> {
		const pair = new WebSocketPair();
		this.ctx.acceptWebSocket(pair[1]);
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	notify(event: UserEvent): void {
		const payload = JSON.stringify(event);
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.send(payload);
			} catch {
				// Socket déjà fermé.
			}
		}
	}
}

// Échec d'un destinataire sans effet sur les autres ni sur l'action déjà faite.
export async function notifyUsers(env: Env, userIds: Iterable<string>, event: UserEvent): Promise<void> {
	await Promise.all([...new Set(userIds)].map((id) => env.USER_HUB.getByName(id).notify(event).catch(() => undefined)));
}
