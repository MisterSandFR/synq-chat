import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { AiFile, PageDraft } from '../shared/ai-files';
import type { AiDone, AiTurnReply } from '../shared/ai-hub';
import type { CanvasMeta } from '../shared/canvas';
import { P } from '../shared/permissions';
import type { Channel } from '../shared/types';
import { aiRunner, type AiTask } from '../worker/ai';
import { cleanDraft, draftFromModel, fileRunner, purgeAiFiles, sniff, toTemplate } from '../worker/ai-files';
import { Client, workspaceWithMember } from './helpers';

const bytes = (...parts: Array<number[] | string>) => {
	const chunks = parts.map((p) => (typeof p === 'string' ? new TextEncoder().encode(p) : new Uint8Array(p)));
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out.buffer;
};

const PDF = bytes('%PDF-1.7\n', 'rapport trimestriel');
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'IHDR');
const DOCX = bytes([0x50, 0x4b, 0x03, 0x04], '....[Content_Types].xml....word/document.xml....');

const LAYOUT = JSON.stringify({
	title: 'Bilan trimestriel',
	icon: '📊',
	cover: 3,
	blocks: [
		{ type: 'heading', level: 1, text: 'Résumé' },
		{ type: 'callout', emoji: '💡', text: 'Chiffre d’affaires : **42 k€**' },
		{ type: 'columns', columns: [[{ type: 'paragraph', text: 'Avant' }], [{ type: 'bullets', items: ['Après'] }]] },
		{ type: 'table', rows: [['Mois', 'Ventes'], ['Mars', '42']] },
		{ type: 'image', file: 1, caption: 'Ventes' },
		{ type: 'script', text: 'alert(1)' },
	],
});

function mocks(answer: (task: AiTask) => string = () => 'Réponse.') {
	const prompts: string[] = [];
	vi.spyOn(aiRunner, 'run').mockImplementation(async (_env, task) => {
		prompts.push(task.prompt);
		return answer(task);
	});
	const converted = vi
		.spyOn(fileRunner, 'toMarkdown')
		.mockImplementation(async (_env, file) => (file.type.startsWith('image/') ? 'Graphique des ventes trimestrielles' : `# ${file.name}\nChiffre d’affaires : 42 k€. Lancement le 3 mars.`));
	return { prompts, converted };
}

afterEach(() => vi.restoreAllMocks());

const send = (client: Client, name: string, body: ArrayBuffer) =>
	client.req<AiFile>('POST', '/api/ai/hub/files', body, { 'X-File-Name': encodeURIComponent(name), 'Content-Type': 'application/octet-stream' });

const turn = (client: Client, body: Record<string, unknown>) => client.req<AiTurnReply>('POST', '/api/ai/hub/turns', { timezone: 'Europe/Paris', ...body });

