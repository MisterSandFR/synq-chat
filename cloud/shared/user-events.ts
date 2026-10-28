// Événements du canal personnel (`/api/me/ws`) : simple signal, le client relit l'API concernée.
export type UserEvent = { t: 'calendar' } | { t: 'mail' };
