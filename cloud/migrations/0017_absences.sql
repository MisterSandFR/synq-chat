-- Absences globales : visibles dans chaque espace partagé avec la personne.
CREATE TABLE absences (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	kind TEXT NOT NULL CHECK (kind IN ('leave', 'sick', 'remote', 'travel', 'training', 'other')),
	start_day TEXT NOT NULL,
	start_half TEXT NOT NULL DEFAULT 'am' CHECK (start_half IN ('am', 'pm')),
	-- NULL : rythme hebdomadaire sans fin.
	end_day TEXT,
	end_half TEXT NOT NULL DEFAULT 'pm' CHECK (end_half IN ('am', 'pm')),
	note TEXT NOT NULL DEFAULT '',
	private INTEGER NOT NULL DEFAULT 0,
	-- Bits lundi = 1 … dimanche = 64 ; 0 = période continue.
	weekdays INTEGER NOT NULL DEFAULT 0,
	created_by TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX absences_user ON absences (user_id, start_day);
