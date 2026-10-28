import type { AccessLevel } from './access';

export type ListColumnType = 'text' | 'status' | 'person' | 'date' | 'checkbox' | 'number' | 'link' | 'priority';

export const LIST_COLUMN_TYPES: ReadonlyArray<{ id: ListColumnType; label: string }> = [
	{ id: 'text', label: 'Texte' },
	{ id: 'status', label: 'Statut' },
	{ id: 'person', label: 'Personne' },
	{ id: 'date', label: 'Date' },
	{ id: 'checkbox', label: 'Case à cocher' },
	{ id: 'number', label: 'Nombre' },
	{ id: 'link', label: 'Lien' },
	{ id: 'priority', label: 'Priorité' },
];

export interface ListOption {
	id: string;
	label: string;
	color: string;
}

export interface ListColumn {
	id: string;
	name: string;
	type: ListColumnType;
	// Statut seulement.
	options?: ListOption[];
	width?: number;
}

export type ListValue = string | number | boolean;

export interface ListSummary {
	id: string;
	workspaceId: string;
	channelId: string | null;
	title: string;
	description: string;
	createdBy: string;
	createdAt: number;
	updatedAt: number;
	itemCount: number;
}

export interface ListItem {
	id: string;
	listId: string;
	position: number;
	title: string;
	description: string;
	values: Record<string, ListValue>;
	createdBy: string;
	createdAt: number;
	updatedAt: number;
	comments: number;
	labels: string[];
	// Couleur « #rrggbb » ou image jointe « file:<id> ».
	cover: string | null;
	startDate: string | null;
	dueDate: string | null;
	done: boolean;
	checks: { done: number; total: number };
	attachments: number;
	pageId: string | null;
	icon: string;
	coverMode: CoverMode;
	// Position verticale du recadrage, en pourcentage.
	coverY: number;
	members: string[];
	startTime: string | null;
	dueTime: string | null;
	reminder: CardReminder | null;
	estimate: number | null;
	estimateUnit: EstimateUnit;
	archivedAt: number | null;
	template: boolean;
}

export interface ListDetail extends ListSummary {
	columns: ListColumn[];
	labels: ListLabel[];
	views: ListSavedView[];
	items: ListItem[];
	canEdit: boolean;
	canDelete: boolean;
	level: AccessLevel;
}

export interface ListComment {
	id: string;
	itemId: string;
	userId: string;
	body: string;
	createdAt: number;
	reactions: CommentReaction[];
}

export interface ListActivity {
	id: number;
	userId: string;
	action: string;
	createdAt: number;
	changes: ActivityChange[];
}

export interface ListItemDetail {
	item: ListItem;
	comments: ListComment[];
	activity: ListActivity[];
	checklists: Checklist[];
	files: ListAttachment[];
	links: CardLink[];
	following: boolean;
}

export type ListTemplate = 'blank' | 'project' | 'bugs' | 'roadmap' | 'content' | 'requests' | 'hiring';

export const STATUS_COLORS = ['#8a8d96', '#2563eb', '#d97706', '#7c3aed', '#1f9d57', '#c93636', '#0f8a8a', '#c0266d'] as const;

export const PRIORITIES: ReadonlyArray<ListOption> = [
	{ id: 'urgent', label: 'Urgente', color: '#c93636' },
	{ id: 'high', label: 'Haute', color: '#d97706' },
	{ id: 'medium', label: 'Moyenne', color: '#2563eb' },
	{ id: 'low', label: 'Basse', color: '#8a8d96' },
];

const status = (labels: string[]): ListOption[] => labels.map((label, i) => ({ id: `s${i + 1}`, label, color: STATUS_COLORS[i % STATUS_COLORS.length]! }));

type TemplateView = { name: string; kind: ListViewKind; config?: Partial<ViewConfig> };
type TemplateRule = { trigger: RuleTrigger; action: RuleAction };

const labels = (names: Array<[string, string]>): ListLabel[] => names.map(([name, color], i) => ({ id: `l${i + 1}`, name, color }));

