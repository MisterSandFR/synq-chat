import { useCallback, useEffect, useState } from 'react';

import type { Me } from '../shared/types';
import { api, ApiError } from './api';
import { AuthScreen } from './AuthScreen';
import { CalendarView } from './calendar/CalendarView';
import { HomeScreen } from './HomeScreen';
import { InviteScreen } from './InviteScreen';
import { GuestScreen } from './workspace/guests/GuestScreen';
import { MailView } from './mail/MailView';
import { lastWorkspace, navigate, takeReturn, takeSsoNotice, usePath } from './router';
import { Shell, type RailItem } from './shell/Shell';
import { WorkspaceView } from './workspace/WorkspaceView';

export type Notice = { tone: 'error' | 'ok'; text: string } | null;

export function App() {
	const [me, setMe] = useState<Me | null | undefined>(undefined);
	const [notice, setNotice] = useState<Notice>(() => takeSsoNotice());
	const [badges, setBadges] = useState<Record<string, number>>({});
	const path = usePath();

	const refresh = useCallback(async (): Promise<Me | null> => {
		// Panne réseau ou serveur : on réessaie au lieu de rester bloqué sur le chargement.
		for (let attempt = 0; ; attempt++) {
			try {
				const next = await api<Me>('GET', '/me');
				setMe(next);
				return next;
			} catch (error) {
				if (error instanceof ApiError && error.status === 401) {
					setMe(null);
					return null;
				}
				await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, 500 * 2 ** attempt)));
			}
		}
	}, []);

	useEffect(() => {
		void refresh().then((loaded) => {
			const back = takeReturn();
			const last = lastWorkspace();
			if (back && back !== '/') {
				navigate(back, true);
			} else if (location.pathname === '/' && !notice && loaded?.workspaces.some((w) => w.id === last)) {
				navigate(`/w/${last}`, true);
			}
		});
		const onUnauthorized = () => setMe(null);
		window.addEventListener('synq:unauthorized', onUnauthorized);
		return () => window.removeEventListener('synq:unauthorized', onUnauthorized);
	}, [refresh]);

	if (me === undefined) {
		return <div className='spinner' style={{ height: '100vh' }} aria-busy />;
	}
	// Lien d'invité : accessible sans compte.
	const guestLink = path.match(/^\/invite\/guest\/([\w-]+)$/);
	if (guestLink) {
		return <GuestScreen token={guestLink[1]!} onJoined={refresh} />;
	}
	if (me === null) {
		return <AuthScreen notice={notice} onSignedIn={refresh} />;
	}

	const invite = path.match(/^\/invite\/([\w-]+)$/);
	if (invite) {
		return <InviteScreen code={invite[1]!} onJoined={refresh} />;
	}
	const workspace = path.match(/^\/w\/([\w-]+)(?:\/([\w-]+))?(?:\/[\w-]+)?$/);
	const inWorkspace = Boolean(workspace && me.workspaces.some((w) => w.id === workspace[1]));
	const last = lastWorkspace();
	const currentId = inWorkspace ? workspace![1]! : me.workspaces.some((w) => w.id === last) ? last : (me.workspaces[0]?.id ?? null);
	const page = inWorkspace ? workspace![2] : undefined;
	const items: RailItem[] = [{ key: 'home', label: 'Accueil', icon: 'home', href: currentId ? `/w/${currentId}` : '/espaces', active: inWorkspace && page !== 'activite' && page !== 'messages' }];
	if (currentId) {
		items.push(
			{ key: 'dms', label: 'Messages', icon: 'chat', href: `/w/${currentId}/messages`, active: page === 'messages', badge: badges.dms },
			{ key: 'activity', label: 'Activité', icon: 'bell', href: `/w/${currentId}/activite`, active: page === 'activite', badge: badges.activity },
		);
	}
	items.push(
		{ key: 'calendar', label: 'Calendrier', icon: 'calendar', href: '/calendrier', active: path === '/calendrier' },
		{ key: 'mail', label: 'Mail', icon: 'mail', href: '/mail', active: path === '/mail' },
	);
	if (me.guest) {
		// Invité : ni calendrier ni mail.
		items.splice(0, items.length, ...items.filter((item) => item.key !== 'calendar' && item.key !== 'mail'));
	}
	if (!me.guest && (path === '/calendrier' || path === '/mail')) {
		return (
			<Shell me={me} workspaceId={currentId} items={items}>
				{path === '/calendrier' ? <CalendarView me={me} workspaces={me.workspaces} /> : <MailView me={me} workspaces={me.workspaces} />}
			</Shell>
		);
	}
	if (inWorkspace) {
		return (
			<Shell me={me} workspaceId={currentId} items={items}>
				<WorkspaceView key={workspace![1]} me={me} workspaceId={workspace![1]!} channelId={workspace![2] ?? null} onMeChanged={refresh} onBadges={setBadges} />
			</Shell>
		);
	}
	return <HomeScreen me={me} notice={notice} onNotice={setNotice} onChanged={refresh} />;
}
