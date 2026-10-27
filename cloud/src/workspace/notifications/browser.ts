import { useEffect, useRef } from 'react';

import type { NotificationItem } from '../../../shared/notifications';
import { navigate, readPref, writePref } from '../../router';
import { toDisplay, type Lookup } from '../richText';

const PREF = 'browser_notifications';

export const browserSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export const browserEnabled = () => browserSupported() && Notification.permission === 'granted' && readPref(PREF) === '1';

// Appelée seulement depuis un clic : les navigateurs refusent une demande sans geste.
export async function enableBrowserNotifications(): Promise<NotificationPermission> {
	const permission = await Notification.requestPermission();
	writePref(PREF, permission === 'granted' ? '1' : '0');
	return permission;
}

export const disableBrowserNotifications = () => writePref(PREF, '0');

export function openNotification(item: NotificationItem, onOpenMessage: (channelId: string, messageId: number) => void): void {
	if (item.channelId && item.messageId) {
		onOpenMessage(item.channelId, item.messageId);
	} else if (item.link) {
		navigate(item.link);
	}
}

// Seulement onglet masqué ou fenêtre sans focus ; sinon le panneau Activité suffit.
export function useBrowserNotifications(item: NotificationItem | null, lookup: Pick<Lookup, 'members' | 'channels'>, onOpen: (item: NotificationItem) => void): void {
	const latest = useRef({ lookup, onOpen });
	latest.current = { lookup, onOpen };

	useEffect(() => {
		if (!item || !browserEnabled() || (document.visibilityState === 'visible' && document.hasFocus())) {
			return;
		}
		const shown = new Notification(item.title, { body: toDisplay(item.body, latest.current.lookup), tag: `synq-${item.id}`, icon: '/logo.svg' });
		shown.onclick = () => {
			window.focus();
			latest.current.onOpen(item);
			shown.close();
		};
	}, [item]);
}
