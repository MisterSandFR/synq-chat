-- 524288 = P.ADD_REACTIONS : les membres existants peuvent réagir.
UPDATE grades SET permissions = permissions | 524288 WHERE id = 'default';
