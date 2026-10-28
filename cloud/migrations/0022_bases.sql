-- Bases : vues enregistrées, étiquettes, checklists, dates, pièces jointes, automatisations, page liée.
ALTER TABLE lists ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';

ALTER TABLE list_items ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';
ALTER TABLE list_items ADD COLUMN cover TEXT;
ALTER TABLE list_items ADD COLUMN start_date TEXT;
ALTER TABLE list_items ADD COLUMN due_date TEXT;
ALTER TABLE list_items ADD COLUMN done INTEGER NOT NULL DEFAULT 0;
-- Échéance déjà annoncée : une seule notification J-1 par date.
ALTER TABLE list_items ADD COLUMN due_notified TEXT;

CREATE INDEX list_items_due ON list_items (due_date) WHERE done = 0 AND due_date IS NOT NULL;

CREATE TABLE list_views (
	id TEXT PRIMARY KEY,
	list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	kind TEXT NOT NULL,
	config TEXT NOT NULL DEFAULT '{}',
	position REAL NOT NULL,
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX list_views_list ON list_views (list_id, position);

-- Les bases existantes gardent leur tableau.
INSERT INTO list_views (id, list_id, name, kind, config, position, created_by, created_at)
SELECT lower(hex(randomblob(16))), id, 'Tableau', 'table', '{}', 1, created_by, created_at FROM lists;

CREATE TABLE list_checklists (
	id TEXT PRIMARY KEY,
	item_id TEXT NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	position REAL NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX list_checklists_item ON list_checklists (item_id, position);

CREATE TABLE list_checks (
	id TEXT PRIMARY KEY,
	checklist_id TEXT NOT NULL REFERENCES list_checklists(id) ON DELETE CASCADE,
	item_id TEXT NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
	text TEXT NOT NULL,
	done INTEGER NOT NULL DEFAULT 0,
	assignee TEXT,
	due TEXT,
	position REAL NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX list_checks_item ON list_checks (item_id, position);

CREATE TABLE list_attachments (
	id TEXT PRIMARY KEY,
	item_id TEXT NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
	list_id TEXT NOT NULL,
	name TEXT NOT NULL,
	size INTEGER NOT NULL,
	type TEXT NOT NULL,
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX list_attachments_item ON list_attachments (item_id, created_at);

CREATE TABLE list_rules (
	id TEXT PRIMARY KEY,
	list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
	trigger TEXT NOT NULL,
	action TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX list_rules_list ON list_rules (list_id);

-- Document collaboratif d'un élément : un canevas rattaché au même salon que la base.
CREATE TABLE list_item_pages (
	item_id TEXT PRIMARY KEY REFERENCES list_items(id) ON DELETE CASCADE,
	canvas_id TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL
);
