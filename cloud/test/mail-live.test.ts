import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { UserEvent } from '../shared/user-events';
import { mailChanged } from '../worker/routes/mail';
import { wakeSnoozed } from '../worker/mail/store';
import { BASE, signup, workspaceWithMember, type Client } from './helpers';

const workerEnv = env as unknown as Env;

async function personal(client: Client) {
	const res = await exports.default.fetch(new Request(`${BASE}/api/me/ws`, { headers: { Upgrade: 'websocket', cookie: client.cookie } }));
	const ws = res.webSocket!;
	ws.accept();
	const queue: UserEvent[] = [];
	ws.addEventListener('message', (event) => queue.push(JSON.parse(event.data as string) as UserEvent));
	const count = async (n: number) => {
		for (let i = 0; i < 40 && queue.length < n; i++) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		return queue.length;
	};
	return { ws, queue, count };
}

async function sharedBox() {
	const { owner: alice, member: bob, wid } = await workspaceWithMember();
	const box = crypto.randomUUID();
	await env.DB.prepare(
		"INSERT INTO mailboxes (id, owner_id, name, address, imap_host, smtp_host, username, secret, created_at) VALUES (?, ?, 'Support', 'support@exemple.fr', 'mail.exemple.fr', 'mail.exemple.fr', 'support', 'x', ?)",
	)
		.bind(box, alice.user.id, Date.now())
		.run();
	expect((await alice.req('PUT', `/api/mail/boxes/${box}/shares/${wid}`, { channelIds: [], grades: [{ gradeId: 'default', level: 'view' }] })).status).toBe(200);
	const thread = crypto.randomUUID();
	await env.DB.prepare("INSERT INTO mail_threads (id, mailbox_id, subject, last_at, created_at) VALUES (?, ?, 'Facture', ?, ?)").bind(thread, box, Date.now(), Date.now()).run();
	return { alice, bob, wid, box, thread };
}

describe('mail en direct', () => {
	it('prévient les lecteurs de la boîte, pas les autres', async () => {
		const { alice, bob, box, thread } = await sharedBox();
		const outsider = await signup('Dave');
		const bobLive = await personal(bob);
		const daveLive = await personal(outsider);
		// Nouveaux mails relevés : même appel que la relève de la boîte.
		await mailChanged(workerEnv, [box]);
		expect(await bobLive.count(1)).toBe(1);
		expect(bobLive.queue[0]).toEqual({ t: 'mail' });
		// Action d'un collègue sur un fil.
		expect((await alice.req('PATCH', `/api/mail/threads/${thread}`, { status: 'done' })).status).toBe(200);
		expect(await bobLive.count(2)).toBe(2);
		// Lecture : rien.
		await alice.req('POST', `/api/mail/threads/${thread}/read`);
		expect(await bobLive.count(3)).toBe(2);
		expect(await daveLive.count(1)).toBe(0);
		bobLive.ws.close();
		daveLive.ws.close();
	});

	it('renvoie les boîtes des fils sortis de veille', async () => {
		const { box, thread } = await sharedBox();
		await env.DB.prepare('UPDATE mail_threads SET snoozed_until = ? WHERE id = ?').bind(Date.now() - 1000, thread).run();
		expect(await wakeSnoozed(workerEnv, Date.now())).toEqual([box]);
	});
});
