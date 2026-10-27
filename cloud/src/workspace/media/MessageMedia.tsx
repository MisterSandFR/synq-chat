import { useEffect, useRef, useState } from 'react';

import { firstUrl, type LinkPreview } from '../../../shared/media';
import type { Attachment, Message } from '../../../shared/types';
import { api, fileUrl } from '../../api';
import { Icon, fileIcon, formatSize } from '../../ui';
import { Lightbox } from './Lightbox';
import './media.css';

// Alignés sur les types servis en ligne par le Worker.
const IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);
const VIDEOS = new Set(['video/mp4', 'video/webm']);
const AUDIOS = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4']);
const GRID_MAX = 4;

const typeLabel = (a: Attachment) => (a.name.includes('.') ? a.name.split('.').pop()! : (a.type.split('/').pop() ?? '')).slice(0, 8).toUpperCase();

async function downloadAll(workspaceId: string, list: Attachment[]) {
	for (const a of list) {
		const link = document.createElement('a');
		link.href = fileUrl(workspaceId, a.key);
		link.download = a.name;
		document.body.append(link);
		link.click();
		link.remove();
		// Écart entre téléchargements : sinon le navigateur n'en garde qu'un.
		await new Promise((resolve) => setTimeout(resolve, 350));
	}
}

type Props = { workspaceId: string; message: Message; onLoad: () => void };

export function MessageMedia({ workspaceId, message, onLoad }: Props) {
	const [viewer, setViewer] = useState<number | null>(null);
	const list = message.attachments;
	const images = list.filter((a) => IMAGES.has(a.type));
	const videos = list.filter((a) => VIDEOS.has(a.type));
	const audios = list.filter((a) => AUDIOS.has(a.type));
	const files = list.filter((a) => !IMAGES.has(a.type) && !VIDEOS.has(a.type) && !AUDIOS.has(a.type));
	const shown = images.slice(0, GRID_MAX);
	const link = firstUrl(message.body);

	return (
		<>
			{list.length > 0 && (
				<div className='media'>
					{shown.length > 0 && (
						<div className={`media-grid media-grid-${shown.length}`}>
							{shown.map((a, i) => (
								<button key={a.key} type='button' className='media-tile' aria-label={`Agrandir ${a.name}`} onClick={() => setViewer(i)}>
									<img src={fileUrl(workspaceId, a.key)} alt={a.name} loading='lazy' onLoad={onLoad} />
									{i === GRID_MAX - 1 && images.length > GRID_MAX && <span className='media-more'>+{images.length - GRID_MAX}</span>}
								</button>
							))}
						</div>
					)}
					{videos.map((a) => (
						<video key={a.key} className='media-video' src={fileUrl(workspaceId, a.key)} controls playsInline preload='metadata' aria-label={a.name} onLoadedMetadata={onLoad} />
					))}
					{audios.map((a) => (
						<div key={a.key} className='media-audio'>
							<span className='file-icon'>
								<Icon name='music' />
							</span>
							<span className='media-audio-body'>
								<span className='media-name'>{a.name}</span>
								<audio src={fileUrl(workspaceId, a.key)} controls preload='metadata' />
							</span>
						</div>
					))}
					{files.map((a) => (
						<a key={a.key} className='attachment-file' href={fileUrl(workspaceId, a.key)} download={a.name}>
							<span className='file-icon'>
								<Icon name={fileIcon(a.type)} />
							</span>
							<span className='file-meta'>
								<span>{a.name}</span>
								<span>
									{typeLabel(a)} · {formatSize(a.size)}
								</span>
							</span>
							<Icon name='download' size={16} />
						</a>
					))}
					{list.length > 1 && (
						<button type='button' className='btn media-download' onClick={() => void downloadAll(workspaceId, list)}>
							<Icon name='download' size={16} />
							Tout télécharger ({list.length})
						</button>
					)}
				</div>
			)}
			{link && <LinkCard workspaceId={workspaceId} url={link} onLoad={onLoad} />}
			{viewer !== null && <Lightbox workspaceId={workspaceId} items={images} start={viewer} onClose={() => setViewer(null)} />}
		</>
	);
}

// Un appel par lien et par session, partagé entre messages.
const previews = new Map<string, Promise<LinkPreview | null>>();

function LinkCard({ workspaceId, url, onLoad }: { workspaceId: string; url: string; onLoad: () => void }) {
	const [preview, setPreview] = useState<LinkPreview | null>(null);
	const [imageFailed, setImageFailed] = useState(false);

	useEffect(() => {
		let local = false;
		try {
			local = new URL(url).origin === window.location.origin;
		} catch {
			return;
		}
		if (local) {
			return;
		}
		let alive = true;
		let pending = previews.get(url);
		if (!pending) {
			pending = api<LinkPreview | null>('GET', `/w/${workspaceId}/unfurl?url=${encodeURIComponent(url)}`).catch(() => null);
			previews.set(url, pending);
		}
		void pending.then((value) => alive && setPreview(value));
		return () => {
			alive = false;
		};
	}, [workspaceId, url]);

	// Ref : onLoad change à chaque rendu de la liste.
	const loaded = useRef(onLoad);
	loaded.current = onLoad;
	useEffect(() => {
		if (preview) {
			loaded.current();
		}
	}, [preview]);

	if (!preview) {
		return null;
	}
	return (
		<a className='link-preview' href={url} target='_blank' rel='noopener noreferrer'>
			<span className='link-preview-text'>
				<span className='link-preview-site'>{preview.siteName}</span>
				{preview.title && <span className='link-preview-title'>{preview.title}</span>}
				{preview.description && <span className='link-preview-desc'>{preview.description}</span>}
			</span>
			{preview.image && !imageFailed && <img src={preview.image} alt='' loading='lazy' referrerPolicy='no-referrer' onLoad={onLoad} onError={() => setImageFailed(true)} />}
		</a>
	);
}
