import { describe, expect, it } from 'vitest';

import { P } from '../shared/permissions';
import type { Attachment, Message, MessagePage } from '../shared/types';
import { parseOpenGraph, safeUrl } from '../worker/media';
import { Client, signup, workspaceWithMember } from './helpers';

const upload = (client: Client, wid: string, name: string, body = 'contenu', type = 'text/plain') =>
	client.req<Attachment>('POST', `/api/w/${wid}/files`, body, { 'content-type': type, 'x-file-name': encodeURIComponent(name) });

const post = (client: Client, wid: string, cid: string, body: Record<string, unknown>) => client.req<Message>('POST', `/api/w/${wid}/channels/${cid}/messages`, body);

const lastMessage = async (client: Client, wid: string, cid: string) =>
	(await client.req<MessagePage>('GET', `/api/w/${wid}/channels/${cid}/messages`)).data.messages.at(-1);

describe('pièces jointes multiples', () => {
	it('joint plusieurs fichiers, doublons ignorés', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const a = await upload(owner, wid, 'notes.txt');
		const b = await upload(owner, wid, 'photo.png', 'png', 'image/png');
		const msg = await post(owner, wid, general.id, { body: 'deux', attachmentKeys: [a.data.key, b.data.key, a.data.key] });
		expect(msg.status).toBe(200);
		expect(msg.data.attachments.map((f) => f.name)).toEqual(['notes.txt', 'photo.png']);
		expect((await lastMessage(member, wid, general.id))?.attachments).toHaveLength(2);
	});

	it('accepte encore une clé unique', async () => {
		const { owner, wid, general } = await workspaceWithMember();
		const a = await upload(owner, wid, 'seul.txt');
		const msg = await post(owner, wid, general.id, { body: '', attachmentKey: a.data.key });
		expect(msg.status).toBe(200);
		expect(msg.data.attachments).toEqual([a.data]);
	});

	it('refuse trop de fichiers, une clé étrangère ou déjà jointe', async () => {
		const { owner, wid, general } = await workspaceWithMember();
		const keys = Array.from({ length: 11 }, (_, i) => `w/${wid}/${i}`);
		expect((await post(owner, wid, general.id, { body: 'x', attachmentKeys: keys })).status).toBe(400);
		expect((await post(owner, wid, general.id, { body: 'x', attachmentKeys: ['w/autre/cle'] })).status).toBe(400);
		expect((await post(owner, wid, general.id, { body: 'x', attachmentKeys: [42] })).status).toBe(400);
		const a = await upload(owner, wid, 'une.txt');
		expect((await post(owner, wid, general.id, { body: '', attachmentKeys: [a.data.key] })).status).toBe(200);
		expect((await post(owner, wid, general.id, { body: '', attachmentKeys: [a.data.key] })).status).toBe(409);
	});

	it('exige la permission de joindre', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		await owner.req('PUT', `/api/w/${wid}/channels/${general.id}/overrides`, { overrides: { default: { allow: 0, deny: P.ATTACH_FILES } } });
		const a = await upload(member, wid, 'refus.txt');
		expect((await post(member, wid, general.id, { body: 'x', attachmentKeys: [a.data.key] })).status).toBe(403);
		expect((await post(member, wid, general.id, { body: 'texte seul', attachmentKeys: [] })).status).toBe(200);
	});

	it('retirer un fichier du drive garde les autres pièces jointes', async () => {
		const { owner, wid, general } = await workspaceWithMember();
		const a = await upload(owner, wid, 'a.txt');
		const b = await upload(owner, wid, 'b.txt');
		const msg = await post(owner, wid, general.id, { body: '', attachmentKeys: [a.data.key, b.data.key] });
		const fileId = (key: string) => key.split('/').pop();
		expect((await owner.req('DELETE', `/api/w/${wid}/drive/files/${fileId(a.data.key)}`)).status).toBe(200);
		const kept = await lastMessage(owner, wid, general.id);
		expect(kept?.id).toBe(msg.data.id);
		expect(kept?.attachments.map((f) => f.name)).toEqual(['b.txt']);
		expect((await owner.req('DELETE', `/api/w/${wid}/drive/files/${fileId(b.data.key)}`)).status).toBe(200);
		expect((await lastMessage(owner, wid, general.id))?.id).not.toBe(msg.data.id);
	});

	it('supprimer le message efface tous ses fichiers', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const a = await upload(owner, wid, 'a.txt');
		const b = await upload(owner, wid, 'b.txt');
		const msg = await post(owner, wid, general.id, { body: 'x', attachmentKeys: [a.data.key, b.data.key] });
		expect((await owner.req('DELETE', `/api/w/${wid}/messages/${msg.data.id}`)).status).toBe(200);
		for (const key of [a.data.key, b.data.key]) {
			expect((await member.raw('GET', `/api/w/${wid}/files/${key.split('/').pop()}`)).status).toBe(404);
		}
	});
});

