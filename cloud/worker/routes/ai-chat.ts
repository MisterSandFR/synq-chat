import { Hono } from 'hono';

import { AI_CHAT_LIMITS, type AiAnswer, type AiCatchup, type AiLang, type AiParseEventInput, type AiParsedEvent } from '../../shared/ai-chat';
import type { AiTextResult } from '../../shared/ai';
import type { Message } from '../../shared/types';
import { aiText } from '../ai';
import { bullets, CHAT_SYSTEM, eventPrompt, keywords, LANGS, mentionIds, parseEvent, transcript, validZone } from '../ai-chat';
import { fail, readJson, stub, unwrap, type AppEnv, type Ctx } from '../http';

export const aiChatRoutes = new Hono<AppEnv>();

const NOTHING = 'Je n’ai trouvé aucun message à ce sujet dans les conversations que tu peux voir.';

// Noms relus en D1 pour les auteurs et les mentions des seuls messages déjà autorisés.
async function names(c: Ctx, messages: Message[]): Promise<Map<string, string>> {
	const ids = [...new Set(messages.flatMap((m) => [m.userId, ...mentionIds(m.body)]))].slice(0, 90);
	if (!ids.length) {
		return new Map();
	}
	const { results } = await c.env.DB.prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(', ')})`)
		.bind(...ids)
		.all<{ id: string; name: string }>();
	return new Map(results.map((row) => [row.id, row.name]));
}

const ask = (c: Ctx, prompt: string, maxTokens = 900) => aiText(c.env, c.get('user').id, { system: CHAT_SYSTEM, prompt, maxTokens });

const textReply = async (c: Ctx, prompt: string, maxTokens?: number) => {
	const result = await ask(c, prompt, maxTokens);
	return result.ok ? c.json({ text: result.value } satisfies AiTextResult) : unwrap(c, result);
};

aiChatRoutes.post('/w/:wid/channels/:cid/ai/catchup', async (c) => {
	const { after } = await readJson<{ after: number }>(c);
	const found = await stub(c).aiSince(c.get('actor'), c.req.param('cid'), Number.isInteger(after) && after! >= 0 ? after! : null);
	if (!found.ok) {
		return unwrap(c, found);
	}
	const messages = found.value;
	if (!messages.length) {
		return c.json({ items: [], count: 0 } satisfies AiCatchup);
	}
	const log = transcript(messages, await names(c, messages), (m) => `[#${m.id}]`);
	const result = await ask(
		c,
		`${log}\n\n=== Tâche ===\nRésume ces messages non lus en 3 à 8 puces commençant par « - ». Termine chaque puce par la référence [#id] du message principal. Mets en avant décisions, questions ouvertes et demandes adressées.`,
	);
	if (!result.ok) {
		return unwrap(c, result);
	}
	return c.json({ items: bullets(result.value, new Set(messages.map((m) => m.id))), count: messages.length } satisfies AiCatchup);
});

aiChatRoutes.post('/w/:wid/messages/:mid/ai/thread-summary', async (c) => {
	const found = await stub(c).threadView(c.get('actor'), Number(c.req.param('mid')));
	if (!found.ok) {
		return unwrap(c, found);
	}
	const messages = [found.value.root, ...found.value.replies];
	const log = transcript(messages, await names(c, messages), () => '-');
	return textReply(c, `${log}\n\n=== Tâche ===\nRésume ce fil de discussion en 3 à 6 puces commençant par « - » : sujet, décisions, actions et qui s’en charge.`);
});

aiChatRoutes.post('/w/:wid/messages/:mid/ai/:action{translate|summary|reply}', async (c) => {
	const found = await stub(c).aiMessage(c.get('actor'), Number(c.req.param('mid')));
	if (!found.ok) {
		return unwrap(c, found);
	}
	const message = found.value;
	if (!message.body.trim()) {
		return fail(c, 400, 'Message sans texte');
	}
	const log = transcript([message], await names(c, [message]), () => '-');
	const action = c.req.param('action');
	if (action === 'translate') {
		const { lang } = await readJson<{ lang: AiLang }>(c);
		const target = typeof lang === 'string' && Object.hasOwn(LANGS, lang) ? `en ${LANGS[lang]}` : 'en français ; s’il est déjà en français, traduis-le en anglais';
		return textReply(c, `${log}\n\n=== Tâche ===\nTraduis le texte de ce message ${target}. Renvoie seulement la traduction, mise en forme markdown et mentions conservées.`, 2000);
	}
	if (action === 'summary') {
		return textReply(c, `${log}\n\n=== Tâche ===\nRésume ce message en 2 à 5 puces commençant par « - ».`);
	}
	return textReply(c, `${log}\n\n=== Tâche ===\nRédige une réponse courte et naturelle à ce message, dans sa langue, à la première personne. Renvoie seulement le texte de la réponse.`);
});

aiChatRoutes.post('/w/:wid/ai/ask', async (c) => {
	const { question } = await readJson<{ question: string }>(c);
	const q = typeof question === 'string' ? question.trim().slice(0, AI_CHAT_LIMITS.question) : '';
	if (q.length < 3) {
		return fail(c, 400, 'Question trop courte');
	}
	const words = keywords(q);
	// Recherche limitée par le DO aux conversations visibles de l'acteur.
	const sources = words.length ? await stub(c).aiSearch(c.get('actor'), words) : [];
	if (!sources.length) {
		return c.json({ text: NOTHING, sources: [] } satisfies AiAnswer);
	}
	const log = transcript(sources, await names(c, sources), (_, i) => `[${i + 1}]`);
	const result = await ask(
		c,
		`=== Messages trouvés ===\n${log}\n\n=== Question ===\n${q}\n\n=== Tâche ===\nRéponds à la question à partir de ces messages uniquement, en citant tes sources par leur numéro entre crochets, par exemple [2]. Si les messages ne permettent pas de répondre, dis-le.`,
		1200,
	);
	return result.ok ? c.json({ text: result.value, sources } satisfies AiAnswer) : unwrap(c, result);
});

aiChatRoutes.post('/ai/parse-event', async (c) => {
	const body = await readJson<AiParseEventInput>(c);
	const text = typeof body.text === 'string' ? body.text.trim() : '';
	if (!text || text.length > AI_CHAT_LIMITS.eventText) {
		return fail(c, 400, `Description requise (${AI_CHAT_LIMITS.eventText} caractères max)`);
	}
	const timezone = typeof body.timezone === 'string' && validZone(body.timezone) ? body.timezone : 'UTC';
	const now = typeof body.now === 'number' && Number.isFinite(body.now) ? body.now : Date.now();
	let people: Array<{ id: string; name: string }> = [];
	if (typeof body.workspaceId === 'string' && body.workspaceId) {
		const { results } = await c.env.DB.prepare("SELECT u.id, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ? AND m.role != 'guest'")
			.bind(body.workspaceId)
			.all<{ id: string; name: string }>();
		if (!results.some((row) => row.id === c.get('user').id)) {
			return fail(c, 404, 'Espace introuvable');
		}
		people = results;
	}
	const result = await aiText(c.env, c.get('user').id, { system: CHAT_SYSTEM, prompt: eventPrompt(text, timezone, now), maxTokens: 500 });
	return result.ok ? c.json(parseEvent(result.value, timezone, people) satisfies AiParsedEvent) : unwrap(c, result);
});