// Identifiants stables : les modèles ne dépendent pas d'un générateur.
export const LIST_TEMPLATES: Record<ListTemplate, { label: string; hint: string; title: string; columns: ListColumn[]; views: TemplateView[]; labels?: ListLabel[]; rules?: TemplateRule[] }> = {
	blank: { label: 'Base vide', hint: 'Partir de zéro et ajouter ses colonnes.', title: 'Nouvelle base', columns: [], views: [{ name: 'Tableau', kind: 'table' }] },
	project: {
		label: 'Kanban projet',
		hint: 'Tâches en colonnes, responsables, échéances et checklists.',
		title: 'Suivi de projet',
		columns: [
			{ id: 'status', name: 'Statut', type: 'status', options: [...status(['À faire', 'En cours', 'En revue', 'Terminé'])] },
			{ id: 'owner', name: 'Responsable', type: 'person' },
			{ id: 'due', name: 'Échéance', type: 'date' },
			{ id: 'priority', name: 'Priorité', type: 'priority' },
		],
		views: [
			{ name: 'Kanban', kind: 'board' },
			{ name: 'Tableau', kind: 'table' },
		],
		labels: labels([
			['Design', '#7c3aed'],
			['Front', '#2563eb'],
			['Back', '#0f8a8a'],
			['Bloqué', '#c93636'],
		]),
		rules: [{ trigger: { kind: 'status', column: 'status', option: 's4' }, action: { kind: 'done' } }],
	},
	bugs: {
		label: 'Suivi de bugs',
		hint: 'Signalements, gravité et correctifs.',
		title: 'Bugs',
		columns: [
			{ id: 'status', name: 'Statut', type: 'status', options: status(['Nouveau', 'Confirmé', 'En cours', 'Corrigé', 'Fermé']) },
			{ id: 'priority', name: 'Priorité', type: 'priority' },
			{ id: 'assignee', name: 'Assigné à', type: 'person' },
			{ id: 'link', name: 'Lien', type: 'link' },
			{ id: 'reported', name: 'Signalé le', type: 'date' },
		],
		views: [
			{ name: 'Tableau', kind: 'table' },
			{ name: 'Kanban', kind: 'board' },
		],
		labels: labels([
			['Régression', '#c93636'],
			['Interface', '#2563eb'],
			['Performance', '#d97706'],
		]),
		rules: [{ trigger: { kind: 'status', column: 'status', option: 's4' }, action: { kind: 'done' } }],
	},
	roadmap: {
		label: 'Roadmap',
		hint: 'Chantiers sur une chronologie, du début à l’échéance.',
		title: 'Roadmap',
		columns: [
			{ id: 'status', name: 'Statut', type: 'status', options: status(['Idée', 'Planifié', 'En cours', 'Livré']) },
			{ id: 'owner', name: 'Responsable', type: 'person' },
		],
		views: [
			{ name: 'Chronologie', kind: 'timeline' },
			{ name: 'Tableau', kind: 'table' },
		],
		labels: labels([
			['Produit', '#7c3aed'],
			['Technique', '#0f8a8a'],
			['Marketing', '#c0266d'],
		]),
		rules: [{ trigger: { kind: 'status', column: 'status', option: 's4' }, action: { kind: 'done' } }],
	},
	content: {
		label: 'Contenus',
		hint: 'Calendrier éditorial, auteurs et canaux de diffusion.',
		title: 'Calendrier éditorial',
		columns: [
			{ id: 'status', name: 'Statut', type: 'status', options: status(['Idée', 'Rédaction', 'Relecture', 'Publié']) },
			{ id: 'author', name: 'Auteur', type: 'person' },
			{ id: 'channel', name: 'Canal', type: 'status', options: status(['Blog', 'Newsletter', 'Réseaux sociaux']) },
		],
		views: [
			{ name: 'Calendrier', kind: 'calendar' },
			{ name: 'Kanban', kind: 'board' },
			{ name: 'Galerie', kind: 'gallery' },
		],
		rules: [{ trigger: { kind: 'status', column: 'status', option: 's4' }, action: { kind: 'done' } }],
	},
	requests: {
		label: 'Demandes',
		hint: 'Demandes reçues, demandeurs et suivi.',
		title: 'Demandes',
		columns: [
			{ id: 'status', name: 'Statut', type: 'status', options: status(['Reçue', 'En cours', 'Traitée', 'Refusée']) },
			{ id: 'requester', name: 'Demandeur', type: 'person' },
			{ id: 'owner', name: 'Responsable', type: 'person' },
			{ id: 'due', name: 'Échéance', type: 'date' },
		],
		views: [
			{ name: 'Tableau', kind: 'table' },
			{ name: 'Kanban', kind: 'board' },
		],
	},
	hiring: {
		label: 'Recrutement',
		hint: 'Candidats, étapes et recruteurs.',
		title: 'Recrutement',
		columns: [
			{ id: 'stage', name: 'Étape', type: 'status', options: status(['Candidature', 'Entretien', 'Test', 'Offre', 'Embauché', 'Refusé']) },
			{ id: 'role', name: 'Poste', type: 'text' },
			{ id: 'recruiter', name: 'Recruteur', type: 'person' },
			{ id: 'profile', name: 'Profil', type: 'link' },
			{ id: 'score', name: 'Note', type: 'number' },
		],
		views: [
			{ name: 'Pipeline', kind: 'board' },
			{ name: 'Tableau', kind: 'table' },
			{ name: 'Galerie', kind: 'gallery' },
		],
	},
};

