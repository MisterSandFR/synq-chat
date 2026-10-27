import { useState } from 'react';

import { RC_LIMITS, USER_STATUSES, type Presence, type Profile, type ProfileInput, type UserStatus } from '../../../shared/rc';
import { errorText } from '../../api';
import { Dialog, Icon } from '../../ui';
import './rc.css';

export function StatusDot({ presence }: { presence: Presence }) {
	return <span className={`status-dot status-${presence}`} aria-hidden />;
}

type MenuProps = { current: Presence | undefined; onPick: (status: UserStatus) => void; onCustom: () => void; onProfile: () => void };

export function StatusMenuItems({ current, onPick, onCustom, onProfile }: MenuProps) {
	return (
		<>
			{USER_STATUSES.map((s) => (
				<button
					key={s.value}
					type='button'
					role='menuitemradio'
					aria-checked={current === s.value}
					className='menu-item'
					title={s.hint}
					onClick={() => onPick(s.value)}
				>
					<StatusDot presence={s.value} />
					<span className='grow'>{s.label}</span>
					{current === s.value && <Icon name='check' size={14} />}
				</button>
			))}
			<div className='rc-sep' role='separator' />
			<button type='button' role='menuitem' className='menu-item' onClick={onCustom}>
				<Icon name='compose' size={16} /> Définir un statut personnalisé
			</button>
			<button type='button' role='menuitem' className='menu-item' onClick={onProfile}>
				<Icon name='user' size={16} /> Modifier le profil
			</button>
			<div className='rc-sep' role='separator' />
		</>
	);
}

const DURATIONS = [
	{ label: 'Jamais', ms: 0 },
	{ label: '30 minutes', ms: 30 * 60_000 },
	{ label: '1 heure', ms: 60 * 60_000 },
	{ label: '4 heures', ms: 4 * 60 * 60_000 },
	{ label: 'Aujourd’hui', ms: -1 },
];

function untilFor(ms: number): number | null {
	if (ms === 0) {
		return null;
	}
	if (ms === -1) {
		const end = new Date();
		end.setHours(23, 59, 59, 999);
		return end.getTime();
	}
	return Date.now() + ms;
}

type DialogProps = { open: boolean; onClose: () => void; profile: Profile | undefined; onSave: (input: ProfileInput) => Promise<unknown> };

export function StatusDialog({ open, onClose, profile, onSave }: DialogProps) {
	return (
		<Dialog open={open} onClose={onClose} title='Statut personnalisé'>
			{profile && <StatusForm profile={profile} onSave={onSave} onClose={onClose} />}
		</Dialog>
	);
}

function StatusForm({ profile, onSave, onClose }: { profile: Profile; onSave: DialogProps['onSave']; onClose: () => void }) {
	const [text, setText] = useState(profile.statusText);
	const [duration, setDuration] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (input: ProfileInput) => {
		setBusy(true);
		setError(null);
		try {
			await onSave(input);
			onClose();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<form
			className='rc-form'
			onSubmit={(e) => {
				e.preventDefault();
				void submit({ statusText: text, statusUntil: text.trim() ? untilFor(duration) : null });
			}}
		>
			<label className='field'>
				<span>Que fais-tu ?</span>
				<input
					autoFocus
					maxLength={RC_LIMITS.statusText}
					value={text}
					placeholder='En réunion, en congé…'
					onChange={(e) => setText(e.target.value)}
				/>
			</label>
			<label className='field'>
				<span>Effacer après</span>
				<select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
					{DURATIONS.map((d) => (
						<option key={d.ms} value={d.ms}>
							{d.label}
						</option>
					))}
				</select>
			</label>
			{error && (
				<p className='notice notice-error' role='alert'>
					{error}
				</p>
			)}
			<div className='rc-actions'>
				{profile.statusText && (
					<button type='button' className='btn' disabled={busy} onClick={() => void submit({ statusText: '', statusUntil: null })}>
						Effacer le statut
					</button>
				)}
				<span className='grow' />
				<button type='button' className='btn' onClick={onClose}>
					Annuler
				</button>
				<button type='submit' className='btn btn-primary' disabled={busy}>
					Enregistrer
				</button>
			</div>
		</form>
	);
}