describe('Synq IA : fichiers joints', () => {
	it('envoie, vérifie la signature, nettoie le nom et reste privé', async () => {
		const { converted } = mocks();
		const { owner, member } = await workspaceWithMember();
		const pdf = await send(member, '../../rap<port>.pdf', PDF);
		expect(pdf.status).toBe(201);
		expect(pdf.data).toMatchObject({ name: 'rapport.pdf', kind: 'pdf', type: 'application/pdf', preview: null });
		expect(converted).toHaveBeenCalledOnce();

		const png = await send(member, 'graphique.png', PNG);
		expect(png.data.preview).toBe(`/api/ai/hub/files/${png.data.id}`);
		const served = await member.raw('GET', png.data.preview!);
		expect(served.status).toBe(200);
		expect(served.headers.get('content-type')).toBe('image/png');
		expect(served.headers.get('content-security-policy')).toContain('sandbox');
		await served.arrayBuffer();
		const doc = await member.raw('GET', `/api/ai/hub/files/${pdf.data.id}`);
		expect(doc.headers.get('content-disposition')).toMatch(/^attachment/);
		await doc.arrayBuffer();

		expect((await owner.req('GET', `/api/ai/hub/files/${pdf.data.id}`)).status).toBe(404);
		expect((await owner.req('DELETE', `/api/ai/hub/files/${pdf.data.id}`)).status).toBe(404);
		expect((await turn(owner, { intent: 'ask', text: 'Que dit ce fichier ?', files: [pdf.data.id] })).status).toBe(404);
		expect((await new Client().req('POST', '/api/ai/hub/files', PDF, { 'X-File-Name': 'a.pdf' })).status).toBe(401);
		expect((await member.req('DELETE', `/api/ai/hub/files/${pdf.data.id}`)).status).toBe(200);
		expect(await env.FILES.get(`ai/${member.user.id}/${pdf.data.id}`)).toBeNull();
	});

	it('refuse les types usurpés et les fichiers trop lourds', async () => {
		const { converted } = mocks();
		const { member } = await workspaceWithMember();
		expect((await send(member, 'faux.pdf', PNG)).status).toBe(400);
		expect((await send(member, 'outil.exe', PDF)).status).toBe(400);
		expect((await send(member, 'logo.svg', bytes('<svg onload="alert(1)"/>'))).status).toBe(400);
		expect((await send(member, 'note.txt', bytes('texte', [0], 'binaire'))).status).toBe(400);
		expect((await send(member, 'tableau.xlsx', DOCX)).status).toBe(400);
		expect((await send(member, 'lettre.docx', DOCX)).status).toBe(201);
		expect((await send(member, 'gros.pdf', new ArrayBuffer(20 * 1024 * 1024 + 1))).status).toBe(413);
		const html = await send(member, 'page.html', bytes('<h1>Titre</h1><script>alert(1)</script>'));
		expect(html.data.kind).toBe('html');
		expect(converted).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ name: 'page.html', type: 'text/html' }));
		expect(converted).toHaveBeenCalledTimes(2);
	});

	it('répond, résume et compare à partir des fichiers, contenu borné', async () => {
		const { prompts } = mocks();
		const { member } = await workspaceWithMember();
		const pdf = (await send(member, 'bilan.pdf', PDF)).data;
		const long = (await send(member, 'notes.md', bytes(`# Notes\n${'mot '.repeat(8000)}`))).data;
		expect(long.kind).toBe('markdown');
		expect((await turn(member, { intent: 'ask', text: 'Quel chiffre d’affaires ?', files: [pdf.id] })).status).toBe(200);
		expect(prompts.at(-1)).toContain('42 k€');
		expect((await turn(member, { intent: 'compare', files: [pdf.id] })).status).toBe(400);
		const compared = await turn(member, { intent: 'compare', files: [pdf.id, long.id] });
		expect(compared.status).toBe(200);
		expect(compared.data.turns[0]!.text).toBe('Comparer les fichiers : bilan.pdf, notes.md');
		expect(prompts.at(-1)).toMatch(/contenu tronqué : \d+ caractères non transmis/);
		expect((await turn(member, { intent: 'summarize', files: [pdf.id, long.id] })).status).toBe(200);
		expect(prompts.at(-1)).toContain('Résume chacun de ces fichiers');
	});

	it('met en page, ajuste puis crée la page avec les droits de la personne', async () => {
		const { prompts } = mocks((task) => (task.prompt.includes('"blocks"') ? LAYOUT : 'Réponse.'));
		const { owner, member, wid } = await workspaceWithMember();
		const pdf = (await send(member, 'bilan.pdf', PDF)).data;
		const png = (await send(member, 'ventes.png', PNG)).data;

		const proposed = await turn(member, { intent: 'ask', text: 'Fais-en une jolie page', files: [pdf.id, png.id], context: { workspaceId: wid } });
		expect(proposed.status).toBe(200);
		const answer = proposed.data.turns[1]!;
		expect(answer.action?.kind).toBe('layout');
		const action = answer.action as Extract<NonNullable<typeof answer.action>, { kind: 'layout' }>;
		expect(action.draft).toMatchObject({ title: 'Bilan trimestriel', icon: '📊', cover: 'gradient:3' });
		expect(action.draft.blocks.map((b) => b.type)).toEqual(['heading', 'callout', 'columns', 'table', 'image']);
		expect(action.draft.blocks[1]).toMatchObject({ text: 'Chiffre d’affaires : 42 k€' });
		expect(action.draft.blocks[4]).toMatchObject({ file: png.id });
		expect(prompts.at(-1)).toContain('[Image 1] ventes.png : Graphique des ventes');

		const adjusted = await turn(member, { intent: 'layout', text: 'Plus court', files: action.files, adjust: answer.id, conversationId: proposed.data.conversation.id, context: { workspaceId: wid } });
		expect(adjusted.status).toBe(200);
		expect(prompts.at(-1)).toContain('=== Page actuelle (JSON) ===');
		expect(prompts.at(-1)).toContain('"file":1');
		expect(prompts.at(-1)).toContain('Plus court');

		const secret = (await owner.req<Channel>('POST', `/api/w/${wid}/channels`, { name: 'direction' })).data;
		await owner.req('PUT', `/api/w/${wid}/channels/${secret.id}/overrides`, { overrides: { default: { allow: 0, deny: P.VIEW_CHANNEL } } });
		const hidden = (await owner.req<CanvasMeta>('POST', `/api/w/${wid}/canvases`, { title: 'Direction' })).data;
		await owner.req('PUT', `/api/w/${wid}/access/page/${hidden.id}`, { restricted: true, rules: [] });
		const execute = (body: Record<string, unknown>) => member.req<AiDone>('POST', '/api/ai/hub/execute', { conversationId: proposed.data.conversation.id, turnId: answer.id, ...body });
		expect((await execute({ action: { ...action, parentId: hidden.id } })).status).toBe(404);
		expect((await execute({ action: { ...action, draft: { ...action.draft, blocks: [{ type: 'script', text: 'x' }] } } })).status).toBe(400);
		expect((await owner.req('POST', '/api/ai/hub/execute', { conversationId: proposed.data.conversation.id, turnId: answer.id, action })).status).toBe(404);

		const done = await execute({ action: { ...action, draft: { ...action.draft, title: 'Bilan T1' } } });
		expect(done.status).toBe(200);
		const pageId = done.data.href!.split('/').pop()!;
		const page = (await member.req<CanvasMeta>('GET', `/api/w/${wid}/canvases/${pageId}`)).data;
		expect(page).toMatchObject({ title: 'Bilan T1', icon: '📊', cover: 'gradient:3', createdBy: member.user.id });
		const stored = await env.FILES.list({ prefix: `w/${wid}/canvas/${pageId}/` });
		expect(stored.objects).toHaveLength(1);
		const doc = new Y.Doc();
		Y.applyUpdate(doc, await env.CANVAS_DOC.getByName(pageId).exportState());
		// toString() de Yjs met les noms de nœuds en minuscules.
		const xml = doc.getXmlFragment('default').toString();
		for (const tag of ['<heading', '<callout', '<columns', '<column>', '<table>', '<tableheader', '<bulletlist', '<image']) {
			expect(xml).toContain(tag);
		}
		expect(xml).toContain(`/api/w/${wid}/canvases/${pageId}/files/`);
		expect((await execute({ action })).status).toBe(409);
	});

	it('valide le schéma de page et refuse ce qui sort du cadre', () => {
		const draft: PageDraft = { title: 'Page', icon: '📄', cover: null, blocks: [{ type: 'paragraph', text: 'Bonjour' }, { type: 'image', file: 'img-1', caption: '' }] };
		expect(cleanDraft(draft, ['img-1'])).toEqual(draft);
		expect(cleanDraft(draft, [])).toBeNull();
		expect(cleanDraft({ ...draft, blocks: [{ type: 'columns', columns: [[{ type: 'paragraph', text: 'seule' }]] }] }, [])).toBeNull();
		expect(cleanDraft({ ...draft, blocks: [{ type: 'columns', columns: [[{ type: 'columns', columns: [] }], [{ type: 'divider' }]] }] }, [])).toBeNull();
		expect(cleanDraft({ ...draft, cover: 'javascript:alert(1)' }, ['img-1'])).toBeNull();
		expect(cleanDraft({ ...draft, title: '' }, ['img-1'])).toBeNull();
		expect(cleanDraft({ ...draft, blocks: Array.from({ length: 200 }, () => ({ type: 'divider' })) }, [])).toBeNull();
		expect(draftFromModel('pas du JSON', [])).toBeNull();
		const long = draftFromModel(JSON.stringify({ title: 'Wiki', blocks: Array.from({ length: 5 }, (_, i) => ({ type: 'heading', level: 2, text: `Partie ${i}` })) }), ['img-1']);
		expect(long!.blocks[0]).toEqual({ type: 'toc' });
		expect(long!.blocks.at(-1)).toEqual({ type: 'image', file: 'img-1', caption: '' });
		const nodes = toTemplate([{ type: 'todo', items: ['A'] }, { type: 'toggle', text: 'Détails', blocks: [{ type: 'paragraph', text: 'x\n\ny' }] }, { type: 'image', file: 'absente', caption: '' }], new Map());
		expect(nodes.map((n) => n.type)).toEqual(['taskList', 'toggle']);
		expect(nodes[1]!.content!.map((n) => n.type)).toEqual(['toggleSummary', 'toggleBody']);
		expect(nodes[1]!.content![1]!.content).toHaveLength(2);
		const odt = bytes([0x50, 0x4b, 0x03, 0x04], new Array(26).fill(0), 'mimetypeapplication/vnd.oasis.opendocument.text');
		expect(sniff('cr.odt', new Uint8Array(odt))?.kind).toBe('odt');
		expect(sniff('cr.ods', new Uint8Array(odt))).toBeNull();
	});

	it('expire après 24 h et purge R2', async () => {
		mocks();
		const { member } = await workspaceWithMember();
		const file = (await send(member, 'notes.txt', bytes('À relire'))).data;
		expect(file.expiresAt - file.createdAt).toBe(86_400_000);
		await env.DB.prepare('UPDATE ai_files SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, file.id).run();
		expect((await member.req('GET', `/api/ai/hub/files/${file.id}`)).status).toBe(404);
		expect((await turn(member, { intent: 'ask', text: 'Résume ce fichier', files: [file.id] })).status).toBe(404);
		await purgeAiFiles(env as unknown as Env, Date.now());
		expect(await env.DB.prepare('SELECT id FROM ai_files WHERE id = ?').bind(file.id).first()).toBeNull();
		expect(await env.FILES.get(`ai/${member.user.id}/${file.id}`)).toBeNull();
	});
});
