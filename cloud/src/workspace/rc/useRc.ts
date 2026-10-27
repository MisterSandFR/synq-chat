import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AWAY_AFTER, type Presence, type Profile, type ProfileInput, type SavedMessage } from '../../../shared/rc';
import type { Message, WorkspaceDetail } from '../../../shared/types';
import { api } from '../../api';
import { readPref, writePref } from '../../router';

export const presenceOf = (profile: Profile | undefined, online: boolean): Presence => (online ? (profile?.status ?? 'online') : 'offline');

export function useRc(workspaceId: string, myId: string, info: WorkspaceDetail | null) {
	const [profiles, setProfiles] = useState<Map<string, Profile>>(() => new Map());
	const [saved, setSaved] = useState<SavedMessage[]>([]);
	// Persisté : un onglet fermé pendant l'absence automatique repasse en ligne au retour.
	const auto = useRef(readPref('auto_away') === '1');
	const statusRef = useRef<Presence | undefined>(undefined);
	statusRef.current = profiles.get(myId)?.status;

	// Fiche de l'espace relue à chaque members_changed : les profils suivent.
	useEffect(() => {
		if (!info) {
			return;
		}
		let live = true;
		api<Profile[]>('GET', `/w/${workspaceId}/profiles`)
			.then((list) => live && setProfiles(new Map(list.map((p) => [p.userId, p]))))
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [workspaceId, info]);

	const reloadSaved = useCallback(async () => setSaved(await api<SavedMessage[]>('GET', `/w/${workspaceId}/saved`)), [workspaceId]);

	useEffect(() => {
		void reloadSaved().catch(() => undefined);
	}, [reloadSaved]);

	const savedIds = useMemo(() => new Set(saved.map((s) => s.message.id)), [saved]);

	const toggleSaved = useCallback(
		async (message: Message) => {
			await api('PUT', `/w/${workspaceId}/messages/${message.id}/saved`, { saved: !savedIds.has(message.id) });
			await reloadSaved();
		},
		[workspaceId, savedIds, reloadSaved],
	);

	const push = useCallback(async (input: ProfileInput) => {
		const profile = await api<Profile>('PATCH', '/me/profile', input);
		setProfiles((prev) => new Map(prev).set(profile.userId, profile));
		return profile;
	}, []);

	const setAuto = (value: boolean) => {
		auto.current = value;
		writePref('auto_away', value ? '1' : '');
	};

	const updateProfile = useCallback(
		(input: ProfileInput) => {
			if (input.status) {
				setAuto(false);
			}
			return push(input);
		},
		[push],
	);

	useEffect(() => {
		let last = Date.now();
		const active = () => {
			last = Date.now();
			if (auto.current) {
				setAuto(false);
				void push({ status: 'online' }).catch(() => undefined);
			}
		};
		const check = setInterval(() => {
			if (!auto.current && statusRef.current === 'online' && Date.now() - last > AWAY_AFTER) {
				setAuto(true);
				void push({ status: 'away' }).catch(() => undefined);
			}
		}, 30_000);
		const events = ['pointerdown', 'pointermove', 'keydown', 'focus'] as const;
		for (const name of events) {
			window.addEventListener(name, active, { passive: true });
		}
		return () => {
			clearInterval(check);
			for (const name of events) {
				window.removeEventListener(name, active);
			}
		};
	}, [push]);

	return { profiles, saved, savedIds, toggleSaved, reloadSaved, updateProfile };
}

export type Rc = ReturnType<typeof useRc>;
