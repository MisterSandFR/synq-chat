import { useMemo, useState } from 'react';

import { AVATAR_TYPES, RC_LIMITS, type Profile, type ProfileInput } from '../../../shared/rc';
import type { Me, User } from '../../../shared/types';
import { api, errorText, upload } from '../../api';
import { Avatar, Dialog } from '../../ui';
import './rc.css';

type Props = {
	open: boolean;
	onClose: () => void;
	me: Me;
	profile: Profile | undefined;
	onSave: (input: ProfileInput) => Promise<unknown>;
	onAvatarChanged: () => Promise<unknown>;
};

export function ProfileDialog({ open, onClose, me, profile, onSave, onAvatarChanged }: Props) {
	return (
		<Dialog open={open} onClose={onClose} title='Profil'>
			{profile && <ProfileForm me={me} profile={profile} onSave={onSave} onAvatarChanged={onAvatarChanged} onClose={onClose} />}
		</Dialog>
	);
}

function zones(): string[] {
	const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
	return intl.supportedValuesOf?.('timeZone') ?? [];
}

function ProfileForm({ me, profile, onSave, onAvatarChanged, onClose }: Omit<Props, 'open' | 'profile'> & { profile: Profile }) {
	const [bio, setBio] = useState(profile.bio);
	const [timezone, setTimezone] = useState(profile.timezone);
	const [avatarUrl, setAvatarUrl] = useState(me.user.avatarUrl);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const list = useMemo(zones, []);
	const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	const run = async (task: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await task();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	const changeAvatar = (file: File | undefined) =>
		file &&
		void run(async () => {
			const user = await upload<User>('/me/avatar', file);
			setAvatarUrl(user.avatarUrl);
			await onAvatarChanged();
		});

	const removeAvatar = () =>
		void run(async () => {
			await api('DELETE', '/me/avatar');
			setAvatarUrl(null);
			await onAvatarChanged();
		});

	return (
		<form
			className='rc-form'
			onSubmit={(e) => {
				e.preventDefault();
				void run(async () => {
					await onSave({ bio, timezone });
					onClose();
				});
			}}
		>
			<div className='rc-avatar-row'>
				<Avatar name={me.user.name} url={avatarUrl} size={64} />
				<label className={`btn${busy ? ' is-disabled' : ''}`}>
					Changer la photo
					<input type='file' accept={AVATAR_TYPES.join(',')} hidden disabled={busy} onChange={(e) => changeAvatar(e.target.files?.[0])} />
				</label>
				{avatarUrl?.startsWith('/api/avatars/') && (
					<button type='button' className='btn' disabled={busy} onClick={removeAvatar}>
						Retirer
					</button>
				)}
				<span className='muted rc-hint'>PNG, JPEG, GIF ou WebP, 2 Mo max.</span>
			</div>
			<label className='field'>
				<span>Bio</span>
				<textarea
					rows={3}
					maxLength={RC_LIMITS.bio}
					value={bio}
					placeholder='Ton rôle, tes sujets, comment te joindre…'
					onChange={(e) => setBio(e.target.value)}
				/>
				<span className='rc-count'>
					{bio.length} / {RC_LIMITS.bio}
				</span>
			</label>
			<label className='field'>
				<span>Fuseau horaire</span>
				<select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
					<option value=''>Automatique ({browserZone})</option>
					{list.map((zone) => (
						<option key={zone} value={zone}>
							{zone.replace(/_/g, ' ')}
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
