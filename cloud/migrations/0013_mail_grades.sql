CREATE TABLE mailbox_share_grades (
	mailbox_id TEXT NOT NULL,
	workspace_id TEXT NOT NULL,
	grade_id TEXT NOT NULL,
	level TEXT NOT NULL CHECK (level IN ('view', 'reply', 'manage')),
	PRIMARY KEY (mailbox_id, workspace_id, grade_id),
	FOREIGN KEY (mailbox_id, workspace_id) REFERENCES mailbox_shares(mailbox_id, workspace_id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, grade_id) REFERENCES grades(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX mailbox_share_grades_grade ON mailbox_share_grades(workspace_id, grade_id);

-- Bits repris : 1 ADMINISTRATOR, 1 << 26 MAIL_VIEW, 1 << 27 MAIL_REPLY, 1 << 28 MANAGE_MAIL. Répondre exigeait aussi de voir, par ce grade ou par le grade par défaut.
INSERT INTO mailbox_share_grades (mailbox_id, workspace_id, grade_id, level)
	SELECT s.mailbox_id, s.workspace_id, g.id, CASE
		WHEN (g.permissions & 268435457) != 0 THEN 'manage'
		WHEN (g.permissions & 134217728) != 0 AND ((g.permissions & 67108864) != 0 OR (COALESCE(d.permissions, 0) & 335544321) != 0) THEN 'reply'
		ELSE 'view'
	END
	FROM mailbox_shares s
	JOIN grades g ON g.workspace_id = s.workspace_id
	LEFT JOIN grades d ON d.workspace_id = s.workspace_id AND d.id = 'default'
	WHERE (g.permissions & 268435457) != 0
		OR (g.permissions & 67108864) != 0
		OR ((g.permissions & 134217728) != 0 AND (COALESCE(d.permissions, 0) & 335544321) != 0);
