import { useRef, useState, type DragEvent, type ReactNode } from 'react';

import { Icon } from '../../ui';
import { offerFiles } from './bus';
import './media.css';

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

export function DropZone({ enabled, children }: { enabled: boolean; children: ReactNode }) {
	const [over, setOver] = useState(false);
	// dragenter/dragleave se déclenchent aussi sur chaque enfant traversé.
	const depth = useRef(0);
	if (!enabled) {
		return <div className='drop-zone'>{children}</div>;
	}
	return (
		<div
			className='drop-zone'
			onDragEnter={(e) => {
				if (hasFiles(e)) {
					e.preventDefault();
					depth.current += 1;
					setOver(true);
				}
			}}
			onDragOver={(e) => {
				if (hasFiles(e)) {
					e.preventDefault();
					e.dataTransfer.dropEffect = 'copy';
				}
			}}
			onDragLeave={() => {
				depth.current = Math.max(0, depth.current - 1);
				if (!depth.current) {
					setOver(false);
				}
			}}
			onDrop={(e) => {
				if (!hasFiles(e)) {
					return;
				}
				e.preventDefault();
				depth.current = 0;
				setOver(false);
				offerFiles([...e.dataTransfer.files]);
			}}
		>
			{children}
			{over && (
				<div className='drop-overlay' aria-hidden>
					<Icon name='upload' size={28} />
					<span>Déposer pour joindre au message</span>
				</div>
			)}
		</div>
	);
}
