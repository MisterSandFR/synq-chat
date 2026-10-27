-- Calendrier global : workspace_id NULL = événement personnel.
CREATE TABLE events (
	id TEXT PRIMARY KEY,
	workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
	created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	uid TEXT NOT NULL,
	title TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	starts_at INTEGER NOT NULL,
	ends_at INTEGER NOT NULL,
	all_day INTEGER NOT NULL DEFAULT 0,
	timezone TEXT NOT NULL DEFAULT 'UTC',
	location TEXT NOT NULL DEFAULT '',
	channel_id TEXT,
	color TEXT NOT NULL DEFAULT '',
	rrule_freq TEXT CHECK (rrule_freq IN ('daily', 'weekly', 'monthly')),
	rrule_interval INTEGER NOT NULL DEFAULT 1,
	rrule_until INTEGER,
	reminder_minutes INTEGER,
	next_remind_at INTEGER,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX events_workspace ON events (workspace_id, starts_at);
CREATE INDEX events_personal ON events (created_by) WHERE workspace_id IS NULL;
-- Réimport du même fichier ICS sans doublons.
CREATE UNIQUE INDEX events_uid ON events (created_by, uid);
CREATE INDEX events_reminder ON events (next_remind_at) WHERE next_remind_at IS NOT NULL;

CREATE TABLE event_attendees (
	event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	response TEXT NOT NULL DEFAULT 'pending' CHECK (response IN ('pending', 'yes', 'no', 'maybe')),
	PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_attendees_user ON event_attendees (user_id);

CREATE TABLE event_exceptions (
	event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
	occurs_at INTEGER NOT NULL,
	PRIMARY KEY (event_id, occurs_at)
);

CREATE TABLE calendar_feeds (
	user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	token_hash TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL
);

-- Grade par défaut existant : voir et créer des événements (VIEW_EVENTS | CREATE_EVENTS).
UPDATE grades SET permissions = permissions | 786432 WHERE id = 'default';
