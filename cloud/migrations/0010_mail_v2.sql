ALTER TABLE mail_messages ADD COLUMN has_html INTEGER NOT NULL DEFAULT 0;

ALTER TABLE mail_threads ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mail_threads ADD COLUMN snoozed_until INTEGER;
-- Corbeille côté Synq : rien n'est supprimé sur le serveur IMAP.
ALTER TABLE mail_threads ADD COLUMN deleted_at INTEGER;
CREATE INDEX mail_threads_snoozed ON mail_threads(snoozed_until) WHERE snoozed_until IS NOT NULL;

CREATE TABLE mail_drafts (
	id TEXT PRIMARY KEY,
	mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	thread_id TEXT REFERENCES mail_threads(id) ON DELETE CASCADE,
	to_addrs TEXT NOT NULL DEFAULT '[]',
	cc_addrs TEXT NOT NULL DEFAULT '[]',
	subject TEXT NOT NULL DEFAULT '',
	body TEXT NOT NULL DEFAULT '',
	attachments TEXT NOT NULL DEFAULT '[]',
	updated_at INTEGER NOT NULL
);
CREATE INDEX mail_drafts_user ON mail_drafts(user_id, thread_id);
