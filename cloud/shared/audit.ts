export type AuditKind = 'workspace' | 'invite' | 'member' | 'grade' | 'channel' | 'category' | 'command' | 'webhook' | 'voice' | 'guest' | 'mail';

export interface AuditEntry {
	id: number;
	at: number;
	actorId: string;
	actorName: string;
	action: string;
	kind: AuditKind;
	targetId: string | null;
	targetName: string | null;
	// Clés modifiées ou précision (mute, kick), jamais de valeur saisie.
	detail: string | null;
}

export interface AuditPage {
	items: AuditEntry[];
	next: number | null;
}

export const AUDIT_LABELS: Record<string, string> = {
	'workspace.update': 'a modifié l’espace',
	'layout.update': 'a réorganisé les salons',
	'invite.create': 'a créé une invitation',
	'invite.revoke': 'a révoqué une invitation',
	'invite.join': 'a rejoint l’espace par une invitation',
	'member.kick': 'a exclu',
	'member.grades': 'a changé les grades de',
	'grade.create': 'a créé le grade',
	'grade.update': 'a modifié le grade',
	'grade.delete': 'a supprimé le grade',
	'grade.reorder': 'a réordonné les grades',
	'channel.create': 'a créé le salon',
	'channel.update': 'a modifié le salon',
	'channel.delete': 'a supprimé le salon',
	'channel.permissions': 'a changé les permissions du salon',
	'channel.sync': 'a synchronisé avec sa catégorie le salon',
	'channel.announcement': 'a changé l’annonce du salon',
	'category.create': 'a créé la catégorie',
	'category.update': 'a modifié la catégorie',
	'category.delete': 'a supprimé la catégorie',
	'category.permissions': 'a changé les permissions de la catégorie',
	'command.create': 'a créé la commande',
	'command.update': 'a modifié la commande',
	'command.delete': 'a supprimé la commande',
	'webhook.create': 'a créé un webhook dans',
	'webhook.rotate': 'a régénéré le secret du webhook',
	'webhook.delete': 'a supprimé le webhook',
	'voice.move': 'a déplacé en vocal',
	'voice.moderate': 'a modéré en vocal',
	'guest.invite': 'a invité un externe dans',
	'guest.revoke': 'a révoqué l’invitation externe',
	'mail.sharers': 'a changé qui peut partager une boîte mail',
	'mail.unshare': 'a retiré de l’espace la boîte mail',
};

export const AUDIT_KINDS: Array<{ id: AuditKind; label: string }> = [
	{ id: 'workspace', label: 'Espace' },
	{ id: 'member', label: 'Membres' },
	{ id: 'grade', label: 'Grades' },
	{ id: 'channel', label: 'Salons' },
	{ id: 'category', label: 'Catégories' },
	{ id: 'invite', label: 'Invitations' },
	{ id: 'guest', label: 'Invités' },
	{ id: 'command', label: 'Commandes' },
	{ id: 'webhook', label: 'Webhooks' },
	{ id: 'voice', label: 'Vocal' },
	{ id: 'mail', label: 'Mail' },
];
