-- Rôle invité : la contrainte CHECK impose de reconstruire `members` ; la suppression cascade sur member_grades, d'où la sauvegarde.
PRAGMA defer_foreign_keys = true;

CREATE TABLE member_grades_backup AS SELECT * FROM member_grades;

CREATE TABLE members_new (
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'guest')),
	joined_at INTEGER NOT NULL,
	PRIMARY KEY (workspace_id, user_id)
);
INSERT INTO members_new (workspace_id, user_id, role, joined_at) SELECT workspace_id, user_id, role, joined_at FROM members;
DROP TABLE members;
ALTER TABLE members_new RENAME TO members;
CREATE INDEX members_user ON members(user_id);

INSERT OR IGNORE INTO member_grades SELECT * FROM member_grades_backup;
DROP TABLE member_grades_backup;

-- Compte invité : ni mot de passe, ni SSO, ni espace à soi.
ALTER TABLE users ADD COLUMN guest INTEGER NOT NULL DEFAULT 0;

CREATE TABLE guest_invites (
	id TEXT PRIMARY KEY,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	channel_id TEXT NOT NULL,
	email TEXT NOT NULL,
	token_hash TEXT NOT NULL UNIQUE,
	created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
	expires_at INTEGER NOT NULL,
	revoked_at INTEGER,
	created_at INTEGER NOT NULL
);
CREATE INDEX guest_invites_channel ON guest_invites(workspace_id, channel_id);
