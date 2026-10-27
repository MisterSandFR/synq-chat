import { describe, expect, it } from 'vitest';

import type { PinInfo, Reaction } from '../shared/chat';
import { EMOJIS, searchEmojis } from '../shared/emoji';
import { P } from '../shared/permissions';
import type { Message, MessagePage } from '../shared/types';
import { applyFormat } from '../src/workspace/chat/format';
import { emojiOnly, parseBlocks } from '../src/workspace/chat/markdown';
import { workspaceWithMember, type Client } from './helpers';

async function post(client: Client, wid: string, channelId: string, body: string): Promise<Message> {
	const res = await client.req<Message>('POST', `/api/w/${wid}/channels/${channelId}/messages`, { body });
	expect(res.status).toBe(200);
	return res.data;
}

const reaction = (wid: string, id: number, emoji: string) => `/api/w/${wid}/messages/${id}/reactions/${encodeURIComponent(emoji)}`;

describe('réactions', () => {
	it('ajoute, cumule, retire et diffuse en temps réel', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const message = await post(owner, wid, general.id, 'Salut');
		const socket = await owner.socket(wid);

		const first = await member.req<Reaction[]>('PUT', reaction(wid, message.id, '👍'));
		expect(first.status).toBe(200);
		expect(first.data).toEqual([{ emoji: '👍', users: [member.user.id] }]);
		expect(await socket.next('reactions')).toMatchObject({ channelId: general.id, messageId: message.id, reactions: first.data });

		expect((await member.req<Reaction[]>('PUT', reaction(wid, message.id, '👍'))).data).toEqual(first.data);
		await owner.req('PUT', reaction(wid, message.id, '👍'));
		await owner.req('PUT', reaction(wid, message.id, '❤️'));

		const page = await member.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.find((m) => m.id === message.id)?.reactions).toEqual([
			{ emoji: '👍', users: [member.user.id, owner.user.id] },
			{ emoji: '❤️', users: [owner.user.id] },
		]);

		const removed = await member.req<Reaction[]>('DELETE', reaction(wid, message.id, '👍'));
		expect(removed.data).toEqual([
			{ emoji: '👍', users: [owner.user.id] },
			{ emoji: '❤️', users: [owner.user.id] },
		]);
		socket.ws.close();
	});

	it('refuse emoji inconnu, message absent et permission retirée', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const message = await post(owner, wid, general.id, 'Salut');
		expect((await member.req('PUT', reaction(wid, message.id, 'abc'))).status).toBe(400);
		expect((await member.req('PUT', reaction(wid, 999999, '👍'))).status).toBe(404);
		expect((await member.req('PUT', reaction(wid, message.id, '👀'))).status).toBe(200);

		const denied = await owner.req('PUT', `/api/w/${wid}/channels/${general.id}/overrides`, { overrides: { default: { allow: 0, deny: P.ADD_REACTIONS } } });
		expect(denied.status).toBe(200);
		expect((await member.req('PUT', reaction(wid, message.id, '👍'))).status).toBe(403);
		// Retirer sa réaction reste permis.
		expect((await member.req<Reaction[]>('DELETE', reaction(wid, message.id, '👀'))).data).toEqual([]);
		expect((await owner.req('PUT', reaction(wid, message.id, '👍'))).status).toBe(200);
	});

	it('plafonne le nombre d’emojis distincts', async () => {
		const { owner, wid, general } = await workspaceWithMember();
		const message = await post(owner, wid, general.id, 'Sondage');
		for (const emoji of EMOJIS.slice(0, 20)) {
			expect((await owner.req('PUT', reaction(wid, message.id, emoji.char))).status).toBe(200);
		}
		expect((await owner.req('PUT', reaction(wid, message.id, EMOJIS[20]!.char))).status).toBe(400);
		expect((await owner.req('PUT', reaction(wid, message.id, EMOJIS[0]!.char))).status).toBe(200);
	});
});

