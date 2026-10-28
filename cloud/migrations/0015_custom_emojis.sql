-- Emojis d’espace : image dans R2 sous emojis/<workspace_id>/<object_key>.
CREATE TABLE custom_emojis (
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	object_key TEXT NOT NULL,
	animated INTEGER NOT NULL DEFAULT 0,
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (workspace_id, name)
);
