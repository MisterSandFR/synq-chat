-- Sujet : id de grade ou '@<userId>'. Aucune ligne : seuls propriétaire et administrateurs partagent.
CREATE TABLE mail_sharers (
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	subject_id TEXT NOT NULL,
	PRIMARY KEY (workspace_id, subject_id)
);
