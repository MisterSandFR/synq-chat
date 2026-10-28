-- Les canevas deviennent des pages : arbre, icône, couverture, archivage.
ALTER TABLE canvases ADD COLUMN parent_id TEXT;
ALTER TABLE canvases ADD COLUMN icon TEXT;
ALTER TABLE canvases ADD COLUMN cover_key TEXT;
ALTER TABLE canvases ADD COLUMN position REAL NOT NULL DEFAULT 0;
ALTER TABLE canvases ADD COLUMN archived_at INTEGER;

CREATE INDEX canvases_parent ON canvases (workspace_id, parent_id, position);

-- Liens entre pages relevés dans le document par le DO, pour les rétroliens.
CREATE TABLE canvas_links (
	source_id TEXT NOT NULL REFERENCES canvases (id) ON DELETE CASCADE,
	target_id TEXT NOT NULL REFERENCES canvases (id) ON DELETE CASCADE,
	PRIMARY KEY (source_id, target_id)
);
CREATE INDEX canvas_links_target ON canvas_links (target_id);

-- Commentaires sur une sélection ; le fil est ancré par une marque du document.
CREATE TABLE canvas_comments (
	id TEXT PRIMARY KEY,
	canvas_id TEXT NOT NULL REFERENCES canvases (id) ON DELETE CASCADE,
	thread_id TEXT NOT NULL,
	quote TEXT NOT NULL DEFAULT '',
	author_id TEXT NOT NULL,
	body TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	resolved_at INTEGER
);
CREATE INDEX canvas_comments_canvas ON canvas_comments (canvas_id, thread_id, created_at);
