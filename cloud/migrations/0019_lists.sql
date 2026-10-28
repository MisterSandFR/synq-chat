-- Listes de suivi d'un espace, rattachables à un salon (visibilité du salon).
CREATE TABLE lists (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	channel_id TEXT,
	title TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	columns TEXT NOT NULL DEFAULT '[]',
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX lists_workspace ON lists (workspace_id, updated_at DESC);

CREATE TABLE list_items (
	id TEXT PRIMARY KEY,
	list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
	position REAL NOT NULL,
	title TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	vals TEXT NOT NULL DEFAULT '{}',
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX list_items_list ON list_items (list_id, position);

CREATE TABLE list_comments (
	id TEXT PRIMARY KEY,
	item_id TEXT NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL,
	body TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX list_comments_item ON list_comments (item_id, created_at);

CREATE TABLE list_activity (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	item_id TEXT NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL,
	action TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX list_activity_item ON list_activity (item_id, id);
