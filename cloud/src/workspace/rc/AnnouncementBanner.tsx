import { useEffect, useState } from 'react';

import { RC_LIMITS, type Announcement } from '../../../shared/rc';
import { api, errorText } from '../../api';
import { Icon } from '../../ui';
import './rc.css';

type Props = {
	workspaceId: string;
	channelId: string;
	// Dernière valeur reçue en temps réel, prioritaire sur le chargement initial.
	live: string | undefined;
	canEdit: boolean;
	editing: boolean;
	onEditing: (editing: boolean) => void;
};

export function AnnouncementBanner({ workspaceId, channelId, live, canEdit, editing, onEditing }: Props) {
	const [loaded, setLoaded] = useState('');
	const [expanded, setExpanded] = useState(false);
	const path = `/w/${workspaceId}/channels/${channelId}/announcement`;

	useEffect(() => {
		let active = true;
		api<Announcement>('GET', path)
			.then((a) => active && setLoaded(a.text))
			.catch(() => undefined);
		return () => {
			active = false;
		};
	}, [path]);

	const text = live ?? loaded;

	if (editing && canEdit) {
		return <AnnouncementEditor initial={text} onCancel={() => onEditing(false)} onSave={async (next) => {
			await api('PUT', path, { text: next });
			onEditing(false);
		}} />;
	}
	if (!text) {
		return null;
	}
	return (
		<div className={`announce${expanded ? ' announce-open' : ''}`} role='note' aria-label='Annonce du salon'>
			<Icon name='megaphone' size={16} />
			<button type='button' className='announce-text' aria-expanded={expanded} title={expanded ? 'Réduire' : 'Afficher tout'} onClick={() => setExpanded(!expanded)}>
				{text}
			</button>
			{canEdit && (
				<button type='button' className='icon-btn icon-btn-sm' aria-label='Modifier l’annonce' title='Modifier l’annonce' onClick={() => onEditing(true)}>
					<Icon name='pencil' size={14} />
				</button>
			)}
		</div>
	);
}

function AnnouncementEditor({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => Promise<void>; onCancel: () => void }) {
	const [value, setValue] = useState(initial);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const save = async (text: string) => {
		setBusy(true);
		setError(null);
		try {
			await onSave(text);
		} catch (e) {
			setError(errorText(e));
			setBusy(false);
		}
	};

	return (
		<form
			className='announce-edit'
			onSubmit={(e) => {
				e.preventDefault();
				void save(value);
			}}
		>
			<label className='sr-only' htmlFor='announce-text'>
				Annonce du salon
			</label>
			<textarea
				id='announce-text'
				autoFocus
				rows={2}
				maxLength={RC_LIMITS.announcement}
				value={value}
				placeholder='Affichée en bandeau en haut du salon'
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => e.key === 'Escape' && onCancel()}
			/>
			{error && (
				<p className='notice notice-error' role='alert'>
					{error}
				</p>
			)}
			<div className='rc-actions'>
				<span className='rc-count'>
					{value.length} / {RC_LIMITS.announcement}
				</span>
				<span className='grow' />
				{initial && (
					<button type='button' className='btn' disabled={busy} onClick={() => void save('')}>
						Retirer
					</button>
				)}
				<button type='button' className='btn' onClick={onCancel}>
					Annuler
				</button>
				<button type='submit' className='btn btn-primary' disabled={busy}>
					Publier
				</button>
			</div>
		</form>
	);
}
