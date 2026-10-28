export type CanvasAccess = 'write' | 'read';

export type CanvasMeta = {
	id: string;
	workspaceId: string;
	channelId: string | null;
	title: string;
	excerpt: string;
	// Derniers éditeurs, le plus récent d'abord.
	editors: string[];
	createdBy: string;
	createdAt: number;
	updatedAt: number;
	access: CanvasAccess;
};

// Premier octet de chaque trame binaire du WebSocket de canevas.
export const CANVAS_MSG = { sync: 0, update: 1, awareness: 2, query: 3 } as const;

export const CANVAS_LIMITS = { title: 120, excerpt: 240, update: 1_000_000, awareness: 16_384, editors: 6 };

export const CANVAS_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

export const canvasPath = (workspaceId: string, id: string) => `/w/${workspaceId}/canevas/${id}`;

export const CANVAS_LINK_RE = /\/w\/([\w-]+)\/canevas\/([\w-]+)/;

export const canvasFrame = (type: number, payload: Uint8Array) => {
	const out = new Uint8Array(payload.length + 1);
	out[0] = type;
	out.set(payload, 1);
	return out;
};
