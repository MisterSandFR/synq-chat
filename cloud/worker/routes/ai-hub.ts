import { Hono } from 'hono';

import { AI_FILE_LIMITS, type PageDraft } from '../../shared/ai-files';
import { AI_HUB_LIMITS, AI_INTENTS, type AiAction, type AiDone, type AiExecuteInput, type AiHubContext, type AiSource, type AiTurnInput, type AiTurnReply } from '../../shared/ai-hub';
import type { CalendarListing } from '../../shared/calendar';
import { CANVAS_MSG, canvasFrame, canvasPath, type CanvasMeta } from '../../shared/canvas';
import type { ListDetail, ListItem, ListSummary } from '../../shared/lists';
import type { MailThreadDetail } from '../../shared/mail';
import type { Message } from '../../shared/types';
import { aiText } from '../ai';
import {
	activeCount,
	cleanDraft,
	cleanName,
	draftFromModel,
	extract,
	fileKey,
	filesPrompt,
	imagesIn,
	insertFile,
	layoutPrompt,
	ownFiles,
	sniff,
	toFile,
	toTemplate,
	wantsLayout,
	type FileRow,
} from '../ai-files';
import { eventPrompt, keywords, parseEvent, transcript, validZone, zonedTime } from '../ai-chat';
import {
	actionTurn,
	conversationDetail,
	federatedSearch,
	HUB_SYSTEM,
	jsonOf,
	listConversations,
	markDone,
	ownConversation,
	pageUpdate,
	parseAbsence,
	parseCards,
	parsePage,
	saveTurns,
	sourceLog,
	startConversation,
} from '../ai-hub';
import { loadActor } from '../grades';
import { fail, readJson, unwrap, workspaceStub, type AppEnv, type Ctx } from '../http';

export const aiHubRoutes = new Hono<AppEnv>();

type Sub<T> = { status: number; data: T | null; res: Response };

// Sous-requête vers les routes existantes avec la session de la personne : mêmes droits, mêmes effets.
async function internal<T>(c: Ctx, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Sub<T>> {
	const { default: app } = await import('../app');
	const headers = new Headers(extra);
	for (const name of ['cookie', 'cf-connecting-ip']) {
		const value = c.req.header(name);
		if (value) {
			headers.set(name, value);
		}
	}
	const raw = body instanceof ArrayBuffer;
	if (raw) {
		headers.set('content-length', String(body.byteLength));
	} else if (body !== undefined) {
		headers.set('content-type', 'application/json');
	}
	const payload = body === undefined ? undefined : raw ? body : JSON.stringify(body);
	const res = await app.fetch(new Request(new URL(`/api${path}`, c.req.url), { method, headers, body: payload }), c.env, c.executionCtx);
	const data = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as T) : null;
	return { status: res.status, data, res };
}

const refused = (c: Ctx, sub: Sub<unknown>, fallback: string) =>
	fail(c, ([400, 403, 404, 409, 413, 429] as const).find((s) => s === sub.status) ?? 404, (sub.data as { error?: string } | null)?.error ?? fallback);

const ID = /^[\w-]{1,64}$/;
const id = (value: unknown) => (typeof value === 'string' && ID.test(value) ? value : null);

function cleanContext(raw: unknown): AiHubContext {
	const ctx = (raw && typeof raw === 'object' ? raw : {}) as Partial<AiHubContext>;
	return {
		workspaceId: id(ctx.workspaceId),
		channelId: id(ctx.channelId),
		threadId: Number.isInteger(ctx.threadId) && ctx.threadId! > 0 ? ctx.threadId! : null,
		mailThreadId: id(ctx.mailThreadId),
		pageId: id(ctx.pageId),
		listId: id(ctx.listId),
		day: typeof ctx.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ctx.day) ? ctx.day : null,
	};
}

type Loaded = { label: string; text: string; sources: AiSource[]; kind: 'channel' | 'mail' | 'page' | 'list' | 'day'; mail?: MailThreadDetail };

const CONTEXT_MAX = 16_000;