export const LIST_LIMITS = {
	titleLength: 120,
	descriptionLength: 4000,
	textLength: 1000,
	linkLength: 2000,
	columns: 30,
	columnName: 40,
	options: 30,
	items: 2000,
	comment: 2000,
	minWidth: 80,
	maxWidth: 600,
} as const;

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export interface ListLabel {
	id: string;
	name: string;
	color: string;
}

export type ListViewKind = 'table' | 'board' | 'calendar' | 'gallery' | 'timeline';

export const LIST_VIEW_KINDS: ReadonlyArray<{ id: ListViewKind; label: string }> = [
	{ id: 'table', label: 'Tableau' },
	{ id: 'board', label: 'Kanban' },
	{ id: 'calendar', label: 'Calendrier' },
	{ id: 'gallery', label: 'Galerie' },
	{ id: 'timeline', label: 'Chronologie' },
];

// field : id de colonne, « labels », « done » ou « due ».
export type FilterOp = 'is' | 'not' | 'empty' | 'filled';

export interface ViewFilter {
	field: string;
	op: FilterOp;
	value?: string;
}

export interface ViewConfig {
	filters: ViewFilter[];
	sort: { id: string; dir: 1 | -1 } | null;
	groupBy: string | null;
	boardBy: string | null;
	hidden: string[];
	// « due », « start » ou id d'une colonne date.
	dateField: string;
	card: CardFace;
}

export const defaultViewConfig = (): ViewConfig => ({ filters: [], sort: null, groupBy: null, boardBy: null, hidden: [], dateField: 'due', card: defaultCardFace() });

export interface ListSavedView {
	id: string;
	listId: string;
	name: string;
	kind: ListViewKind;
	config: ViewConfig;
	position: number;
}

export interface CheckItem {
	id: string;
	text: string;
	done: boolean;
	assignee: string | null;
	due: string | null;
	position: number;
}

export interface Checklist {
	id: string;
	title: string;
	position: number;
	items: CheckItem[];
}

export interface ListAttachment {
	id: string;
	name: string;
	size: number;
	type: string;
	createdBy: string;
	createdAt: number;
	url: string;
}

export type RuleTrigger = { kind: 'status'; column: string; option: string } | { kind: 'due_soon' };

// notify.user nul : les personnes de l'élément.
export type RuleAction =
	| { kind: 'done' }
	| { kind: 'assign'; column: string; user: string }
	| { kind: 'label'; label: string }
	| { kind: 'notify'; user: string | null }
	| { kind: 'move'; column: string; option: string };

export interface ListRule {
	id: string;
	listId: string;
	trigger: RuleTrigger;
	action: RuleAction;
	enabled: boolean;
	createdBy: string;
	createdAt: number;
}

