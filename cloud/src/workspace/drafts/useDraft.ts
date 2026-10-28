import { useEffect, useRef } from 'react';

import { DRAFT_LIMITS, type Draft, type ScheduledMessage } from '../../../shared/drafts';
import { api } from '../../api';
import { addScheduled, putDraft, sameDraft, useDrafts } from './store';

const signature = (body: string, keys: string[]) => JSON.stringify([body, keys]);

const EMPTY = signature('', []);

type Content = { body: string; keys: string[] };

// Brouillon d'un composer (salon : threadRoot 0, sinon racine du fil) : restauré une fois, sauvé après 1 s d'inactivité.
export function useDraft(workspaceId: string, channelId: string, threadRoot: number, content: Content, restore: (draft: Draft) => void) {
	const { loaded, drafts } = useDrafts();
	const target = `${channelId}:${threadRoot}`;
	const ready = useRef<string | null>(null);
	const saved = useRef(EMPTY);
	const timer = useRef<number | undefined>(undefined);
	const pending = useRef<(() => void) | null>(null);
	const current = signature(content.body, content.keys);

	const flush = () => {
		window.clearTimeout(timer.current);
		pending.current?.();
	};

	// Changement de fil ou de salon sans remontage : on sauve l'ancien avant de restaurer le nouveau.
	useEffect(() => {
		if (!loaded || ready.current === target) {
			return;
		}
		flush();
		ready.current = target;
		const draft = drafts.find((d) => sameDraft(d, channelId, threadRoot));
		if (draft && !content.body && !content.keys.length) {
			saved.current = signature(draft.body, draft.attachments.map((a) => a.key));
			restore(draft);
		} else {
			saved.current = draft ? signature(draft.body, draft.attachments.map((a) => a.key)) : EMPTY;
		}
	}, [loaded, target]);

	useEffect(() => {
		if (ready.current !== target || current === saved.current) {
			return;
		}
		const { body, keys } = content;
		const run = () => {
			pending.current = null;
			saved.current = current;
			const empty = !body.trim() && !keys.length;
			const request = empty
				? api('DELETE', `/w/${workspaceId}/drafts/${channelId}?thread=${threadRoot}`).then(() => putDraft(channelId, threadRoot, null))
				: api<Draft | null>('PUT', `/w/${workspaceId}/drafts`, { channelId, threadRoot, body, attachmentKeys: keys }).then((draft) => putDraft(channelId, threadRoot, draft));
			// Échec : la prochaine frappe réessaie.
			request.catch(() => (saved.current = ''));
		};
		pending.current = run;
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(run, DRAFT_LIMITS.saveDelay);
	}, [current, target]);

	useEffect(() => flush, []);

	// Appelé avant l'envoi : le serveur supprime le brouillon, aucune sauvegarde ne doit le recréer.
	const sent = () => {
		window.clearTimeout(timer.current);
		pending.current = null;
		saved.current = EMPTY;
		putDraft(channelId, threadRoot, null);
	};

	const schedule = async (sendAt: number, body: string, replyTo?: number) => {
		sent();
		const created = await api<ScheduledMessage>('POST', `/w/${workspaceId}/scheduled`, { channelId, threadRoot, body, attachmentKeys: content.keys, replyTo, sendAt });
		addScheduled(created);
	};

	return { sent, schedule };
}