async function messageNames(c: Ctx, messages: Message[]): Promise<Map<string, string>> {
	const ids = [...new Set(messages.map((m) => m.userId))].slice(0, 90);
	if (!ids.length) {
		return new Map();
	}
	const { results } = await c.env.DB.prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(', ')})`)
		.bind(...ids)
		.all<{ id: string; name: string }>();
	return new Map(results.map((row) => [row.id, row.name]));
}

// Élément du contexte invisible pour la personne = 404, comme la route qui l'affiche.
async function loadContext(c: Ctx, ctx: AiHubContext, timezone: string): Promise<Loaded | Response | null> {
	if (ctx.mailThreadId) {
		const sub = await internal<MailThreadDetail>(c, 'GET', `/mail/threads/${ctx.mailThreadId}`);
		if (sub.status !== 200 || !sub.data) {
			return refused(c, sub, 'Conversation introuvable');
		}
		const { thread, messages } = sub.data;
		const text = messages.map((m) => `De ${m.fromName || m.fromAddr}, ${new Date(m.date).toISOString().slice(0, 16).replace('T', ' ')} :\n${m.body.slice(0, 4000)}`).join('\n\n');
		return {
			kind: 'mail',
			label: `Mail « ${thread.subject} »`,
			text: `Objet : ${thread.subject}\n\n${text}`.slice(-CONTEXT_MAX),
			sources: [{ kind: 'mail', id: thread.id, title: thread.subject || '(sans objet)', snippet: thread.snippet, href: `/mail?thread=${encodeURIComponent(thread.id)}`, at: thread.lastAt }],
			mail: sub.data,
		};
	}
	const wid = ctx.workspaceId;
	if (wid && ctx.channelId) {
		const actor = await loadActor(c.env.DB, wid, c.get('user').id);
		const stub = workspaceStub(c.env, wid);
		const found = !actor
			? null
			: ctx.threadId
				? await stub.threadView(actor, ctx.threadId).then((r) => (r.ok ? { ok: true as const, value: [r.value.root, ...r.value.replies] } : r))
				: await stub.aiSince(actor, ctx.channelId, 0);
		if (!found?.ok) {
			return fail(c, 404, 'Salon introuvable');
		}
		const messages = found.value;
		return { kind: 'channel', label: ctx.threadId ? 'Fil de discussion' : 'Salon', text: transcript(messages, await messageNames(c, messages), () => '-'), sources: [] };
	}
	if (wid && ctx.pageId) {
		const sub = await internal<CanvasMeta>(c, 'GET', `/w/${wid}/canvases/${ctx.pageId}`);
		if (sub.status !== 200 || !sub.data) {
			return refused(c, sub, 'Page introuvable');
		}
		const page = sub.data;
		return {
			kind: 'page',
			label: `Page « ${page.title} »`,
			text: `Page « ${page.title} » :\n${page.excerpt}`,
			sources: [{ kind: 'page', id: page.id, title: page.title, snippet: page.excerpt, href: `/w/${wid}/canevas/${page.id}`, at: page.updatedAt }],
		};
	}
	if (wid && ctx.listId) {
		const sub = await internal<ListDetail>(c, 'GET', `/w/${wid}/lists/${ctx.listId}`);
		if (sub.status !== 200 || !sub.data) {
			return refused(c, sub, 'Base introuvable');
		}
		const list = sub.data;
		const lines = list.items.slice(0, 200).map((item) => `- ${item.title || 'Sans titre'}${item.description ? ` : ${item.description.slice(0, 300)}` : ''}`);
		return { kind: 'list', label: `Base « ${list.title} »`, text: `Base « ${list.title} » (${list.items.length} éléments) :\n${lines.join('\n')}`.slice(0, CONTEXT_MAX), sources: [] };
	}
	if (ctx.day) {
		const from = zonedTime(ctx.day, '00:00', timezone) ?? Date.parse(`${ctx.day}T00:00:00Z`);
		const sub = await internal<CalendarListing>(c, 'GET', `/calendar/events?from=${from}&to=${from + 86_400_000}`);
		const listing = sub.data;
		const byId = new Map((listing?.events ?? []).map((e) => [e.id, e]));
		const lines = (listing?.occurrences ?? []).map((o) => {
			const event = byId.get(o.eventId);
			const time = new Intl.DateTimeFormat('fr-FR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(o.startsAt);
			return event ? `- ${event.allDay ? 'Toute la journée' : time} : ${event.title}${event.location ? ` (${event.location})` : ''}` : '';
		});
		return { kind: 'day', label: `Journée du ${ctx.day}`, text: `Agenda du ${ctx.day} :\n${lines.filter(Boolean).join('\n') || 'Aucun événement.'}`, sources: [] };
	}
	return null;
}

const NOTHING = 'Je n’ai rien trouvé à ce sujet dans ce que tu peux voir : messages, mails, événements, pages et bases.';

type Answer = { text: string; sources: AiSource[]; action: AiAction | null };

async function chooseList(c: Ctx, wid: string, listId: string | null): Promise<ListDetail | Response> {
	let target = listId;
	if (!target) {
		const sub = await internal<ListSummary[]>(c, 'GET', `/w/${wid}/lists`);
		target = sub.data?.[0]?.id ?? null;
		if (!target) {
			return fail(c, 400, 'Aucune base dans cet espace : crée-en une d’abord');
		}
	}
	const sub = await internal<ListDetail>(c, 'GET', `/w/${wid}/lists/${target}`);
	if (sub.status !== 200 || !sub.data) {
		return refused(c, sub, 'Base introuvable');
	}
	return sub.data.canEdit ? sub.data : fail(c, 403, 'Permission insuffisante');
}

type Ask = (prompt: string, maxTokens?: number) => ReturnType<typeof aiText>;

async function layoutAnswer(c: Ctx, ask: Ask, input: { ctx: AiHubContext; text: string; files: FileRow[]; adjust: PageDraft | null; material: string; loaded: Loaded | null }): Promise<Answer | Response> {
	const wid = input.ctx.workspaceId;
	if (!wid) {
		return fail(c, 400, 'Ouvre un espace pour y créer la page');
	}
	if (!input.files.length && !input.loaded && !input.adjust) {
		return fail(c, 400, 'Joins des fichiers à mettre en page');
	}
	const images = input.files.filter((f) => f.kind === 'image');
	const result = await ask(layoutPrompt({ material: input.material, images, instruction: input.text, previous: input.adjust }), 4000);
	if (!result.ok) {
		return unwrap(c, result);
	}
	const draft = draftFromModel(result.value, images.map((f) => f.id));
	if (!draft) {
		return { text: 'Je n’ai pas réussi à mettre ce contenu en page. Réessaie, avec une consigne plus précise si besoin.', sources: [], action: null };
	}
	return {
		text: input.adjust ? `Page ajustée : « ${draft.title} ». Vérifie l’aperçu puis crée-la.` : `Proposition de page « ${draft.title} ». Vérifie l’aperçu, ajuste-la ou crée-la.`,
		sources: input.loaded?.sources ?? [],
		action: { kind: 'layout', workspaceId: wid, draft, files: input.files.map((f) => f.id), parentId: null, categoryId: null },
	};
}

async function answer(
	c: Ctx,
	input: { text: string; intent: AiTurnInput['intent']; ctx: AiHubContext; timezone: string; listId: string | null; files: FileRow[]; adjust: PageDraft | null },
): Promise<Answer | Response> {
	const userId = c.get('user').id;
	const ask: Ask = (prompt, maxTokens = 1200) => aiText(c.env, userId, { system: HUB_SYSTEM, prompt, maxTokens });
	const loaded = await loadContext(c, input.ctx, input.timezone);
	if (loaded instanceof Response) {
		return loaded;
	}
	const instruction = input.text ? `\n\n=== Consigne de la personne ===\n${input.text}` : '';
	const context = loaded ? `=== Contexte : ${loaded.label} ===\n${loaded.text}\n\n` : '';
	const files = input.files;
	const attached = files.length ? `=== Fichiers joints ===\n${filesPrompt(files)}\n\n` : '';

	if (input.intent === 'layout' || (input.intent === 'ask' && files.length && wantsLayout(input.text))) {
		return layoutAnswer(c, ask, { ctx: input.ctx, text: input.text, files, adjust: input.adjust, material: `${files.length ? context.slice(0, 6000) : context}${attached}`, loaded });
	}
	if (input.intent === 'compare') {
		if (files.length < 2) {
			return fail(c, 400, 'Joins au moins deux fichiers à comparer');
		}
		const result = await ask(`${attached}=== Tâche ===\nCompare ces fichiers : points communs, différences importantes (chiffres, dates, conditions), puis ce qu’il faut retenir. Puces commençant par « - », en nommant les fichiers.${instruction}`, 1500);
		return result.ok ? { text: result.value, sources: [], action: null } : unwrap(c, result);
	}
	if (input.intent === 'summarize' && files.length) {
		const several = files.length > 1;
		const result = await ask(
			`${attached}=== Tâche ===\nRésume ${several ? 'chacun de ces fichiers : son nom, puis' : 'ce fichier en'} 3 à 6 puces commençant par « - » (sujet, points clés, chiffres, décisions, actions).${several ? ' Termine par une ligne de synthèse commune.' : ''}${instruction}`,
			1500,
		);
		return result.ok ? { text: result.value, sources: [], action: null } : unwrap(c, result);
	}
	if (input.intent === 'ask' && files.length) {
		const result = await ask(
			`${context.slice(0, 6000)}${attached}=== Question ===\n${input.text}\n\n=== Tâche ===\nRéponds à partir des fichiers joints et du contexte uniquement, en nommant le fichier d’où vient chaque information. Si rien ne permet de répondre, dis-le.`,
			1500,
		);
		return result.ok ? { text: result.value, sources: loaded?.sources ?? [], action: null } : unwrap(c, result);
	}
	if (input.intent === 'ask') {
		const sources = await federatedSearch(c.env, userId, input.text, keywords(input.text), input.ctx.workspaceId);
		if (!sources.length && !loaded) {
			return { text: NOTHING, sources: [], action: null };
		}
		const result = await ask(
			`${context.slice(0, 6000)}=== Sources trouvées ===\n${sourceLog(sources) || 'Aucune.'}\n\n=== Question ===\n${input.text}\n\n=== Tâche ===\nRéponds à partir du contexte et des sources uniquement, en citant les sources par leur numéro entre crochets, par exemple [2]. Si rien ne permet de répondre, dis-le.`,
		);
		return result.ok ? { text: result.value, sources, action: null } : unwrap(c, result);
	}
	if (input.intent === 'summarize') {
		if (!loaded) {
			return fail(c, 400, 'Ouvre un salon, un mail, une page, une base ou un jour du calendrier à résumer');
		}
		const result = await ask(`${context}=== Tâche ===\nRésume ce contenu en 3 à 8 puces commençant par « - » : sujet, décisions, questions ouvertes, actions et qui s’en charge.${instruction}`);
		return result.ok ? { text: result.value, sources: loaded.sources, action: null } : unwrap(c, result);
	}
	if (input.intent === 'cards') {
		const wid = input.ctx.workspaceId;
		if (!wid || (!files.length && (!loaded || (loaded.kind !== 'channel' && loaded.kind !== 'mail')))) {
			return fail(c, 400, 'Ouvre un salon, un fil ou un mail, ou joins des fichiers, pour en tirer des cartes');
		}
		const list = await chooseList(c, wid, input.listId ?? input.ctx.listId);
		if (list instanceof Response) {
			return list;
		}
		const result = await ask(
			`${files.length ? attached : context}=== Tâche ===\nExtrais les tâches à faire de ce contenu (au plus ${AI_HUB_LIMITS.cards}). Renvoie uniquement un objet JSON : {"cards":[{"title":"verbe à l’infinitif, court","description":"détails utiles, qui, quand"}]}.${instruction}`,
		);
		if (!result.ok) {
			return unwrap(c, result);
		}
		const cards = parseCards(result.value);
		if (!cards.length) {
			return { text: 'Je n’ai trouvé aucune tâche à transformer en carte.', sources: loaded?.sources ?? [], action: null };
		}
		return {
			text: `${cards.length} carte${cards.length > 1 ? 's' : ''} proposée${cards.length > 1 ? 's' : ''} pour la base « ${list.title} ». Vérifie puis confirme.`,
			sources: loaded?.sources ?? [],
			action: { kind: 'cards', workspaceId: wid, listId: list.id, listTitle: list.title, cards },
		};
	}
	if (input.intent === 'event') {
		const result = await ask(eventPrompt(`${input.text}\n\n${loaded?.text.slice(-4000) ?? ''}`.trim(), input.timezone, Date.now()), 500);
		if (!result.ok) {
			return unwrap(c, result);
		}
		const event = { ...parseEvent(result.value, input.timezone, []), workspaceId: null };
		if (!event.title || !event.startsAt) {
			return { text: 'Je n’ai pas compris la date ou le titre de l’événement. Précise-les.', sources: [], action: null };
		}
		return { text: 'Voici l’événement proposé. Vérifie puis confirme.', sources: loaded?.sources ?? [], action: { kind: 'event', event } };
	}
	if (input.intent === 'page') {
		const wid = input.ctx.workspaceId;
		if (!wid) {
			return fail(c, 400, 'Ouvre un espace pour y créer la page');
		}
		const result = await ask(
			`${context}=== Tâche ===\nRédige une page de compte-rendu en markdown simple : première ligne « # Titre », puis des sections « ## » (Contexte, Décisions, Actions) avec des puces « - ». N'invente rien.${instruction}`,
			2000,
		);
		if (!result.ok) {
			return unwrap(c, result);
		}
		const page = parsePage(result.value);
		return { text: `Brouillon de page « ${page.title} ». Vérifie puis confirme pour la créer.`, sources: loaded?.sources ?? [], action: { kind: 'page', workspaceId: wid, ...page } };
	}
	if (input.intent === 'mail_reply') {
		const mail = loaded?.mail;
		if (!mail) {
			return fail(c, 400, 'Ouvre un mail pour y répondre');
		}
		if (!mail.access.reply) {
			return fail(c, 403, 'Permission insuffisante');
		}
		const result = await ask(`${context}=== Tâche ===\nRédige une réponse à ce mail, courte et polie, dans la langue du mail. Renvoie seulement le corps du message.${instruction}`, 1200);
		if (!result.ok) {
			return unwrap(c, result);
		}
		const last = [...mail.messages].reverse().find((m) => m.direction === 'in') ?? mail.messages[mail.messages.length - 1];
		const subject = /^re\s*:/i.test(mail.thread.subject) ? mail.thread.subject : `Re: ${mail.thread.subject}`;
		return {
			text: 'Brouillon de réponse prêt. Vérifie puis confirme pour l’enregistrer dans tes brouillons.',
			sources: loaded!.sources,
			action: { kind: 'mail_reply', mailboxId: mail.thread.mailboxId, threadId: mail.thread.id, subject, to: last?.fromAddr ?? '', text: result.value },
		};
	}
	const today = new Intl.DateTimeFormat('en-CA', { timeZone: input.timezone }).format(Date.now());
	const result = await ask(
		`=== Demande ===\n${input.text}\n\n=== Tâche ===\nNous sommes le ${today} (fuseau ${input.timezone}). Renvoie uniquement un objet JSON : {"kind":"leave|sick|remote|travel|training|other","startDay":"AAAA-MM-JJ","startHalf":"am|pm","endDay":"AAAA-MM-JJ","endHalf":"am|pm","note":"…"}. leave = congé, remote = télétravail, travel = déplacement.`,
		300,
	);
	if (!result.ok) {
		return unwrap(c, result);
	}
	const absence = parseAbsence(result.value, userId);
	if (!absence.startDay || !jsonOf(result.value)) {
		return { text: 'Je n’ai pas compris les dates de l’absence. Précise-les, par exemple « congé du 3 au 7 novembre ».', sources: [], action: null };
	}
	return { text: 'Voici l’absence proposée. Vérifie puis confirme.', sources: [], action: { kind: 'absence', absence } };
}

