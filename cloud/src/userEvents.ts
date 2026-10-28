import { useEffect, useRef } from 'react';

import type { UserEvent } from '../shared/user-events';

// Canal personnel ; `resync` à chaque (re)connexion : les changements manqués se relisent.
export function useUserEvents(onEvent: (event: UserEvent | { t: 'resync' }) => void): void {
	const handler = useRef(onEvent);
	handler.current = onEvent;

	useEffect(() => {
		let stopped = false;
		let retry = 0;
		let socket: WebSocket | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let opened = false;
		const connect = () => {
			const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/me/ws`);
			socket = ws;
			ws.onopen = () => {
				retry = 0;
				// Premier chargement déjà fait par la page : seules les reconnexions relisent.
				if (opened) {
					handler.current({ t: 'resync' });
				}
				opened = true;
			};
			ws.onmessage = (message) => {
				if (message.data !== 'pong') {
					handler.current(JSON.parse(message.data as string) as UserEvent);
				}
			};
			ws.onclose = () => {
				if (!stopped) {
					timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** retry++));
				}
			};
		};
		connect();
		const ping = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send('ping'), 25_000);
		return () => {
			stopped = true;
			clearTimeout(timer);
			clearInterval(ping);
			socket?.close(1000);
		};
	}, []);
}
