import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { NotificationPage } from '../shared/notifications';
import { parseReminder, reminderIdOf, type LaterItem, type Reminder } from '../shared/reminders';
import type { Message } from '../shared/types';
import { workspaceWithMember, type Client } from './helpers';

const post = (client: Client, wid: string, cid: string, body: string) => client.req<Message>('POST', `/api/w/${wid}/channels/${cid}/messages`, { body });

const remind = (client: Client, wid: string, input: { messageId?: number | null; text?: string; dueAt: number | null; done?: boolean }) =>
	client.req<Reminder & { error?: string }>('POST', `/api/w/${wid}/reminders`, input);

const patch = (client: Client, wid: string, id: number, input: { dueAt?: number | null; done?: boolean }) => client.req<Reminder>('PATCH', `/api/w/${wid}/reminders/${id}`, input);

const later = async (client: Client, wid: string) => (await client.req<LaterItem[]>('GET', `/api/w/${wid}/later`)).data;

const notifications = async (client: Client, wid: string) => (await client.req<NotificationPage>('GET', `/api/w/${wid}/notifications`)).data.items;

const SOON = () => Date.now() + 3600 * 1000;

// Rend les rappels en attente échus puis déclenche l'alarme.
async function fireAlarm(wid: string): Promise<void> {
	const stub = env.WORKSPACE.getByName(wid);
	await runInDurableObject(stub, (_instance, state) => {
		state.storage.sql.exec('UPDATE reminders SET due_at = ? WHERE due_at IS NOT NULL AND fired_at IS NULL', Date.now() - 1);
	});
	expect(await runDurableObjectAlarm(stub)).toBe(true);
}

describe('rappels', () => {
	it('crée un rappel sur un message, fusionné avec l’enregistrement', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const message = await post(owner, wid, general.id, 'devis à relancer');
		await member.req('PUT', `/api/w/${wid}/messages/${message.data.id}/saved`, { saved: true });
		const created = await remind(member, wid, { messageId: message.data.id, dueAt: SOON() });
		expect(created.status).toBe(201);
		expect(created.data).toMatchObject({ messageId: message.data.id, firedAt: null, doneAt: null });

		const items = await later(member, wid);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ key: `m${message.data.id}`, unavailable: false, reminder: { id: created.data.id } });
		expect(items[0]!.savedAt).not.toBeNull();

		// Reposer remplace l'échéance sans doublon.
		const again = await remind(member, wid, { messageId: message.data.id, dueAt: SOON() + 60_000 });
		expect(again.data.id).toBe(created.data.id);
		expect(await later(member, wid)).toHaveLength(1);
	});

	it('refuse une échéance passée et une note vide', async () => {
		const { member, wid } = await workspaceWithMember();
		expect((await remind(member, wid, { text: 'trop tard', dueAt: Date.now() - 1000 })).status).toBe(400);
		expect((await remind(member, wid, { text: '  ', dueAt: SOON() })).status).toBe(400);
		expect((await remind(member, wid, { text: 'sans date', dueAt: null })).status).toBe(400);
		expect((await remind(member, wid, { messageId: 999_999, dueAt: SOON() })).status).toBe(404);
		const note = await remind(member, wid, { text: 'relancer le devis', dueAt: SOON() });
		expect(note.status).toBe(201);
		expect((await patch(member, wid, note.data.id, { dueAt: Date.now() - 1 })).status).toBe(400);
	});

	it('déclenche à l’échéance, notifie et se reporte', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const message = await post(owner, wid, general.id, 'point budget');
		const reminder = (await remind(member, wid, { messageId: message.data.id, dueAt: SOON() })).data;
		await fireAlarm(wid);

		const [notice] = await notifications(member, wid);
		expect(notice).toMatchObject({ kind: 'reminder', title: `Rappel : message dans #${general.name}`, body: 'point budget' });
		expect(reminderIdOf(notice!.link)).toBe(reminder.id);
		expect(notice!.link).toContain(`/${general.id}?m=${message.data.id}`);
		expect((await later(member, wid))[0]!.reminder!.firedAt).not.toBeNull();

		const snoozed = await patch(member, wid, reminder.id, { dueAt: SOON() });
		expect(snoozed.data.firedAt).toBeNull();
		await fireAlarm(wid);
		expect((await notifications(member, wid)).filter((n) => n.kind === 'reminder')).toHaveLength(2);
	});

	it('marque terminé, rouvre et retire le rappel', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const a = await post(owner, wid, general.id, 'a');
		const b = await post(owner, wid, general.id, 'b');
		const reminder = (await remind(member, wid, { messageId: a.data.id, dueAt: SOON() })).data;
		expect((await patch(member, wid, reminder.id, { done: true })).data.doneAt).not.toBeNull();
		expect((await patch(member, wid, reminder.id, { done: false })).data.doneAt).toBeNull();
		expect((await patch(member, wid, reminder.id, { dueAt: null })).data.dueAt).toBeNull();

		// Message seulement enregistré : terminé sans échéance.
		await member.req('PUT', `/api/w/${wid}/messages/${b.data.id}/saved`, { saved: true });
		expect((await remind(member, wid, { messageId: b.data.id, dueAt: null, done: true })).data.doneAt).not.toBeNull();
		expect((await later(member, wid)).find((i) => i.messageId === b.data.id)?.reminder?.doneAt).not.toBeNull();

		// Retirer l'enregistrement ou supprimer l'entrée la sort de « Plus tard ».
		await member.req('PUT', `/api/w/${wid}/messages/${b.data.id}/saved`, { saved: false });
		expect((await member.req('DELETE', `/api/w/${wid}/reminders/${reminder.id}`)).status).toBe(200);
		expect(await later(member, wid)).toEqual([]);
	});

	it('reste propre à chacun', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const message = await post(owner, wid, general.id, 'perso');
		const reminder = (await remind(member, wid, { messageId: message.data.id, dueAt: SOON() })).data;
		const note = (await remind(member, wid, { text: 'note perso', dueAt: SOON() })).data;
		expect(await later(owner, wid)).toEqual([]);
		expect((await patch(owner, wid, reminder.id, { done: true })).status).toBe(404);
		expect((await owner.req('DELETE', `/api/w/${wid}/reminders/${note.id}`)).status).toBe(404);
		await fireAlarm(wid);
		expect((await notifications(owner, wid)).some((n) => n.kind === 'reminder')).toBe(false);
		expect((await notifications(member, wid)).filter((n) => n.kind === 'reminder')).toHaveLength(2);
	});

	it('garde le rappel d’un message supprimé, affiché indisponible', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const message = await post(owner, wid, general.id, 'secret');
		await remind(member, wid, { messageId: message.data.id, dueAt: SOON() });
		expect((await owner.req('DELETE', `/api/w/${wid}/messages/${message.data.id}`)).status).toBe(200);

		const [item] = await later(member, wid);
		expect(item).toMatchObject({ messageId: message.data.id, message: null, unavailable: true });
		await fireAlarm(wid);
		const [notice] = await notifications(member, wid);
		expect(notice).toMatchObject({ kind: 'reminder', title: 'Rappel : message indisponible', body: '' });
	});
});

