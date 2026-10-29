-- Fichiers donnés à Synq IA : contenu en R2 sous `ai/<user>/<id>`, texte extrait ici, effacés après 24 h.
CREATE TABLE ai_files (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	kind TEXT NOT NULL,
	type TEXT NOT NULL,
	size INTEGER NOT NULL,
	markdown TEXT NOT NULL DEFAULT '',
	truncated INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE INDEX ai_files_user ON ai_files (user_id, expires_at);

CREATE INDEX ai_files_expiry ON ai_files (expires_at);
