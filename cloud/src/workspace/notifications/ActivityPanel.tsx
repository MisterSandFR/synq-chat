import { useCallback, useEffect, useMemo, useState } from 'react';

import type { NotificationFilter, NotificationItem, NotificationKind, NotificationPage, NotifyLevel } from '../../../shared/notifications';
import type { Channel, Member } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Avatar, Icon, type IconName } from '../../ui';
import { Snippet } from '../richText';
import { browserEnabled, browserSupported, disableBrowserNotifications, enableBrowserNotifications, openNotification } from './browser';
import './activity.css';

type Props = {
	workspaceId: string;
	channels: Channel[];
	members: Map<string, Member>;
	unread: number;
	// `state.notificationsVersion` : recharge à chaque évènement.
	version: number;
	onOpenMessage: (channelId: string, messageId: number) => void;
	onClose?: () => void;
};

const FILTERS: Array<{ id: NotificationFilter; label: string }> = [
	{ id: 'all', label: 'Tout' },
	{ id: 'mentions', label: 'Mentions' },
	{ id: 'unread', label: 'Non lues' },
];

const KIND_ICON: Record<NotificationKind, IconName> = {
	mention: 'at',
	reply: 'reply',
	message: 'hash',
	dm: 'chat',
	thread: 'chat',
	reaction: 'smile',
	calendar: 'calendar',
	mail: 'mail',
	scheduled: 'clock',
};

const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const longDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

function dayLabel(at: number): string {
	const day = new Date(at).setHours(0, 0, 0, 0);
	const today = new Date().setHours(0, 0, 0, 0);
	if (day === today) {
		return 'Aujourd’hui';
	}
	if (day === today - 86_400_000) {
		return 'Hier';
	}
	const label = longDay.format(at);
	return label.charAt(0).toUpperCase() + label.slice(1);
}

function groupByDay(items: NotificationItem[]): Array<{ label: string; items: NotificationItem[] }> {
	const groups: Array<{ label: string; items: NotificationItem[] }> = [];
	for (const item of items) {
		const label = dayLabel(item.createdAt);
		const last = groups.at(-1);
		if (last?.label === label) {
			last.items.push(item);
		} else {
			groups.push({ label, items: [item] });
		}
	}
	return groups;
}

export function ActivityPanel({ workspaceId, channels, members, unread, version, onOpenMessage, onClose }: Props) {
	const [filter, setFilter] = useState<NotificationFilter>('all');
	const [items, setItems] = useState<NotificationItem[] | null>(null);
	const [next, setNext] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [prefsOpen, setPrefsOpen] = useState(false);
	const lookup = useMemo(() => ({ members, channels }), [members, channels]);

	const fetchPage = useCallback((before: number | null) => api<NotificationPage>('GET', `/w/${workspaceId}/notifications?filter=${filter}${before ? `&before=${before}` : ''}`), [workspaceId, filter]);

	useEffect(() => setItems(null), [filter]);

	// Recharge la première page sans perdre les pages plus anciennes déjà affichées.
	useEffect(() => {
		let cancelled = false;
		fetchPage(null)
			.then((page) => {
				if (cancelled) {
					return;
				}
				const oldest = page.items.at(-1)?.id;
				setItems((current) => [...page.items, ...(current ?? []).filter((n) => oldest !== undefined && n.id < oldest)]);
				setNext((current) => (current !== null && oldest !== undefined && current < oldest ? current : page.next));
				setError(null);
			})
			.catch((err) => !cancelled && setError(errorText(err)));
		return () => {
			cancelled = true;
		};
	}, [fetchPage, version]);

	const loadMore = async () => {
		try {
			const page = await fetchPage(next);
			setItems((current) => [...(current ?? []), ...page.items]);
			setNext(page.next);
		} catch (err) {
			setError(errorText(err));
		}
	};

	const markRead = async (ids: number[] | 'all') => {
		const now = Date.now();
		setItems((current) => current?.map((n) => (n.readAt === null && (ids === 'all' || ids.includes(n.id)) ? { ...n, readAt: now } : n)) ?? null);
		try {
			await api('POST', `/w/${workspaceId}/notifications/read`, ids === 'all' ? { all: true } : { ids });
		} catch (err) {
			setError(errorText(err));
		}
	};

	const open = (item: NotificationItem) => {
		if (item.readAt === null) {
			void markRead([item.id]);
		}
		openNotification(item, onOpenMessage);
	};

	return (
		<section className='activity' aria-label='Activité'>
			<header className='activity-head'>
				<h2>Activité</h2>
				{unread > 0 && <span className='activity-count'>{unread}</span>}
				<span className='grow' />
				{!prefsOpen && (
					<button type='button' className='btn btn-ghost' disabled={unread === 0} onClick={() => void markRead('all')}>
						<Icon name='check' size={16} />
						<span className='hide-mobile'>Tout marquer lu</span>
					</button>
				)}
				<button type='button' className='icon-btn' aria-pressed={prefsOpen} aria-label='Préférences de notification' title='Préférences de notification' onClick={() => setPrefsOpen(!prefsOpen)}>
					<Icon name='settings' />
				</button>
				{onClose && (
					<button type='button' className='icon-btn' aria-label='Fermer l’activité' onClick={onClose}>
						<Icon name='close' />
					</button>
				)}
			</header>

			{prefsOpen ? (
				<ActivityPrefs workspaceId={workspaceId} channels={channels} />
			) : (
				<>
					<div className='activity-filters'>
						<div className='segmented' role='tablist' aria-label='Filtrer'>
							{FILTERS.map((f) => (
								<button key={f.id} type='button' role='tab' aria-selected={filter === f.id} onClick={() => setFilter(f.id)}>
									{f.label}
								</button>
							))}
						</div>
					</div>
					{error && <p className='notice notice-error activity-notice'>{error}</p>}
					<div className='activity-scroll'>
						{items === null ? (
							<div className='spinner' aria-busy />
						) : items.length === 0 ? (
							<div className='activity-empty'>
								<Icon name='bell' size={22} />
								<p>{filter === 'unread' ? 'Tout est lu.' : filter === 'mentions' ? 'Aucune mention pour l’instant.' : 'Rien de nouveau. Les mentions et réponses apparaîtront ici.'}</p>
							</div>
						) : (
							groupByDay(items).map((group) => (
								<section key={group.label} className='activity-group'>
									<h3 className='activity-day'>{group.label}</h3>
									<ul className='activity-list'>
										{group.items.map((item) => {
											const actor = item.actorId ? members.get(item.actorId) : undefined;
											return (
												<li key={item.id} className={`activity-item${item.readAt === null ? ' is-unread' : ''}`}>
													<button type='button' className='activity-main' onClick={() => open(item)}>
														<span className='activity-avatar'>
															{actor ? (
																<Avatar name={actor.name} url={actor.avatarUrl} size={34} />
															) : (
																<span className='activity-glyph'>
																	<Icon name={KIND_ICON[item.kind]} />
																</span>
															)}
															{actor && (
																<span className='activity-kind'>
																	<Icon name={KIND_ICON[item.kind]} size={11} strokeWidth={2.2} />
																</span>
															)}
														</span>
														<span className='activity-text'>
															<span className='activity-title'>{item.title}</span>
															{item.body && (
																<span className='activity-excerpt'>
																	<Snippet text={item.body} lookup={lookup} />
																</span>
															)}
														</span>
														<time className='activity-time' dateTime={new Date(item.createdAt).toISOString()}>
															{time.format(item.createdAt)}
														</time>
													</button>
													{item.readAt === null && (
														<button type='button' className='icon-btn activity-read' aria-label='Marquer comme lu' title='Marquer comme lu' onClick={() => void markRead([item.id])}>
															<Icon name='check' size={16} />
														</button>
													)}
												</li>
											);
										})}
									</ul>
								</section>
							))
						)}
						{items && next !== null && (
							<button type='button' className='btn btn-ghost activity-more' onClick={() => void loadMore()}>
								Afficher plus
							</button>
						)}
					</div>
				</>
			)}
		</section>
	);
}