describe('/rappel : analyse de date', () => {
	// Mercredi 28 octobre 2026, 17 h.
	const now = new Date(2026, 9, 28, 17, 0);
	const local = (m: number, d: number, h: number, min = 0) => new Date(2026, m, d, h, min).getTime();

	it.each([
		['demain 9h relancer le devis', local(9, 29, 9), 'relancer le devis'],
		['Demain à 9h30 : appeler Paul', local(9, 29, 9, 30), 'appeler Paul'],
		['dans 2 h appeler Paul', now.getTime() + 2 * 3600_000, 'appeler Paul'],
		['dans 20 min café', now.getTime() + 20 * 60_000, 'café'],
		['dans une demi-heure pause', now.getTime() + 30 * 60_000, 'pause'],
		['dans 3 jours rendu', now.getTime() + 3 * 86_400_000, 'rendu'],
		['lundi point hebdo', local(10, 2, 9), 'point hebdo'],
		['lundi prochain à 14h30 revue', local(10, 2, 14, 30), 'revue'],
		['mercredi réunion', local(10, 4, 9), 'réunion'],
		['demain matin', local(9, 29, 9), ''],
		['ce soir sortir les poubelles', local(9, 28, 18), 'sortir les poubelles'],
		['à 15h appel', local(9, 29, 15), 'appel'],
		['18:45 train', local(9, 28, 18, 45), 'train'],
		['le 12/11 à 10h dentiste', local(10, 12, 10), 'dentiste'],
		['3 décembre rendu du projet', local(11, 3, 9), 'rendu du projet'],
		['après-demain 8h', local(9, 30, 8), ''],
		["aujourd’hui 19h dîner", local(9, 28, 19), 'dîner'],
	])('%s', (input, dueAt, text) => {
		expect(parseReminder(input, now)).toEqual({ dueAt, text });
	});

	it('renvoie null sans échéance reconnue', () => {
		expect(parseReminder('relancer le devis', now)).toBeNull();
		expect(parseReminder('', now)).toBeNull();
		expect(parseReminder('à 25h', now)).toBeNull();
	});
});
