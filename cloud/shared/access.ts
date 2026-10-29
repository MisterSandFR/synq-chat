export type AccessLevel = 'view' | 'comment' | 'edit' | 'manage';
export type AccessKind = 'page' | 'page_category' | 'base';

export const ACCESS_LEVELS: AccessLevel[] = ['view', 'comment', 'edit', 'manage'];
export const ACCESS_KINDS: AccessKind[] = ['page', 'page_category', 'base'];

export const LEVEL_LABELS: Record<AccessLevel, string> = {
	view: 'Peut voir',
	comment: 'Peut commenter',
	edit: 'Peut modifier',
	manage: 'Accès complet',
};

export const LEVEL_HINTS: Record<AccessLevel, string> = {
	view: 'Lire seulement',
	comment: 'Lire et commenter',
	edit: 'Modifier le contenu',
	manage: 'Modifier, supprimer et partager',
};

export const ACCESS_LIMITS = { rules: 100, categoryName: 80, categories: 50 };

export const levelRank = (level: AccessLevel | null | undefined) => (level ? ACCESS_LEVELS.indexOf(level) + 1 : 0);
export const atLeast = (level: AccessLevel | null | undefined, need: AccessLevel) => levelRank(level) >= levelRank(need);
export const maxLevel = (a: AccessLevel | null, b: AccessLevel | null) => (levelRank(a) >= levelRank(b) ? a : b);
export const isAccessLevel = (value: unknown): value is AccessLevel => ACCESS_LEVELS.includes(value as AccessLevel);

export type AccessRule = { subjectId: string; level: AccessLevel };

// D'où une ressource sans accès propres tient ses droits.
export type AccessSource = { kind: 'page' | 'page_category'; id: string; title: string } | { kind: 'space' };

export type AccessInfo = {
	level: AccessLevel;
	own: boolean;
	restricted: boolean;
	// Règles propres, ou celles de la source héritée.
	rules: AccessRule[];
	inherited: AccessSource | null;
	count: number;
};

export type AccessUpdate = { inherit: true } | { restricted: boolean; rules: AccessRule[] };

export type PageCategory = {
	id: string;
	workspaceId: string;
	name: string;
	icon: string | null;
	position: number;
	restricted: boolean;
	createdBy: string;
	level: AccessLevel;
};
