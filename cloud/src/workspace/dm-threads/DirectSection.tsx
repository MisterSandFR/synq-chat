import type { DirectConversation } from '../../../shared/dm-threads';
import type { Member } from '../../../shared/types';
import { Icon } from '../../ui';
import { useContextMenu, type ContextMenuItem } from '../ContextMenu';
import { favoriteDragProps, favoriteItem } from '../favorites/FavoritesSection';
import { useFavorites } from '../favorites/store';
import type { WorkspaceState } from '../useWorkspace';
import { DirectAvatar, directName } from './DirectAvatar';
import './dm-threads.css';

export type ContentView = 'dms' | 'threads' | null;

type Props = {
	state: WorkspaceState;
	channelId: string | null;
	members: Map<string, Member>;
	myId: string;
	view: ContentView;
	onOpenView: (view: Exclude<ContentView, null>) => void;
	onOpenDirect: (channelId: string) => void;
	onNewDirect: () => void;
	// Quitter ou supprimer, ajouté au clic droit d'un groupe.
	groupActions?: (dm: DirectConversation) => ContextMenuItem[];
};

export function DirectSection({ state, channelId, members, myId, view, onOpenView, onOpenDirect, onNewDirect, groupActions }: Props) {
	const { items: favorites } = useFavorites();
	const dms = (state.dmThreads.dms ?? []).filter((dm) => !favorites.some((f) => f.kind === 'channel' && f.refId === dm.id));
	const ctx = useContextMenu();
	return (
		<>
			<div className='nav-section'>
				<div className='nav-section-head'>
					<button type='button' className='dm-head-link' aria-current={view === 'dms' ? 'page' : undefined} onClick={() => onOpenView('dms')}>
						Messages directs
					</button>
					<button type='button' className='icon-btn icon-btn-sm' aria-label='Nouveau message' title='Nouveau message' onClick={onNewDirect}>
						<Icon name='plus' size={14} strokeWidth={2} />
					</button>
				</div>
				{dms.map((dm) => {
					const active = !view && dm.id === channelId;
					const unread = active ? 0 : (state.unread[dm.id] ?? 0);
					return (
						<a
							key={dm.id}
							href={`#${dm.id}`}
							className={`channel${unread > 0 ? ' channel-unread' : ''}`}
							aria-current={active ? 'page' : undefined}
							onClick={(e) => {
								e.preventDefault();
								onOpenDirect(dm.id);
							}}
							{...favoriteDragProps({ kind: 'channel', refId: dm.id })}
							{...ctx.bind(() => {
								const extra = groupActions?.(dm) ?? [];
								return [favoriteItem({ kind: 'channel', refId: dm.id }), ...(extra.length ? (['sep', ...extra] as ContextMenuItem[]) : [])];
							})}
						>
							<span className='channel-icon'>
								<DirectAvatar conversation={dm} members={members} myId={myId} online={state.online} size={20} />
							</span>
							<span className='channel-name'>{directName(dm, members, myId)}</span>
							{(state.voice[dm.id]?.length ?? 0) > 0 && (
								<span className='dm-live' title='Appel en cours' aria-label='Appel en cours'>
									<Icon name='headphones' size={14} />
								</span>
							)}
							{unread > 0 && <span className='pill'>{unread > 99 ? '99+' : unread}</span>}
						</a>
					);
				})}
				{ctx.menu}
			</div>
		</>
	);
}

export function ThreadsNavLink({ active, unread, onOpen }: { active: boolean; unread: number; onOpen: () => void }) {
	return (
		<button type='button' className={`channel dm-nav-btn${unread > 0 && !active ? ' channel-unread' : ''}`} aria-current={active ? 'page' : undefined} onClick={onOpen}>
			<span className='channel-icon'>
				<Icon name='thread' size={16} />
			</span>
			<span className='channel-name'>Fils</span>
			{unread > 0 && (
				<span className='pill' aria-label={unread > 1 ? `${unread} fils non lus` : '1 fil non lu'}>
					{unread > 99 ? '99+' : unread}
				</span>
			)}
		</button>
	);
}
