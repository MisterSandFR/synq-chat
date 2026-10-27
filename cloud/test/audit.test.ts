import { describe, expect, it } from 'vitest';

import type { AuditPage } from '../shared/audit';
import type { Channel, Grade } from '../shared/types';
import { workspaceWithMember } from './helpers';

describe('journal d’audit', () => {
	it('trace les actions d’admin réussies, réservé à la gestion de l’espace', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const grade = await owner.req<Grade>('POST', `/api/w/${wid}/grades`, { name: 'Modo', permissions: 0 });
		expect(grade.status).toBe(201);
		const channel = await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'projets', kind: 'text' });
		await owner.req('PATCH', `/api/w/${wid}/channels/${channel.data.id}`, { topic: 'Suivi' });
		await owner.req('PUT', `/api/w/${wid}/members/${member.user.id}/grades`, { gradeIds: [grade.data.id] });
		await owner.req('POST', `/api/w/${wid}/commands`, { name: 'deploy', description: 'Déployer', url: 'https://example.com/hook', secret: 'super-secret-123456', visibility: 'channel' });
		// Refus : rien n'est journalisé.
		expect((await member.req('DELETE', `/api/w/${wid}/channels/${general.id}`)).status).toBe(403);
		await owner.req('DELETE', `/api/w/${wid}/channels/${channel.data.id}`);

		expect((await member.req('GET', `/api/w/${wid}/audit`)).status).toBe(403);
		const log = await owner.req<AuditPage>('GET', `/api/w/${wid}/audit`);
		expect(log.status).toBe(200);
		const actions = log.data.items.map((e) => e.action);
		expect(actions).toEqual(expect.arrayContaining(['grade.create', 'channel.create', 'channel.update', 'member.grades', 'channel.delete']));
		expect(actions.filter((a) => a === 'channel.delete')).toHaveLength(1);
		expect(log.data.items[0]!.action).toBe('channel.delete');
		const created = log.data.items.find((e) => e.action === 'channel.create')!;
		expect(created).toMatchObject({ kind: 'channel', targetId: channel.data.id, targetName: 'projets', actorId: owner.user.id });
		expect(log.data.items.find((e) => e.action === 'channel.update')!.detail).toBe('topic');
		expect(JSON.stringify(log.data)).not.toContain('super-secret');

		const grades = await owner.req<AuditPage>('GET', `/api/w/${wid}/audit?kind=grade`);
		expect(grades.data.items.every((e) => e.kind === 'grade')).toBe(true);
	});
});
