import { useCallback, useEffect, useState } from 'react';

import type { Me } from '../shared/types';
import { api, ApiError } from './api';
import { AuthScreen } from './AuthScreen';
import { HomeScreen } from './HomeScreen';
import { InviteScreen } from './InviteScreen';
import { lastWorkspace, navigate, takeReturn, takeSsoNotice, usePath } from './router';
import { WorkspaceView } from './workspace/WorkspaceView';

export type Notice = { tone: 'error' | 'ok'; text: string } | null;

export function App() {
	const [me, setMe] = useState<Me | null | undefined>(undefined);
	const [notice, setNotice] = useState<Notice>(() => takeSsoNotice());
	const path = usePath();

	const refresh = useCallback(async (): Promise<Me | null> => {
		try {
			const next = await api<Me>('GET', '/me');
			setMe(next);
			return next;
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				setMe(null);
				return null;
			}
			throw error;
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
	if (me === null) {
		return <AuthScreen notice={notice} onSignedIn={refresh} />;
	}

	const invite = path.match(/^\/invite\/([\w-]+)$/);
	if (invite) {
		return <InviteScreen code={invite[1]!} onJoined={refresh} />;
	}
	const workspace = path.match(/^\/w\/([\w-]+)(?:\/([\w-]+))?$/);
	if (workspace && me.workspaces.some((w) => w.id === workspace[1])) {
		return <WorkspaceView key={workspace[1]} me={me} workspaceId={workspace[1]!} channelId={workspace[2] ?? null} onMeChanged={refresh} />;
	}
	return <HomeScreen me={me} notice={notice} onNotice={setNotice} onChanged={refresh} />;
}
