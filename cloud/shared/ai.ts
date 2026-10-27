export type RewriteAction = 'reformuler' | 'corriger' | 'raccourcir' | 'developper' | 'formel' | 'chaleureux' | 'traduire_en' | 'traduire_fr' | 'continuer';

export interface AiRewriteInput {
	action: RewriteAction;
	text: string;
	context?: string;
	instruction?: string;
}

export interface AiTextResult {
	text: string;
}

export const AI_LIMITS = { text: 8000, context: 8000, instruction: 500 } as const;