describe('aperçus de liens', () => {
	it('refuse adresses privées, ports et schémas exotiques', () => {
		const refused = [
			'http://127.0.0.1/',
			'http://10.1.2.3/',
			'http://192.168.0.1/',
			'http://172.20.0.1/',
			'http://100.64.0.1/',
			'http://169.254.169.254/latest/meta-data',
			'http://0.0.0.0/',
			'http://2130706433/',
			'http://0x7f.0.0.1/',
			'http://[::1]/',
			'http://[fd00::1]/',
			'http://localhost:8080/',
			'http://intranet/',
			'http://imprimante.local/',
			'http://api.internal/',
			'https://example.com:8443/',
			'http://user:pw@example.com/',
			'ftp://example.com/',
			'javascript:alert(1)',
			'file:///etc/passwd',
		];
		for (const raw of refused) {
			expect(safeUrl(raw), raw).toBeNull();
		}
		expect(safeUrl('https://example.com/page?q=1')?.hostname).toBe('example.com');
		expect(safeUrl('http://8.8.8.8/')).not.toBeNull();
		expect(safeUrl('/relatif', new URL('https://example.com/a'))?.toString()).toBe('https://example.com/relatif');
	});

	it('lit OpenGraph avec replis', () => {
		const html = `<html><head><title>Repli</title>
			<meta property="og:title" content="Titre &amp; suite">
			<meta name='description' content='Résumé &#233;crit'>
			<meta content="/img.png" property="og:image">
			<meta property="og:site_name" content="Exemple"></head><body>`;
		expect(parseOpenGraph(html, new URL('https://ex.com/a'))).toEqual({
			url: 'https://ex.com/a',
			title: 'Titre & suite',
			description: 'Résumé écrit',
			siteName: 'Exemple',
			image: 'https://ex.com/img.png',
		});
		expect(parseOpenGraph('<title> Seul </title><meta property="og:image" content="http://127.0.0.1/x.png">', new URL('http://www.ex.com/'))).toEqual({
			url: 'http://www.ex.com/',
			title: 'Seul',
			description: '',
			siteName: 'ex.com',
			image: null,
		});
		expect(parseOpenGraph('<p>rien</p>', new URL('https://ex.com/'))).toBeNull();
	});

	it('route réservée aux membres, lien privé refusé', async () => {
		const { owner, wid } = await workspaceWithMember();
		const path = `/api/w/${wid}/unfurl?url=${encodeURIComponent('http://127.0.0.1/admin')}`;
		expect((await owner.req('GET', path)).status).toBe(400);
		expect((await owner.req('GET', `/api/w/${wid}/unfurl`)).status).toBe(400);
		const eve = await signup('Eve');
		expect((await eve.req('GET', path)).status).toBe(404);
		expect((await new Client().req('GET', path)).status).toBe(401);
	});
});
