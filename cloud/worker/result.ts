export type ErrorStatus = 400 | 403 | 404 | 409 | 413;

export type Result<T> = { ok: true; value: T } | { ok: false; status: ErrorStatus; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = <T = never>(status: ErrorStatus, error: string): Result<T> => ({ ok: false, status, error });