describe('épingles', () => {
	it('réservées aux modérateurs, listées, diffusées et nettoyées', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const first = await post(member, wid, general.id, 'À garder');
		const second = await post(member, wid, general.id, 'Aussi');
		expect((await member.req('PUT', `/api/w/${wid}/messages/${first.id}/pin`)).status).toBe(403);

		const socket = await member.socket(wid);
		const pinned = await owner.req<PinInfo>('PUT', `/api/w/${wid}/messages/${first.id}/pin`);
		expect(pinned.status).toBe(200);
		expect(pinned.data.by).toBe(owner.user.id);
		expect(await socket.next('pinned')).toMatchObject({ channelId: general.id, messageId: first.id, pinned: { by: owner.user.id } });
		expect((await owner.req('PUT', `/api/w/${wid}/messages/${second.id}/pin`)).status).toBe(200);

		const list = await member.req<Message[]>('GET', `/api/w/${wid}/channels/${general.id}/pins`);
		expect(list.data.map((m) => m.id)).toEqual([second.id, first.id]);
		expect(list.data[1]!.pinned).toMatchObject({ by: owner.user.id });

		expect((await owner.req('DELETE', `/api/w/${wid}/messages/${second.id}/pin`)).status).toBe(200);
		expect((await member.req('DELETE', `/api/w/${wid}/messages/${first.id}`)).status).toBe(200);
		expect((await member.req<Message[]>('GET', `/api/w/${wid}/channels/${general.id}/pins`)).data).toEqual([]);
		expect((await member.req('GET', `/api/w/${wid}/channels/${crypto.randomUUID()}/pins`)).status).toBe(404);
		socket.ws.close();
	});

	it('accepte la permission dédiée', async () => {
		const { owner, member, wid, general } = await workspaceWithMember();
		const message = await post(owner, wid, general.id, 'Note');
		await owner.req('PUT', `/api/w/${wid}/channels/${general.id}/overrides`, { overrides: { default: { allow: P.PIN_MESSAGES, deny: 0 } } });
		expect((await member.req('PUT', `/api/w/${wid}/messages/${message.id}/pin`)).status).toBe(200);
		const page = await member.req<MessagePage>('GET', `/api/w/${wid}/channels/${general.id}/messages`);
		expect(page.data.messages.find((m) => m.id === message.id)?.pinned?.by).toBe(member.user.id);
	});
});

describe('markdown et emojis', () => {
	it('découpe les blocs', () => {
		expect(parseBlocks('Salut\n> cité\n> suite\n- a\n- b\n1. un\n```\ncode\n```\nfin')).toEqual([
			{ kind: 'p', text: 'Salut' },
			{ kind: 'quote', text: 'cité\nsuite' },
			{ kind: 'list', ordered: false, start: 1, items: ['a', 'b'] },
			{ kind: 'list', ordered: true, start: 1, items: ['un'] },
			{ kind: 'code', text: 'code' },
			{ kind: 'p', text: 'fin' },
		]);
		expect(parseBlocks('```js\nlet a = 1;')).toEqual([{ kind: 'code', text: 'let a = 1;' }]);
		expect(parseBlocks('<@x> **gras**\nsuite')).toEqual([{ kind: 'p', text: '<@x> **gras**\nsuite' }]);
	});

	it('repère les messages faits seulement d’emojis', () => {
		expect(emojiOnly('🎉 🎉')).toBe(true);
		expect(emojiOnly(':tada: 👍')).toBe(true);
		expect(emojiOnly('bravo 🎉')).toBe(false);
		expect(emojiOnly('123')).toBe(false);
	});

	it('met en forme la sélection', () => {
		expect(applyFormat('un mot', 3, 6, 'bold')).toEqual({ value: 'un **mot**', start: 5, end: 8 });
		expect(applyFormat('a\nb', 0, 3, 'list').value).toBe('- a\n- b');
		expect(applyFormat('', 0, 0, 'link')).toEqual({ value: '[texte](https://)', start: 8, end: 16 });
	});

	it('cherche par code court et mot-clé', () => {
		expect(searchEmojis('thumbsup')[0]?.char).toBe('👍');
		expect(searchEmojis('fete').map((e) => e.char)).toContain('🎉');
		expect(new Set(EMOJIS.map((e) => e.name)).size).toBe(EMOJIS.length);
	});
});
