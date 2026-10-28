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
}

export interface ListDetail extends ListSummary {
	columns: ListColumn[];
	items: ListItem[];
	canEdit: boolean;
	canDelete: boolean;
}

export interface ListComment {
	id: string;
	itemId: string;
	userId: string;
	body: string;
	createdAt: number;
}

export interface ListActivity {
	id: number;
	userId: string;
	action: string;
	createdAt: number;
}

export interface ListItemDetail {
	item: ListItem;
	comments: ListComment[];
	activity: ListActivity[];
}

export type ListTemplate = 'blank' | 'project' | 'bugs' | 'requests' | 'hiring';

export const STATUS_COLORS = ['#8a8d96', '#2563eb', '#d97706', '#7c3aed', '#1f9d57', '#c93636', '#0f8a8a', '#c0266d'] as const;

export const PRIORITIES: ReadonlyArray<ListOption> = [
	{ id: 'urgent', label: 'Urgente', color: '#c93636' },
	{ id: 'high', label: 'Haute', color: '#d97706' },
	{ id: 'medium', label: 'Moyenne', color: '#2563eb' },
	{ id: 'low', label: 'Basse', color: '#8a8d96' },
];

const status = (labels: string[]): ListOption[] => labels.map((label, i) => ({ id: `s${i + 1}`, label, color: STATUS_COLORS[i % STATUS_COLORS.length]! }));

// Identifiants stables : les modèles ne dépendent pas d'un générateur.
export const LIST_TEMPLATES: Record<ListTemplate, { label: string; hint: string; title: string; columns: ListColumn[] }> = {
	blank: { label: 'Liste vide', hint: 'Partir de zéro et ajouter ses colonnes.', title: 'Nouvelle liste', columns: [] },
	project: {
		label: 'Suivi de projet',
		hint: 'Tâches, responsables, échéances et priorités.',
		title: 'Suivi de projet',
		columns: [
			{ id: 'status', name: 'Statut', type: 'status', options: [...status(['À faire', 'En cours', 'En revue', 'Terminé'])] },
			{ id: 'owner', name: 'Responsable', type: 'person' },
			{ id: 'due', name: 'Échéance', type: 'date' },
			{ id: 'priority', name: 'Priorité', type: 'priority' },
		],
	},
	bugs: {
		label: 'Bugs',
		hint: 'Signalements, gravité et correctifs.',
		title: 'Bugs',
		columns: [
			{ id: 'status', name: 'Statut', type: 'status', options: status(['Nouveau', 'Confirmé', 'En cours', 'Corrigé', 'Fermé']) },
			{ id: 'priority', name: 'Priorité', type: 'priority' },
			{ id: 'assignee', name: 'Assigné à', type: 'person' },
			{ id: 'link', name: 'Lien', type: 'link' },
			{ id: 'reported', name: 'Signalé le', type: 'date' },
		],
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