aiHubRoutes.get('/ai/hub/conversations', async (c) => c.json(await listConversations(c.env.DB, c.get('user').id)));

aiHubRoutes.get('/ai/hub/conversations/:id', async (c) => {
	const conversation = await ownConversation(c.env.DB, c.get('user').id, c.req.param('id'));
	return conversation ? c.json(await conversationDetail(c.env.DB, conversation)) : fail(c, 404, 'Conversation introuvable');
});

aiHubRoutes.delete('/ai/hub/conversations/:id', async (c) => {
	const result = await c.env.DB.prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?').bind(c.req.param('id'), c.get('user').id).run();
	return result.meta.changes ? c.json({ ok: true }) : fail(c, 404, 'Conversation introuvable');
});

const INTENT_TITLE: Record<AiTurnInput['intent'], string> = {
	ask: '',
	summarize: 'Résumer',
	cards: 'Créer des cartes',
	event: 'Créer un événement',
	page: 'Rédiger une page',
	mail_reply: 'Répondre au mail',
	absence: 'Poser une absence',
	layout: 'Mettre en page',
	compare: 'Comparer les fichiers',
};

aiHubRoutes.post('/ai/hub/turns', async (c) => {
	const body = await readJson<AiTurnInput>(c);
	const intent = AI_INTENTS.find((i) => i === body.intent) ?? null;
	if (!intent) {
		return fail(c, 400, 'Intention invalide');
	}
	const text = typeof body.text === 'string' ? body.text.trim().slice(0, AI_HUB_LIMITS.text) : '';
	if ((intent === 'ask' || intent === 'absence') && text.length < 3) {
		return fail(c, 400, 'Message trop court');
	}
	const userId = c.get('user').id;
	const existing = typeof body.conversationId === 'string' ? await ownConversation(c.env.DB, userId, body.conversationId) : null;
	if (body.conversationId && !existing) {
		return fail(c, 404, 'Conversation introuvable');
	}
	const timezone = typeof body.timezone === 'string' && validZone(body.timezone) ? body.timezone : 'UTC';
	const fileIds = Array.isArray(body.files) ? [...new Set(body.files.map(id).filter((v): v is string => v !== null))] : [];
	if (fileIds.length > AI_FILE_LIMITS.files) {
		return fail(c, 400, `${AI_FILE_LIMITS.files} fichiers au plus`);
	}
	const files = await ownFiles(c.env.DB, userId, fileIds, Date.now());
	if (!files) {
		return fail(c, 404, 'Fichier introuvable ou expiré : joins-le de nouveau');
	}
	const previous = existing && Number.isInteger(body.adjust) ? await actionTurn(c.env.DB, existing.id, body.adjust!) : null;
	const adjust = previous?.action?.kind === 'layout' ? previous.action.draft : null;
	const reply = await answer(c, { text, intent, ctx: cleanContext(body.context), timezone, listId: id(body.listId), files, adjust });
	if (reply instanceof Response) {
		return reply;
	}
	const question = text || (files.length ? `${INTENT_TITLE[intent] || 'Question'} : ${files.map((f) => f.name).join(', ')}` : INTENT_TITLE[intent]);
	const now = Date.now();
	const conversation = existing ?? (await startConversation(c.env.DB, userId, question, now));
	const turns = await saveTurns(c.env.DB, conversation, question, reply, now);
	return c.json({ conversation: { ...conversation, updatedAt: now }, turns } satisfies AiTurnReply);
});

