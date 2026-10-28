-- expires_at devient facultatif (lien sans fin) : SQLite impose de recréer la table.
PRAGMA defer_foreign_keys = true;

CREATE TABLE invites_v2 (
	code TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	created_by TEXT NOT NULL REFERENCES users(id),
	expires_at INTEGER,
	created_at INTEGER NOT NULL,
	max_uses INTEGER,
	uses INTEGER NOT NULL DEFAULT 0,
	channel_id TEXT,
	grade_ids TEXT NOT NULL DEFAULT '[]',
	temporary INTEGER NOT NULL DEFAULT 0,
	label TEXT NOT NULL DEFAULT '',
	revoked_at INTEGER
);

INSERT INTO invites_v2 (code, workspace_id, created_by, expires_at, created_at)
SELECT code, workspace_id, created_by, expires_at, created_at FROM invites;

DROP TABLE invites;
ALTER TABLE invites_v2 RENAME TO invites;

CREATE INDEX invites_workspace ON invites(workspace_id, created_at);
CREATE INDEX invites_temporary ON invites(expires_at) WHERE temporary = 1;

CREATE TABLE invite_uses (
	code TEXT NOT NULL REFERENCES invites(code) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	used_at INTEGER NOT NULL,
	PRIMARY KEY (code, user_id)
);
CREATE INDEX invite_uses_user ON invite_uses(user_id);
