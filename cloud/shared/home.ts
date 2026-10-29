// Compteurs d'une carte de l'écran d'accueil.
export interface SpaceSummary {
	// Nul pour un invité : il ne voit pas la taille de l'espace.
	members: number | null;
	// Conversations avec au moins un message non lu.
	unread: number;
	mentions: number;
}

const INVITE_PATH_RE = /\/invite\/((?:guest\/)?[\w-]+)\/?(?:[?#].*)?$/;

// Lien d'invitation complet ou code seul : chemin à ouvrir, nul si rien de reconnu.
export function invitePath(raw: string): string | null {
	const value = raw.trim();
	if (/^[\w-]{4,}$/.test(value)) {
		return `/invite/${value}`;
	}
	const match = value.match(INVITE_PATH_RE);
	return match ? `/invite/${match[1]}` : null;
}