const cleanCards = (raw: unknown) =>
	(Array.isArray(raw) ? raw : [])
		.map((card: { title?: unknown; description?: unknown }) => ({
			title: typeof card?.title === 'string' ? card.title.trim().slice(0, AI_HUB_LIMITS.cardTitle) : '',
			description: typeof card?.description === 'string' ? card.description.trim().slice(0, 2000) : '',
		}))
		.filter((card) => card.title)
		.slice(0, AI_HUB_LIMITS.cards);

// Chaque écriture passe par la route existante : un droit manquant y est refusé comme depuis l'interface.
async function execute(c: Ctx, action: AiAction): Promise<AiDone | Response> {
	if (action.kind === 'cards') {
		const wid = id(action.workspaceId);
		const lid = id(action.listId);
		const cards = cleanCards(action.cards);
		if (!wid || !lid || !cards.length) {
			return fail(c, 400, 'Cartes invalides');
		}
		for (const card of cards) {
			const created = await internal<ListItem>(c, 'POST', `/w/${wid}/lists/${lid}/items`, { title: card.title });
			if (created.status !== 201 || !created.data) {
				return refused(c, created, 'Base introuvable');
			}
			if (card.description) {
				await internal(c, 'PATCH', `/w/${wid}/lists/${lid}/items/${created.data.id}`, { description: card.description });
			}
		}
		return { label: `${cards.length} carte${cards.length > 1 ? 's' : ''} créée${cards.length > 1 ? 's' : ''} dans « ${action.listTitle} »`, href: `/w/${wid}/listes/${lid}` };
	}
	if (action.kind === 'event') {
		const created = await internal<{ id: string }>(c, 'POST', '/calendar/events', action.event);
		return created.status === 201 ? { label: 'Événement créé', href: '/calendrier' } : refused(c, created, 'Événement invalide');
	}
	if (action.kind === 'page') {
		const wid = id(action.workspaceId);
		const title = typeof action.title === 'string' ? action.title : '';
		const body = typeof action.body === 'string' ? action.body.slice(0, AI_HUB_LIMITS.pageBody) : '';
		if (!wid) {
			return fail(c, 400, 'Espace requis');
		}
		const created = await internal<CanvasMeta>(c, 'POST', `/w/${wid}/canvases`, { title });
		if (created.status !== 201 || !created.data) {
			return refused(c, created, 'Espace introuvable');
		}
		if (body.trim()) {
			const socket = await internal(c, 'GET', `/w/${wid}/canvases/${created.data.id}/ws`, undefined, { Upgrade: 'websocket' });
			const ws = socket.res.webSocket;
			if (ws) {
				ws.accept();
				ws.send(canvasFrame(CANVAS_MSG.update, pageUpdate(body)));
				ws.close(1000, 'ok');
			}
		}
		return { label: `Page « ${created.data.title} » créée`, href: `/w/${wid}/canevas/${created.data.id}` };
	}
	if (action.kind === 'mail_reply') {
		const to = typeof action.to === 'string' ? action.to.trim() : '';
		const saved = await internal(c, 'PUT', `/mail/drafts/${crypto.randomUUID()}`, {
			mailboxId: action.mailboxId,
			threadId: action.threadId,
			to: to ? [{ name: '', addr: to }] : [],
			cc: [],
			bcc: [],
			forwardOf: null,
			subject: typeof action.subject === 'string' ? action.subject : '',
			text: typeof action.text === 'string' ? action.text : '',
			attachments: [],
		});
		return saved.status < 300 ? { label: 'Brouillon de réponse enregistré', href: `/mail?thread=${encodeURIComponent(String(action.threadId))}` } : refused(c, saved, 'Boîte introuvable');
	}
	if (action.kind === 'absence') {
		const created = await internal(c, 'POST', '/absences', { ...action.absence, userId: c.get('user').id });
		return created.status < 300 ? { label: 'Absence posée', href: '/calendrier' } : refused(c, created, 'Absence invalide');
	}
	if (action.kind === 'layout') {
		return executeLayout(c, action);
	}
	return fail(c, 400, 'Action inconnue');
}

