import { useCallback, useEffect, useRef, useState } from 'react';

import type { MailMessage } from '../../shared/mail';
import { api, errorText } from '../api';
import { Icon } from '../ui';

type Rendered = { html: string; blockedImages: number };

export function MailBody({ message, plain }: { message: MailMessage; plain?: boolean }) {
	const [images, setImages] = useState(false);
	const [doc, setDoc] = useState<Rendered | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [height, setHeight] = useState(60);
	const frame = useRef<HTMLIFrameElement>(null);
	const html = message.hasHtml && !plain;

	useEffect(() => {
		if (!html) {
			return;
		}
		let cancelled = false;
		api<Rendered>('GET', `/mail/messages/${message.id}/html?images=${images ? 1 : 0}`)
			.then((result) => !cancelled && setDoc(result))
			.catch((e) => !cancelled && setError(errorText(e)));
		return () => {
			cancelled = true;
		};
	}, [message.id, html, images]);

	const measure = useCallback(() => {
		const inner = frame.current?.contentDocument;
		if (inner?.documentElement) {
			setHeight(Math.max(40, inner.documentElement.scrollHeight, inner.body?.scrollHeight ?? 0));
		}
	}, []);

	// Sans allow-scripts : la hauteur se mesure depuis la page (allow-same-origin).
	const onLoad = () => {
		const inner = frame.current?.contentDocument;
		if (!inner) {
			return;
		}
		measure();
		inner.addEventListener('load', measure, true);
		const observer = new ResizeObserver(measure);
		observer.observe(inner.documentElement);
		frame.current?.addEventListener('load', () => observer.disconnect(), { once: true });
	};

	if (!html) {
		return <div className='mail-msg-text'>{message.body}</div>;
	}
	if (error) {
		return (
			<>
				<p className='notice notice-error'>{error}</p>
				<div className='mail-msg-text'>{message.body}</div>
			</>
		);
	}
	if (!doc) {
		return <div className='spinner' aria-busy />;
	}
	return (
		<>
			{doc.blockedImages > 0 && !images && (
				<div className='mail-images'>
					<Icon name='eye-off' size={15} />
					<span>Images masquées</span>
					<button className='link' onClick={() => setImages(true)}>
						Afficher
					</button>
				</div>
			)}
			<iframe
				ref={frame}
				className='mail-frame'
				title={message.subject || 'Message'}
				srcDoc={doc.html}
				sandbox='allow-popups allow-popups-to-escape-sandbox allow-same-origin'
				referrerPolicy='no-referrer'
				style={{ height }}
				onLoad={onLoad}
			/>
		</>
	);
}