export const BASE_LIMITS = {
	views: 20,
	viewName: 40,
	filters: 10,
	labels: 30,
	labelName: 30,
	checklists: 10,
	checks: 100,
	checkText: 300,
	files: 30,
	rules: 30,
} as const;

export type DueState = 'done' | 'overdue' | 'today' | 'soon' | 'later';

// Dates en jours civils « AAAA-MM-JJ » : comparaison lexicale suffisante.
export function dueState(item: Pick<ListItem, 'dueDate' | 'done'>, today: string, tomorrow: string): DueState | null {
	if (!item.dueDate) {
		return null;
	}
	if (item.done) {
		return 'done';
	}
	return item.dueDate < today ? 'overdue' : item.dueDate === today ? 'today' : item.dueDate === tomorrow ? 'soon' : 'later';
}

export const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const fileCover = (cover: string | null) => (cover?.startsWith('file:') ? cover.slice(5) : null);

// --- Cartes riches ---

export type CoverMode = 'top' | 'full';
export type CardReminder = '1d' | '1h';
export type EstimateUnit = 'pts' | 'h';

export const CARD_REMINDERS: ReadonlyArray<{ id: CardReminder; label: string; ms: number }> = [
	{ id: '1d', label: '1 jour avant', ms: 86_400_000 },
	{ id: '1h', label: '1 heure avant', ms: 3_600_000 },
];

export const COVER_GRADIENTS: ReadonlyArray<{ id: string; label: string; css: string }> = [
	{ id: 'aube', label: 'Aube', css: 'linear-gradient(135deg, #f7b267 0%, #f25f5c 100%)' },
	{ id: 'lagon', label: 'Lagon', css: 'linear-gradient(135deg, #43cea2 0%, #185a9d 100%)' },
	{ id: 'lavande', label: 'Lavande', css: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)' },
	{ id: 'foret', label: 'Forêt', css: 'linear-gradient(135deg, #7fb685 0%, #1d4d3a 100%)' },
	{ id: 'nuit', label: 'Nuit', css: 'linear-gradient(135deg, #2b3a67 0%, #6b4c9a 100%)' },
	{ id: 'sable', label: 'Sable', css: 'linear-gradient(135deg, #f3e3c3 0%, #d9a86c 100%)' },
	{ id: 'acier', label: 'Acier', css: 'linear-gradient(135deg, #a7b4c2 0%, #48566a 100%)' },
	{ id: 'corail', label: 'Corail', css: 'linear-gradient(135deg, #ff9a8b 0%, #c0266d 100%)' },
];

// Fond CSS d'une bannière couleur ou dégradé ; nul pour une image.
export const coverFill = (cover: string | null): string | null =>
	cover?.startsWith('#') ? cover : cover?.startsWith('grad:') ? (COVER_GRADIENTS.find((g) => g.id === cover.slice(5))?.css ?? null) : null;

export interface CardFace {
	cover: boolean;
	labels: boolean;
	members: boolean;
	dates: boolean;
	checklist: boolean;
	counts: boolean;
	// Colonnes affichées sur la face.
	props: string[];
}

export const defaultCardFace = (): CardFace => ({ cover: true, labels: true, members: true, dates: true, checklist: true, counts: true, props: [] });

export const CARD_LIMITS = {
	// Image de bannière : au-delà, la face de carte se charge mal.
	bannerSize: 10 * 1024 * 1024,
	icon: 16,
	estimate: 10_000,
	links: 30,
	emoji: 32,
	faceProps: 10,
	members: 20,
} as const;

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// kind « people » : from et to sont des ids séparés par des virgules.
export interface ActivityChange {
	field: string;
	from: string | null;
	to: string | null;
	kind?: 'people';
}

export interface CommentReaction {
	emoji: string;
	users: string[];
}

export interface CardLink {
	kind: 'card' | 'page';
	id: string;
	title: string;
	icon: string;
	// Carte : base de rattachement.
	listId?: string;
	listTitle?: string;
	done?: boolean;
}
