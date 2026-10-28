import { useCallback, useEffect, useRef, useState } from 'react';

import { MAX_ATTACHMENTS } from '../../../shared/media';
import { LIMITS, type Attachment } from '../../../shared/types';
import { errorText, uploadAttachment } from '../../api';

export type Upload = { id: string; file: File; ratio: number; attachment: Attachment | null; error: string | null; preview: string | null };

const PREVIEWABLE = /^image\/(png|jpeg|gif|webp|avif)$/;

const revoke = (items: Upload[]) => items.forEach((u) => u.preview && URL.revokeObjectURL(u.preview));

export function useUploads(workspaceId: string) {
	const [items, setItems] = useState<Upload[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	// Copie synchrone : les envois en cours mettent à jour la liste sans attendre le rendu.
	const current = useRef<Upload[]>([]);

	const commit = useCallback((change: (list: Upload[]) => Upload[]) => {
		current.current = change(current.current);
		setItems(current.current);
	}, []);

	const patch = useCallback((id: string, change: Partial<Upload>) => commit((list) => list.map((u) => (u.id === id ? { ...u, ...change } : u))), [commit]);

	const add = useCallback(
		(files: File[]) => {
			const room = MAX_ATTACHMENTS - current.current.length;
			let warning = files.length > room ? `${MAX_ATTACHMENTS} fichiers max par message.` : null;
			const next: Upload[] = [];
			for (const file of files.slice(0, Math.max(0, room))) {
				if (file.size > LIMITS.fileSize) {
					warning = `${file.name} dépasse 50 Mo.`;
				} else if (!file.size) {
					warning = `${file.name} est vide.`;
				} else {
					next.push({ id: crypto.randomUUID(), file, ratio: 0, attachment: null, error: null, preview: PREVIEWABLE.test(file.type) ? URL.createObjectURL(file) : null });
				}
			}
			setNotice(warning);
			commit((list) => [...list, ...next]);
			for (const item of next) {
				uploadAttachment(workspaceId, item.file, (ratio) => patch(item.id, { ratio }))
					.then((attachment) => patch(item.id, { attachment, ratio: 1 }))
					.catch((err: unknown) => patch(item.id, { error: errorText(err) }));
			}
		},
		[workspaceId, commit, patch],
	);

	// Pièces jointes déjà envoyées sur R2 (brouillon restauré).
	const restore = useCallback(
		(attachments: Attachment[]) =>
			commit((list) => [...list, ...attachments.map((attachment) => ({ id: crypto.randomUUID(), file: new File([], attachment.name, { type: attachment.type }), ratio: 1, attachment, error: null, preview: null }))]),
		[commit],
	);

	const remove = useCallback(
		(id: string) => {
			revoke(current.current.filter((u) => u.id === id));
			commit((list) => list.filter((u) => u.id !== id));
			setNotice(null);
		},
		[commit],
	);

	const clear = useCallback(() => {
		revoke(current.current);
		commit(() => []);
		setNotice(null);
	}, [commit]);

	useEffect(() => () => revoke(current.current), []);

	const pending = items.some((u) => !u.attachment && !u.error);
	const failed = items.some((u) => u.error);
	return { items, notice, add, restore, remove, clear, keys: items.flatMap((u) => (u.attachment ? [u.attachment.key] : [])), blocked: pending || failed };
}
