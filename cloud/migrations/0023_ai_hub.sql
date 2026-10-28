-- Historique des conversations de l'assistant, propre à chaque personne.
CREATE TABLE ai_conversations (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	title TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX ai_conversations_user ON ai_conversations (user_id, updated_at DESC);

CREATE TABLE ai_turns (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
	text TEXT NOT NULL,
	sources TEXT NOT NULL DEFAULT '[]',
	action TEXT,
	done TEXT,
	created_at INTEGER NOT NULL
);

CREATE INDEX ai_turns_conversation ON ai_turns (conversation_id, id);
