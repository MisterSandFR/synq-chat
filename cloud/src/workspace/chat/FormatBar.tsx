import { Fragment } from 'react';

import { Icon, type IconName } from '../../ui';
import type { FormatKind } from './format';
import './chat.css';

const TOOLS: Array<{ kind: FormatKind; icon: IconName; label: string; group?: true }> = [
	{ kind: 'bold', icon: 'bold', label: 'Gras (Ctrl B)' },
	{ kind: 'italic', icon: 'italic', label: 'Italique (Ctrl I)' },
	{ kind: 'strike', icon: 'strike', label: 'Barré (Ctrl Maj X)' },
	{ kind: 'link', icon: 'link', label: 'Lien', group: true },
	{ kind: 'list', icon: 'list', label: 'Liste à puces', group: true },
	{ kind: 'ordered', icon: 'list-ordered', label: 'Liste numérotée' },
	{ kind: 'quote', icon: 'quote', label: 'Citation' },
	{ kind: 'code', icon: 'code', label: 'Code', group: true },
	{ kind: 'codeblock', icon: 'code-block', label: 'Bloc de code' },
];

export function FormatBar({ onFormat }: { onFormat: (kind: FormatKind) => void }) {
	return (
		<div className='format-bar' role='toolbar' aria-label='Mise en forme'>
			{TOOLS.map((tool) => (
				<Fragment key={tool.kind}>
					{tool.group && <span className='format-sep' aria-hidden />}
					<button
						type='button'
						className='icon-btn icon-btn-sm'
						aria-label={tool.label}
						title={tool.label}
						// Garde la sélection du champ.
						onMouseDown={(e) => e.preventDefault()}
						onClick={() => onFormat(tool.kind)}
					>
						<Icon name={tool.icon} size={16} />
					</button>
				</Fragment>
			))}
		</div>
	);
}
