-- Cartes riches : bannière, icône, membres, heures et rappel, estimation, archivage, modèles, suivi, liens, réactions.
ALTER TABLE list_items ADD COLUMN icon TEXT NOT NULL DEFAULT '';
ALTER TABLE list_items ADD COLUMN cover_mode TEXT NOT NULL DEFAULT 'top';
ALTER TABLE list_items ADD COLUMN cover_y INTEGER NOT NULL DEFAULT 50;
ALTER TABLE list_items ADD COLUMN members TEXT NOT NULL DEFAULT '[]';
ALTER TABLE list_items ADD COLUMN start_time TEXT;
ALTER TABLE list_items ADD COLUMN due_time TEXT;
ALTER TABLE list_items ADD COLUMN reminder TEXT;
-- Clé « échéance + rappel » déjà notifiée : un seul envoi tant qu'elle ne change pas.
ALTER TABLE list_items ADD COLUMN reminder_sent TEXT;
ALTER TABLE list_items ADD COLUMN estimate REAL;
ALTER TABLE list_items ADD COLUMN estimate_unit TEXT NOT NULL DEFAULT 'pts';
ALTER TABLE list_items ADD COLUMN archived_at INTEGER;
ALTER TABLE list_items ADD COLUMN template INTEGER NOT NULL DEFAULT 0;

CREATE INDEX list_items_reminder ON list_items (due_date) WHERE reminder IS NOT NULL AND done = 0 AND archived_at IS NULL;

-- Changements détaillés (champ, ancienne et nouvelle valeur) en JSON.
ALTER TABLE list_activity ADD COLUMN detail TEXT;

CREATE TABLE list_follows (
	item_id TEXT NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (item_id, user_id)
);

CREATE TABLE list_item_links (
	item_id TEXT NOT NULL REFERENCES list_items(id) ON DELETE CASCADE,
	kind TEXT NOT NULL,
	ref_id TEXT NOT NULL,
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (item_id, kind, ref_id)
);

CREATE TABLE list_comment_reactions (
	comment_id TEXT NOT NULL REFERENCES list_comments(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL,
	emoji TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (comment_id, user_id, emoji)
);
