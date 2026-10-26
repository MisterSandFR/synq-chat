import type { Attachment } from '../shared/types';

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
	const res = await fetch(`/api${path}`, {
		method,
		headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
	if (!res.ok) {
		if (res.status === 401 && path !== '/me') {
			window.dispatchEvent(new Event('synq:unauthorized'));
		}
		throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Erreur ${res.status}`);
	}
	return data as T;
}

export async function uploadFile(workspaceId: string, file: File): Promise<Attachment> {
	const res = await fetch(`/api/w/${workspaceId}/files`, {
		method: 'POST',
		headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
		body: file,
	});
	const data = (await res.json()) as Attachment & { error?: string };
	if (!res.ok) {
		throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`);
	}
	return data;
}

export const fileUrl = (workspaceId: string, key: string) => `/api/w/${workspaceId}/files/${key.split('/').pop()}`;

export const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Erreur inattendue');