// Page créée par la route existante, images copiées par la route des fichiers de page : droits de la personne partout.
async function executeLayout(c: Ctx, action: Extract<AiAction, { kind: 'layout' }>): Promise<AiDone | Response> {
	const userId = c.get('user').id;
	const wid = id(action.workspaceId);
	const ids = (Array.isArray(action.files) ? action.files : []).map(id).filter((v): v is string => v !== null).slice(0, AI_FILE_LIMITS.files);
	const files = await ownFiles(c.env.DB, userId, ids, Date.now());
	if (!files) {
		return fail(c, 404, 'Fichier expiré : joins-le de nouveau');
	}
	const images = files.filter((f) => f.kind === 'image');
	const draft = cleanDraft(action.draft, images.map((f) => f.id));
	if (!wid || !draft) {
		return fail(c, 400, 'Page invalide');
	}
	const created = await internal<CanvasMeta>(c, 'POST', `/w/${wid}/canvases`, { title: draft.title, icon: draft.icon, parentId: id(action.parentId), categoryId: id(action.categoryId) });
	if (created.status !== 201 || !created.data) {
		return refused(c, created, 'Espace introuvable');
	}
	const page = created.data;
	const used = imagesIn(draft.blocks);
	const urls = new Map<string, { src: string; alt: string }>();
	for (const file of images.filter((f) => used.has(f.id))) {
		const object = await c.env.FILES.get(fileKey(userId, file.id));
		if (!object) {
			continue;
		}
		const sent = await internal<{ url: string }>(c, 'POST', `/w/${wid}/canvases/${page.id}/files?name=${encodeURIComponent(file.name)}`, await object.arrayBuffer(), { 'Content-Type': file.type });
		if (sent.status === 201 && sent.data) {
			urls.set(file.id, { src: sent.data.url, alt: file.name });
		}
	}
	if (draft.cover) {
		await internal(c, 'PATCH', `/w/${wid}/canvases/${page.id}`, { cover: draft.cover });
	}
	await c.env.CANVAS_DOC.getByName(page.id).seed(page.id, page.title, toTemplate(draft.blocks, urls));
	return { label: `Page « ${page.title} » créée`, href: canvasPath(wid, page.id) };
}

