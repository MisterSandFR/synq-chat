import { err, ok, type Result } from './result';

export const AI_MODEL = '@cf/zai-org/glm-4.7-flash';

export interface AiTask {
	system: string;
	prompt: string;
	maxTokens?: number;
}

type AiOutput = { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };

// Remplaçable en test, comme transport.open.
export const aiRunner = {
	async run(env: Env, task: AiTask): Promise<string> {
		const runner = env.AI as unknown as { run(model: string, input: unknown): Promise<AiOutput> } | undefined;
		if (!runner) {
			throw new Error('IA non configurée');
		}
		const out = await runner.run(AI_MODEL, {
			messages: [
				{ role: 'system', content: task.system },
				{ role: 'user', content: task.prompt },
			],
			max_tokens: task.maxTokens ?? 800,
			// Sans raisonnement : 1 s au lieu de 10 pour une réécriture, qualité équivalente.
			chat_template_kwargs: { enable_thinking: false },
		});
		const text = typeof out?.response === 'string' ? out.response : out?.choices?.[0]?.message?.content;
		return typeof text === 'string' ? text.replace(/<think>[\s\S]*?<\/think>/g, '').trim() : '';
	},
};

// Limite de débit par utilisateur incluse ; erreurs en Result (429 trop d'appels, 503 IA indisponible).
export async function aiText(env: Env, userId: string, task: AiTask): Promise<Result<string>> {
	const { success } = await env.AUTH_LIMITER.limit({ key: `ai:${userId}` });
	if (!success) {
		return err(429, 'Trop de demandes à l’IA, réessaie dans une minute');
	}
	try {
		const text = await aiRunner.run(env, task);
		return text ? ok(text) : err(503, 'IA indisponible : réponse vide');
	} catch (error) {
		console.error(JSON.stringify({ level: 'error', message: 'ai', error: String(error) }));
		return err(503, 'IA indisponible');
	}
}
