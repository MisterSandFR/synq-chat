-- 4194304 = P.ADD_REACTIONS : les membres existants peuvent réagir.
UPDATE grades SET permissions = permissions | 4194304 WHERE id = 'default';