aiHubRoutes.post('/ai/hub/execute', async (c) => {
	const body = await readJson<AiExecuteInput>(c);
	const userId = c.get('user').id;
	const conversation = typeof body.conversationId === 'string' ? await ownConversation(c.env.DB, userId, body.conversationId) : null;
	const turn = conversation && Number.isInteger(body.turnId) ? await actionTurn(c.env.DB, conversation.id, body.turnId!) : null;
	if (!turn?.action) {
		return fail(c, 404, 'Action introuvable');
	}
	if (turn.done) {
		return fail(c, 409, 'Action déjà effectuée');
	}
	// Aperçu modifiable par la personne, mais pas son type.
	const action = body.action && typeof body.action === 'object' && body.action.kind === turn.action.kind ? body.action : turn.action;
	const done = await execute(c, action);
	if (done instanceof Response) {
		return done;
	}
	await markDone(c.env.DB, turn.id, action, done);
	return c.json(done);
});

// --- Fichiers joints ---

const REFUSED_TYPE = 'Type de fichier refusé : PDF, Word, Excel, OpenDocument, CSV, texte, Markdown, HTML ou image PNG, JPEG, WebP';

aiHubRoutes.post('/ai/hub/files', async (c) => {
	const userId = c.get('user').id;
	const size = Number(c.req.header('Content-Length'));
	if (!Number.isInteger(size) || size <= 0) {
		return fail(c, 400, 'Fichier vide ou taille inconnue');
	}
	if (size > AI_FILE_LIMITS.size) {
		return fail(c, 413, 'Fichier trop lourd (20 Mo max)');
	}
	let raw = '';
	try {
		raw = decodeURIComponent(c.req.header('X-File-Name') ?? '');
	} catch {
		// Nom mal encodé : remplacé par défaut.
	}
	const name = cleanName(raw);
	const now = Date.now();
	if ((await activeCount(c.env.DB, userId, now)) >= AI_FILE_LIMITS.active) {
		return fail(c, 429, 'Trop de fichiers envoyés ces dernières 24 h');
	}
	const bytes = await c.req.arrayBuffer();
	if (bytes.byteLength > AI_FILE_LIMITS.size) {
		return fail(c, 413, 'Fichier trop lourd (20 Mo max)');
	}
	const sniffed = sniff(name, new Uint8Array(bytes));
	if (!sniffed) {
		return fail(c, 400, REFUSED_TYPE);
	}
	const { success } = await c.env.AUTH_LIMITER.limit({ key: `ai:${userId}` });
	if (!success) {
		return fail(c, 429, 'Trop de demandes à l’IA, réessaie dans une minute');
	}
	let extracted = { markdown: '', truncated: false };
	try {
		extracted = await extract(c.env, name, sniffed, bytes);
	} catch (error) {
		console.error(JSON.stringify({ level: 'error', message: 'ai-files', error: String(error) }));
		// Une image sans description reste utilisable telle quelle dans la page.
		if (sniffed.kind !== 'image') {
			return fail(c, 400, 'Impossible de lire ce fichier');
		}
	}
	const row: FileRow = {
		id: crypto.randomUUID(),
		user_id: userId,
		name,
		kind: sniffed.kind,
		type: sniffed.type,
		size: bytes.byteLength,
		markdown: extracted.markdown,
		truncated: extracted.truncated ? 1 : 0,
		created_at: now,
		expires_at: now + AI_FILE_LIMITS.ttl,
	};
	await c.env.FILES.put(fileKey(userId, row.id), bytes, { httpMetadata: { contentType: row.type }, customMetadata: { name, expiresAt: String(row.expires_at) } });
	await insertFile(c.env.DB, row);
	return c.json(toFile(row), 201);
});

