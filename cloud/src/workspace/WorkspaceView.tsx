import { useEffect, useMemo, useState } from 'react';

import type { Channel, Me, Member, Message } from '../../shared/types';
import { api } from '../api';
import { navigate, rememberWorkspace } from '../router';
import { Avatar, Icon, Logo } from '../ui';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { SettingsDialog } from './SettingsDialog';
import { useWorkspace } from './useWorkspace';

type Props = {
	me: Me;
	workspaceId: string;
	channelId: string | null;
	onMeChanged: () => Promise<unknown>;
};

function useFocused(): boolean {
	const [focused, setFocused] = useState(() => document.hasFocus());
	useEffect(() => {
		const update = () => setFocused(document.visibilityState === 'visible' && document.hasFocus());
		window.addEventListener('focus', update);
		window.addEventListener('blur', update);
		document.addEventListener('visibilitychange', update);
		return () => {
			window.removeEventListener('focus', update);
			window.removeEventListener('blur', update);
			document.removeEventListener('visibilitychange', update);
		};
	}, []);
	return focused;
}

export function WorkspaceView({ me, workspaceId, channelId, onMeChanged }: Props) {
	const { state, dispatch, send, loadMessages, reloadInfo } = useWorkspace(workspaceId, me.user.id, channelId);
	const [navOpen, setNavOpen] = useState(false);
	const [membersOpen, setMembersOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const focused = useFocused();

	const channels = state.channels;
	const active: Channel | undefined = channels?.find((c) => c.id === channelId);
	const members = useMemo(() => new Map<string, Member>((state.info?.members ?? []).map((m) => [m.id, m])), [state.info]);
	const role = state.info?.role ?? 'member';
	const activeData = active ? state.messages[active.id] : undefined;
	const lastActiveId = activeData?.items.at(-1)?.id;

	useEffect(() => rememberWorkspace(workspaceId), [workspaceId]);

	useEffect(() => {
		if (channels && !active && channels[0]) {
			navigate(`/w/${workspaceId}/${channels[0].id}`, true);
		}
	}, [channels, active, workspaceId]);

	useEffect(() => {
		if (active && !state.messages[active.id] && state.status === 'live') {
			void loadMessages(active.id);
		}
	}, [active, state.messages, state.status, loadMessages]);

	useEffect(() => {
		if (active && focused && state.status === 'live') {
			send({ t: 'read', channelId: active.id });
			dispatch({ type: 'read', channelId: active.id });
		}
	}, [active, focused, lastActiveId, state.status, send, dispatch]);

	useEffect(() => {
		const unread = Object.values(state.unread).reduce((sum, n) => sum + n, 0);
		document.title = `${unread ? `(${unread}) ` : ''}${active ? `#${active.name} · ` : ''}${state.info?.name ?? 'Synq'}`;
	}, [state.unread, active, state.info]);

	if (state.closed) {
		return (
			<main className='invite'>
				<Logo />
				<div className='stack invite-card'>
					<p>{state.closed}</p>
					<button
						type='button'
						className='button button-primary'
						onClick={() => {
							void onMeChanged();
							navigate('/', true);
						}}
					>
						Retour à l’accueil
					</button>
				</div>
			</main>
		);
	}

	const categories = new Map<string, Channel[]>();
	for (const channel of channels ?? []) {
		categories.set(channel.category, [...(categories.get(channel.category) ?? []), channel]);
	}

	const typingNames = active
		? Object.entries(state.typing[active.id] ?? {})
				.filter(([, until]) => until > Date.now())
				.map(([id]) => members.get(id)?.name ?? 'Quelqu’un')
		: [];

	const sortedMembers = [...members.values()].sort((a, b) => Number(state.online.has(b.id)) - Number(state.online.has(a.id)) || a.name.localeCompare(b.name));

	const sendMessage = async (body: string, attachmentKey?: string) => {
		if (!active) {
			return;
		}
		const message = await api<Message>('POST', `/w/${workspaceId}/channels/${active.id}/messages`, { body, attachmentKey });
		dispatch({ type: 'message', message });
	};

	return (
		<div className={`app${navOpen ? ' nav-open' : ''}${membersOpen ? ' members-open' : ''}`}>
			<nav className='rail' aria-label='Espaces'>
				<button type='button' className='rail-home' aria-label='Accueil' title='Accueil' onClick={() => navigate('/')}>
					<img src='/favicon.svg' alt='' width={36} height={36} />
				</button>
				{me.workspaces.map((w) => (
					<button
						key={w.id}
						type='button'
						className={`rail-item${w.id === workspaceId ? ' rail-item-active' : ''}`}
						title={w.name}
						aria-label={w.name}
						aria-current={w.id === workspaceId}
						onClick={() => navigate(`/w/${w.id}`)}
					>
						<Avatar id={w.id} name={w.name} size={40} />
					</button>
				))}
				<button type='button' className='rail-add' aria-label='Créer ou rejoindre un espace' title='Créer un espace' onClick={() => navigate('/')}>
					<Icon name='plus' />
				</button>
			</nav>

			<aside className='sidebar'>
				<header className='sidebar-head'>
					<h1>{state.info?.name ?? ' '}</h1>
					<button type='button' className='icon-button' aria-label='Réglages de l’espace' title='Réglages' onClick={() => setSettingsOpen(true)}>
						<Icon name='settings' />
					</button>
				</header>
				<div className='channel-groups'>
					{[...categories].map(([category, list]) => (
						<section key={category || '_'} className='channel-group'>
							{category && <h2>{category}</h2>}
							<ul>
								{list.map((channel) => {
									const unread = state.unread[channel.id] ?? 0;
									return (
										<li key={channel.id}>
											<a
												href={`/w/${workspaceId}/${channel.id}`}
												className={`channel-link${channel.id === channelId ? ' channel-link-active' : ''}${unread ? ' channel-link-unread' : ''}`}
												aria-current={channel.id === channelId ? 'page' : undefined}
												onClick={(e) => {
													e.preventDefault();
													setNavOpen(false);
													navigate(`/w/${workspaceId}/${channel.id}`);
												}}
											>
												<Icon name={channel.readOnly ? 'megaphone' : 'hash'} size={16} />
												<span className='grow'>{channel.name}</span>
												{unread > 0 && channel.id !== channelId && <span className='badge'>{unread > 99 ? '99+' : unread}</span>}
											</a>
										</li>
									);
								})}
							</ul>
						</section>
					))}
				</div>
				<footer className='sidebar-me'>
					<Avatar id={me.user.id} name={me.user.name} url={me.user.avatarUrl} size={32} />
					<span className='grow'>{me.user.name}</span>
					<span className={`status-dot status-${state.status}`} title={state.status === 'live' ? 'Connecté' : 'Reconnexion…'} />
				</footer>
			</aside>

			<section className='main'>
				<header className='channel-head'>
					<button type='button' className='icon-button only-mobile' aria-label='Salons' onClick={() => setNavOpen(!navOpen)}>
						<Icon name='menu' />
					</button>
					{active && (
						<>
							<h2>
								<Icon name={active.readOnly ? 'megaphone' : 'hash'} />
								{active.name}
							</h2>
							{active.topic && <p className='channel-topic'>{active.topic}</p>}
						</>
					)}
					<button
						type='button'
						className={`icon-button members-toggle${membersOpen ? ' icon-button-on' : ''}`}
						aria-label='Membres'
						aria-pressed={membersOpen}
						title='Membres'
						onClick={() => setMembersOpen(!membersOpen)}
					>
						<Icon name='users' />
						<span className='members-count'>{state.online.size}</span>
					</button>
				</header>

				{state.status === 'offline' && <p className='connection-lost'>Connexion perdue. Reconnexion en cours…</p>}

				{active ? (
					<MessageList
						key={`messages-${active.id}`}
						workspaceId={workspaceId}
						channel={active}
						data={activeData}
						members={members}
						myId={me.user.id}
						role={role}
						onLoadOlder={() => activeData?.items[0] && void loadMessages(active.id, activeData.items[0].id)}
						onEdit={async (id, body) => {
							await api('PATCH', `/w/${workspaceId}/messages/${id}`, { body });
						}}
						onDelete={async (id) => {
							await api('DELETE', `/w/${workspaceId}/messages/${id}`);
						}}
					/>
				) : (
					<div className='messages' />
				)}

				<p className='typing' aria-live='polite'>
					{typingNames.length === 1 && `${typingNames[0]} écrit…`}
					{typingNames.length === 2 && `${typingNames[0]} et ${typingNames[1]} écrivent…`}
					{typingNames.length > 2 && 'Plusieurs personnes écrivent…'}
				</p>

				{active && (
					<Composer
						key={`composer-${active.id}`}
						workspaceId={workspaceId}
						channel={active}
						canPost={!active.readOnly || role !== 'member'}
						onSend={sendMessage}
						onTyping={() => send({ t: 'typing', channelId: active.id })}
					/>
				)}
			</section>

			<aside className='members' aria-label='Membres'>
				<h2>Membres · {members.size}</h2>
				<ul>
					{sortedMembers.map((member) => (
						<li key={member.id} className={state.online.has(member.id) ? 'member-online' : 'member-offline'}>
							<span className='member-avatar'>
								<Avatar id={member.id} name={member.name} url={member.avatarUrl} size={30} />
								<span className='presence' />
							</span>
							<span className='grow'>{member.name}</span>
							{member.role !== 'member' && <span className='role-tag'>{member.role === 'owner' ? 'Propriétaire' : 'Admin'}</span>}
						</li>
					))}
				</ul>
			</aside>

			{navOpen && <button type='button' className='scrim' aria-label='Fermer le menu' onClick={() => setNavOpen(false)} />}

			{state.info && channels && (
				<SettingsDialog
					open={settingsOpen}
					onClose={() => setSettingsOpen(false)}
					info={state.info}
					channels={channels}
					myId={me.user.id}
					onChanged={async () => {
						await reloadInfo().catch(() => undefined);
						await onMeChanged();
					}}
				/>
			)}
		</div>
	);
}
