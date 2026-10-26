CREATE TABLE grades (
	workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
	id TEXT NOT NULL,
	name TEXT NOT NULL,
	color TEXT NOT NULL DEFAULT '',
	position INTEGER NOT NULL DEFAULT 0,
	permissions INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (workspace_id, id)
);

CREATE TABLE member_grades (
	workspace_id TEXT NOT NULL,
	user_id TEXT NOT NULL,
	grade_id TEXT NOT NULL,
	PRIMARY KEY (workspace_id, user_id, grade_id),
	FOREIGN KEY (workspace_id, user_id) REFERENCES members(workspace_id, user_id) ON DELETE CASCADE,
	FOREIGN KEY (workspace_id, grade_id) REFERENCES grades(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX member_grades_user ON member_grades(workspace_id, user_id);

-- 62912 = DEFAULT_MEMBER_PERMS de shared/permissions.ts ; 1 = ADMINISTRATOR.
INSERT INTO grades (workspace_id, id, name, color, position, permissions) SELECT id, 'default', 'Membre', '', 0, 62912 FROM workspaces;
INSERT INTO grades (workspace_id, id, name, color, position, permissions) SELECT id, 'admin', 'Admin', '#D14343', 1, 1 FROM workspaces;
INSERT INTO member_grades (workspace_id, user_id, grade_id) SELECT workspace_id, user_id, 'admin' FROM members WHERE role = 'admin';
UPDATE members SET role = 'member' WHERE role = 'admin';
