export interface Reaction {
	emoji: string;
	// Ordre d'arrivée.
	users: string[];
}

export interface PinInfo {
	by: string;
	at: number;
}

// Emojis distincts par message.
export const MAX_REACTIONS = 20;
export const MAX_PINS = 50;

// Champs déclarés ici pour ne pas toucher l'interface partagée de types.ts.
declare module './types' {
	interface Message {
		reactions?: Reaction[];
		pinned?: PinInfo | null;
	}
}
