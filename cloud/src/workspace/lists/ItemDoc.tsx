import { useEffect, useState } from 'react';
import * as Y from 'yjs';

import type { CanvasMeta } from '../../../shared/canvas';
import type { ListItem } from '../../../shared/lists';
import type { Member } from '../../../shared/types';
import { api, errorText } from '../../api';
import { CanvasEditor } from '../canvas/CanvasEditor';
import { CanvasSync, colorFor } from '../canvas/sync';
import '../canvas/canvas.css';

type Props = { base: string; workspaceId: string; item: ListItem; members: Map<string, Member>; myId: string; editable: boolean; onError: (text: string) => void };

// Chargé à la demande : TipTap et Yjs restent hors du paquet des bases.
export default function ItemDoc({ base, workspaceId, item, members, myId, editable, onError }: Props) {
	const [meta, setMeta] = useState<CanvasMeta | null>(null);
	const [session, setSession] = useState<{ doc: Y.Doc; sync: CanvasSync } | null>(null);
	const [wanted, setWanted] = useState(Boolean(item.pageId));

	useEffect(() => {
		if (!wanted) {
			return;
		}
		let live = true;
		api<CanvasMeta>('POST', `${base}/items/${item.id}/page`)
			.then((next) => live && setMeta(next))
			.catch((e: unknown) => onError(errorText(e)));
		return () => {
			live = false;
		};
	}, [base, item.id, wanted]);

	useEffect(() => {
		if (!meta) {
			return;
		}
		const doc = new Y.Doc();
		const sync = new CanvasSync(doc, `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api${base}/items/${item.id}/page/ws`);
		setSession({ doc, sync });
		return () => {
			sync.destroy();
			doc.destroy();
			setSession(null);
		};
	}, [meta?.id]);

	if (!wanted) {
		return editable ? (
			<button type='button' className='bs-doc-start' onClick={() => setWanted(true)}>
				Écrire le document de l’élément : notes, specs, compte-rendu…
			</button>
		) : (
			<p className='muted'>Pas encore de document.</p>
		);
	}
	if (!meta || !session) {
		return <div className='spinner' aria-busy />;
	}
	return (
		<div className='bs-doc'>
			<CanvasEditor workspaceId={workspaceId} meta={meta} doc={session.doc} sync={session.sync} members={members} me={{ name: members.get(myId)?.name ?? 'Moi', color: colorFor(myId) }} title={item.title} onEditor={() => undefined} onError={onError} />
		</div>
	);
}
