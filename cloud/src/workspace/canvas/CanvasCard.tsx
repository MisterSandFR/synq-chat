import { useEffect, useState, type MouseEvent } from 'react';

import { CANVAS_LINK_RE, canvasPath, type CanvasMeta } from '../../../shared/canvas';
import { api, errorText } from '../../api';
import { navigate } from '../../router';
import { Avatar, Icon } from '../../ui';
import type { Lookup } from '../richText';
import './canvas-card.css';

const cache = new Map<string, Promise<CanvasMeta | null>>();

const go = (href: string) => (event: MouseEvent) => {
	if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
		event.preventDefault();
		navigate(href);
	}
};

export function CanvasLinkCard({ workspaceId, body, lookup }: { workspaceId: string; body: string; lookup: Lookup }) {
	const match = body.match(CANVAS_LINK_RE);
	const id = match && match[1] === workspaceId ? match[2]! : null;
	const [meta, setMeta] = useState<CanvasMeta | null>(null);

	useEffect(() => {
		if (!id) {
			return;
		}
		const key = `${workspaceId}/${id}`;
		let pending = cache.get(key);
		if (!pending) {
			pending = api<CanvasMeta>('GET', `/w/${workspaceId}/canvases/${id}`).catch(() => null);
			cache.set(key, pending);
		}
		let alive = true;
		void pending.then((value) => alive && setMeta(value));
		return () => {
			alive = false;
		};
	}, [workspaceId, id]);

	if (!meta) {
		return null;
	}
	const href = canvasPath(workspaceId, meta.id);
	return (
		<a href={href} className='canvas-card' onClick={go(href)}>
			<span className='canvas-card-icon'>
				<Icon name='file' size={20} />
			</span>
			<span className='canvas-card-main'>
				<strong className='ellipsis'>{meta.title}</strong>
				<span className='canvas-card-excerpt'>{meta.excerpt || 'Page vide pour l’instant'}</span>
				<span className='canvas-card-foot'>
					<span className='canvas-card-editors'>
						{meta.editors.slice(0, 4).map((uid) => {
							const member = lookup.members.get(uid);
							return member ? <Avatar key={uid} name={member.name} url={member.avatarUrl} size={20} /> : null;
						})}
					</span>
					Page
					{meta.access === 'read' && <span className='canvas-card-pill'>Lecture seule</span>}
				</span>
			</span>
		</a>
	);
}
