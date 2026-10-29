-- Pages et suivis liés à un salon, sans effet sur les droits.
CREATE TABLE channel_resources (
	workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
	channel_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	ref_id TEXT NOT NULL,
	position REAL NOT NULL DEFAULT 0,
	added_by TEXT NOT NULL,
	PRIMARY KEY (channel_id, kind, ref_id)
);
CREATE INDEX channel_resources_workspace ON channel_resources (workspace_id, channel_id, position);
CREATE INDEX channel_resources_ref ON channel_resources (kind, ref_id);

-- Reprise des anciens rattachements faite par le Worker (surcharges lues dans le DO) ; NULL = à reprendre.
ALTER TABLE workspaces ADD COLUMN decoupled_at INTEGER;
