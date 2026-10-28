-- Métadonnées des canevas ; le contenu Yjs vit dans le DO CanvasDoc.
CREATE TABLE canvases (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
	channel_id TEXT,
	title TEXT NOT NULL,
	excerpt TEXT NOT NULL DEFAULT '',
	editors TEXT NOT NULL DEFAULT '[]',
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

-- Un seul canevas par salon (onglet).
CREATE UNIQUE INDEX canvases_channel ON canvases (workspace_id, channel_id) WHERE channel_id IS NOT NULL;
CREATE INDEX canvases_workspace ON canvases (workspace_id, updated_at DESC);
