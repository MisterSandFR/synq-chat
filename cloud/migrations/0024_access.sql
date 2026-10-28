-- Accès fins des pages, catégories de pages et bases ; sujet = id de grade (`default` = tous) ou `@<userId>`.
CREATE TABLE access_rules (
	workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
	resource_kind TEXT NOT NULL,
	resource_id TEXT NOT NULL,
	subject_id TEXT NOT NULL,
	level TEXT NOT NULL,
	PRIMARY KEY (resource_kind, resource_id, subject_id)
);
CREATE INDEX access_rules_workspace ON access_rules (workspace_id);

CREATE TABLE page_categories (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	icon TEXT,
	position REAL NOT NULL DEFAULT 0,
	restricted INTEGER NOT NULL DEFAULT 0,
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX page_categories_workspace ON page_categories (workspace_id, position);

ALTER TABLE canvases ADD COLUMN category_id TEXT;
ALTER TABLE canvases ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lists ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0;
