import { DurableObject } from 'cloudflare:workers';

import { mailChanged } from '../routes/mail';
import { syncMailbox } from './store';
import { transport } from './wire';

const INTERVAL = 60_000;

// Une instance par boîte : relève IMAP par alarme, écriture en D1.
export class Mailbox extends DurableObject<Env> {
	private running: Promise<{ fetched: number } | null> | null = null;

	async start(id: string): Promise<void> {
		await this.ctx.storage.put('id', id);
		await this.ctx.storage.setAlarm(Date.now() + 1000);
	}

	async stop(): Promise<void> {
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
	}

	async syncNow(): Promise<{ fetched: number }> {
		return (await this.sync()) ?? { fetched: 0 };
	}

	async alarm(): Promise<void> {
		if (await this.sync()) {
			await this.ctx.storage.setAlarm(Date.now() + INTERVAL);
		} else {
			await this.stop();
		}
	}

	// Relève unique à la fois : alarme et relève manuelle partagent le même passage.
	private async sync(): Promise<{ fetched: number } | null> {
		const id = await this.ctx.storage.get<string>('id');
		if (!id) {
			return null;
		}
		this.running ??= syncMailbox(this.env, id, transport.open)
			.then(async (result) => {
				// Nouveaux mails : les lecteurs de la boîte relisent sans recharger.
				if (result?.fetched) {
					await mailChanged(this.env, [id]).catch(() => undefined);
				}
				return result;
			})
			.finally(() => {
				this.running = null;
			});
		return this.running;
	}
}
