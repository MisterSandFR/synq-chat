CREATE TABLE mailboxes (
	id TEXT PRIMARY KEY,
	owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	address TEXT NOT NULL,
	imap_host TEXT NOT NULL,
	imap_port INTEGER NOT NULL DEFAULT 993,
	smtp_host TEXT NOT NULL,
	smtp_port INTEGER NOT NULL DEFAULT 465,
	username TEXT NOT NULL,
	-- Mot de passe d'application chiffré AES-GCM (MAIL_KEY).
	secret TEXT NOT NULL,
	uid_validity INTEGER NOT NULL DEFAULT 0,
	last_uid INTEGER NOT NULL DEFAULT 0,
	synced_at INTEGER,
	sync_error TEXT,
	created_at INTEGER NOT NULL
);
CREATE INDEX mailboxes_owner ON mailboxes(owner_id);

CREATE TABLE mailbox_shares (
	mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	-- Salons (« projets ») rattachés, tableau JSON d'ids.
	channel_ids TEXT NOT NULL DEFAULT '[]',
	created_at INTEGER NOT NULL,
	PRIMARY KEY (mailbox_id, workspace_id)
);
CREATE INDEX mailbox_shares_workspace ON mailbox_shares(workspace_id);

CREATE TABLE mail_threads (
	id TEXT PRIMARY KEY,
	mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
	subject TEXT NOT NULL,
	snippet TEXT NOT NULL DEFAULT '',
	participants TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
	assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
	message_count INTEGER NOT NULL DEFAULT 0,
	last_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX mail_threads_box ON mail_threads(mailbox_id, status, last_at DESC);
CREATE INDEX mail_threads_assignee ON mail_threads(assignee_id);

CREATE TABLE mail_messages (
	id TEXT PRIMARY KEY,
	mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
	thread_id TEXT NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
	uid INTEGER,
	message_id TEXT NOT NULL,
	in_reply_to TEXT,
	refs TEXT NOT NULL DEFAULT '',
	reply_to TEXT,
	direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
	from_name TEXT NOT NULL DEFAULT '',
	from_addr TEXT NOT NULL DEFAULT '',
	to_addrs TEXT NOT NULL DEFAULT '',
	cc_addrs TEXT NOT NULL DEFAULT '',
	subject TEXT NOT NULL DEFAULT '',
	snippet TEXT NOT NULL DEFAULT '',
	attachments TEXT NOT NULL DEFAULT '[]',
	sent_by TEXT REFERENCES users(id) ON DELETE SET NULL,
	date INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX mail_messages_thread ON mail_messages(thread_id, date);
CREATE INDEX mail_messages_msgid ON mail_messages(mailbox_id, message_id);
CREATE UNIQUE INDEX mail_messages_uid ON mail_messages(mailbox_id, uid) WHERE uid IS NOT NULL;

CREATE TABLE mail_notes (
	id TEXT PRIMARY KEY,
	thread_id TEXT NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
	author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
	body TEXT NOT NULL,
	created_at INTEGER NOT NULL
);
CREATE INDEX mail_notes_thread ON mail_notes(thread_id, created_at);
