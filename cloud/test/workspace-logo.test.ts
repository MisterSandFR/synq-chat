import { describe, expect, it } from 'vitest';

import type { Me, WorkspaceDetail } from '../shared/types';
import { signup, workspaceWithMember } from './helpers';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).buffer;

describe('logo d’espace', () => {
	it('envoie, sert, remplace et retire le logo', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		const sent = await owner.req<{ logoUrl: string }>('POST', `/api/w/${wid}/logo`, PNG, { 'content-type': 'image/png' });
		expect(sent.status).toBe(201);
		const first = sent.data.logoUrl;
		expect(first).toMatch(new RegExp(`^/api/workspace-logos/${wid}/`));

		const got = await member.raw('GET', first);
		expect(got.status).toBe(200);
		expect(got.headers.get('content-type')).toBe('image/png');
		expect(got.headers.get('content-security-policy')).toContain('sandbox');
		expect(got.headers.get('x-content-type-options')).toBe('nosniff');
		expect((await got.arrayBuffer()).byteLength).toBe(PNG.byteLength);
		expect((await member.req<WorkspaceDetail>('GET', `/api/w/${wid}/info`)).data.logoUrl).toBe(first);
		expect((await member.req<Me>('GET', '/api/me')).data.workspaces.find((w) => w.id === wid)?.logoUrl).toBe(first);

		const replaced = await owner.req<{ logoUrl: string }>('POST', `/api/w/${wid}/logo`, PNG, { 'content-type': 'image/webp' });
		expect(replaced.status).toBe(201);
		expect(replaced.data.logoUrl).not.toBe(first);
		expect((await owner.req('GET', first)).status).toBe(404);
		expect((await owner.raw('GET', replaced.data.logoUrl)).status).toBe(200);

		expect((await owner.req('DELETE', `/api/w/${wid}/logo`)).status).toBe(200);
		expect((await owner.req('GET', replaced.data.logoUrl)).status).toBe(404);
		expect((await owner.req<WorkspaceDetail>('GET', `/api/w/${wid}/info`)).data.logoUrl).toBeNull();
	});

	it('refuse sans permission, mauvais type ou taille', async () => {
		const { owner, member, wid } = await workspaceWithMember();
		expect((await member.req('POST', `/api/w/${wid}/logo`, PNG, { 'content-type': 'image/png' })).status).toBe(403);
		expect((await member.req('DELETE', `/api/w/${wid}/logo`)).status).toBe(403);
		expect((await owner.req('POST', `/api/w/${wid}/logo`, '<svg></svg>', { 'content-type': 'image/svg+xml' })).status).toBe(400);
		expect((await owner.req('POST', `/api/w/${wid}/logo`, new ArrayBuffer(2 * 1024 * 1024 + 1), { 'content-type': 'image/png' })).status).toBe(413);
		expect((await owner.req<WorkspaceDetail>('GET', `/api/w/${wid}/info`)).data.logoUrl).toBeNull();

		const outsider = await signup('Eve');
		expect((await outsider.req('POST', `/api/w/${wid}/logo`, PNG, { 'content-type': 'image/png' })).status).toBe(404);
	});
});