const LEVELS: Array<{ id: NotifyLevel; label: string }> = [
	{ id: 'all', label: 'Tout' },
	{ id: 'mentions', label: 'Mentions' },
	{ id: 'none', label: 'Rien' },
];

function ActivityPrefs({ workspaceId, channels }: { workspaceId: string; channels: Channel[] }) {
	const [prefs, setPrefs] = useState<Record<string, NotifyLevel> | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [browser, setBrowser] = useState(browserEnabled);
	const [permission, setPermission] = useState(() => (browserSupported() ? Notification.permission : 'denied'));

	useEffect(() => {
		api<Record<string, NotifyLevel>>('GET', `/w/${workspaceId}/notifications/prefs`)
			.then(setPrefs)
			.catch((err) => setError(errorText(err)));
	}, [workspaceId]);

	const setLevel = async (channelId: string, level: NotifyLevel) => {
		const previous = prefs;
		setPrefs({ ...prefs, [channelId]: level });
		try {
			await api('PUT', `/w/${workspaceId}/notifications/prefs/${channelId}`, { level });
		} catch (err) {
			setPrefs(previous);
			setError(errorText(err));
		}
	};

	const toggleBrowser = async () => {
		if (browser) {
			disableBrowserNotifications();
			setBrowser(false);
			return;
		}
		const granted = await enableBrowserNotifications();
		setPermission(granted);
		setBrowser(granted === 'granted');
	};

	return (
		<div className='activity-scroll activity-prefs'>
			{error && <p className='notice notice-error'>{error}</p>}
			<section className='activity-pref-block'>
				<h3>Notifications du navigateur</h3>
				<div className='activity-pref-row'>
					<p className='activity-pref-hint'>
						{!browserSupported()
							? 'Ton navigateur ne gère pas les notifications.'
							: permission === 'denied'
								? 'Bloquées par le navigateur. Autorise-les dans les réglages du site.'
								: 'Une alerte système quand l’onglet est en arrière-plan.'}
					</p>
					{browserSupported() && permission !== 'denied' && (
						<button type='button' className={`btn${browser ? '' : ' btn-primary'}`} onClick={() => void toggleBrowser()}>
							{browser ? 'Désactiver' : 'Activer'}
						</button>
					)}
				</div>
			</section>
			<section className='activity-pref-block'>
				<h3>Par salon</h3>
				<p className='activity-pref-hint'>Mentions : mentions et réponses à tes messages. Rien : aucune notification du salon.</p>
				{prefs === null ? (
					<div className='spinner' aria-busy />
				) : (
					<ul className='activity-pref-list'>
						{channels.map((channel) => (
							<li key={channel.id} className='activity-pref-row'>
								<span className='activity-pref-name'>
									<Icon name={channel.kind === 'voice' ? 'speaker' : 'hash'} size={16} />
									<span className='ellipsis'>{channel.name}</span>
								</span>
								<div className='segmented' role='radiogroup' aria-label={`Notifications de ${channel.name}`}>
									{LEVELS.map((level) => (
										<button
											key={level.id}
											type='button'
											role='radio'
											aria-checked={(prefs[channel.id] ?? 'mentions') === level.id}
											aria-selected={(prefs[channel.id] ?? 'mentions') === level.id}
											onClick={() => void setLevel(channel.id, level.id)}
										>
											{level.label}
										</button>
									))}
								</div>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
