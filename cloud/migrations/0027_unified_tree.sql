-- Suivis rangés dans l'arbre des pages : page parente (canvases.id), catégorie, ordre, icône.
ALTER TABLE lists ADD COLUMN parent_id TEXT;
ALTER TABLE lists ADD COLUMN category_id TEXT;
ALTER TABLE lists ADD COLUMN position REAL NOT NULL DEFAULT 0;
ALTER TABLE lists ADD COLUMN icon TEXT;

CREATE INDEX lists_parent ON lists (parent_id) WHERE parent_id IS NOT NULL;

-- Page de salon sans titre propre : nommée d'après le salon côté interface.
UPDATE canvases SET title = '' WHERE channel_id IS NOT NULL AND title = 'Canevas du salon';
