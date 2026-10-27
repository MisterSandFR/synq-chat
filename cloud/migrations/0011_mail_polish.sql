-- Ajouts seuls : aucune donnée existante modifiée hors marquage initial de lecture.
CREATE TABLE mail_reads (
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	thread_id TEXT NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
	read_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, thread_id)
);
CREATE INDEX mail_reads_thread ON mail_reads(thread_id);

-- Fils existants considérés lus : sinon tout l'historique apparaîtrait non lu.
INSERT OR IGNORE INTO mail_reads (user_id, thread_id, read_at)
	SELECT b.owner_id, t.id, t.last_at FROM mail_threads t JOIN mailboxes b ON b.id = t.mailbox_id;
INSERT OR IGNORE INTO mail_reads (user_id, thread_id, read_at)
	SELECT DISTINCT m.user_id, t.id, t.last_at FROM mail_threads t
	JOIN mailbox_shares s ON s.mailbox_id = t.mailbox_id
	JOIN members m ON m.workspace_id = s.workspace_id;

ALTER TABLE mail_drafts ADD COLUMN bcc_addrs TEXT NOT NULL DEFAULT '[]';
ALTER TABLE mail_drafts ADD COLUMN forward_of TEXT;
ALTER TABLE mail_drafts ADD COLUMN send_at INTEGER;
ALTER TABLE mail_drafts ADD COLUMN send_error TEXT;
CREATE INDEX mail_drafts_send ON mail_drafts(send_at) WHERE send_at IS NOT NULL;

ALTER TABLE mailboxes ADD COLUMN signature TEXT NOT NULL DEFAULT '';

CREATE TABLE mail_templates (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	body TEXT NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX mail_templates_user ON mail_templates(user_id, name);

-- Rattrapage par lots : HTML re-téléchargé une fois, corps indexé une fois.
ALTER TABLE mail_messages ADD COLUMN html_checked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mail_messages ADD COLUMN indexed INTEGER NOT NULL DEFAULT 0;
CREATE INDEX mail_messages_html_todo ON mail_messages(mailbox_id) WHERE html_checked = 0 AND has_html = 0 AND uid IS NOT NULL;
CREATE INDEX mail_messages_index_todo ON mail_messages(mailbox_id) WHERE indexed = 0;

-- Table ordinaire : une table virtuelle FTS bloque `wrangler d1 export`. `norm` = texte en minuscules sans accents.
CREATE TABLE mail_search (
	mid TEXT PRIMARY KEY REFERENCES mail_messages(id) ON DELETE CASCADE,
	mailbox_id TEXT NOT NULL,
	text TEXT NOT NULL,
	norm TEXT NOT NULL
);
CREATE INDEX mail_search_box ON mail_search(mailbox_id);
