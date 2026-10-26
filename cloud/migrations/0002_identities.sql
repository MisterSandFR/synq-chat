ALTER TABLE users ADD COLUMN avatar_url TEXT;

CREATE TABLE identities (
	provider TEXT NOT NULL,
	subject TEXT NOT NULL,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (provider, subject)
);
CREATE UNIQUE INDEX identities_user_provider ON identities(user_id, provider);

CREATE TABLE oauth_states (
	state TEXT PRIMARY KEY,
	verifier TEXT NOT NULL,
	nonce TEXT NOT NULL,
	link_user_id TEXT,
	expires_at INTEGER NOT NULL
);
