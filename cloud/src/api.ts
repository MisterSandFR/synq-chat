import type { Attachment } from '../shared/types';

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

export async function api<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
	const res = await fetch(`/api${path}`, {
		method,
		signal,
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

// XHR plutôt que fetch : seul moyen de suivre la progression d'un envoi.
export function upload<T>(path: string, file: File, onProgress?: (ratio: number) => void): Promise<T> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', `/api${path}`);
		xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
		xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
		xhr.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total);
		xhr.onload = () => {
			let data: (T & { error?: string }) | null = null;
			try {
				data = JSON.parse(xhr.responseText) as T & { error?: string };
			} catch {
				// Réponse non JSON.
			}
			if (xhr.status >= 200 && xhr.status < 300 && data) {
				resolve(data);
			} else {
				reject(new ApiError(xhr.status, data?.error ?? `Erreur ${xhr.status}`));
			}
		};
		xhr.onerror = () => reject(new ApiError(0, 'Connexion interrompue pendant l’envoi'));
		xhr.send(file);
	});
}

export const uploadAttachment = (workspaceId: string, file: File, onProgress?: (ratio: number) => void) =>
	upload<Attachment>(`/w/${workspaceId}/files`, file, onProgress);

export const fileUrl = (workspaceId: string, key: string) => `/api/w/${workspaceId}/files/${key.split('/').pop()}`;

export const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Erreur inattendue');