// Jamais public : propriétaire seul, contenu neutralisé (pas de rendu HTML, pas de script).
aiHubRoutes.get('/ai/hub/files/:id', async (c) => {
	const userId = c.get('user').id;
	const [row] = (await ownFiles(c.env.DB, userId, [c.req.param('id')], Date.now())) ?? [];
	const object = row ? await c.env.FILES.get(fileKey(userId, row.id)) : null;
	if (!row || !object) {
		return fail(c, 404, 'Fichier introuvable ou expiré');
	}
	return new Response(object.body, {
		headers: {
			'Content-Type': row.kind === 'image' ? row.type : 'application/octet-stream',
			'Content-Disposition': `${row.kind === 'image' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
			'Cache-Control': 'private, max-age=3600',
			'Content-Security-Policy': "default-src 'none'; sandbox",
			'X-Content-Type-Options': 'nosniff',
		},
	});
});

aiHubRoutes.delete('/ai/hub/files/:id', async (c) => {
	const userId = c.get('user').id;
	const fid = id(c.req.param('id'));
	const result = fid ? await c.env.DB.prepare('DELETE FROM ai_files WHERE id = ? AND user_id = ?').bind(fid, userId).run() : null;
	if (!fid || !result?.meta.changes) {
		return fail(c, 404, 'Fichier introuvable');
	}
	await c.env.FILES.delete(fileKey(userId, fid));
	return c.json({ ok: true });
});
