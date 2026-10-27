import type { Member } from '../../../shared/types';
import { Icon } from '../../ui';
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
};

export function DirectSection({ state, channelId, members, myId, view, onOpenView, onOpenDirect, onNewDirect }: Props) {
	const dms = state.dmThreads.dms ?? [];
	return (
		<>
			<div className='nav-section'>
				<button type='button' className='channel dm-nav-btn' aria-current={view === 'threads' ? 'page' : undefined} onClick={() => onOpenView('threads')}>
					<span className='channel-icon'>
						<Icon name='thread' size={16} />
					</span>
					<span className='channel-name'>Fils</span>
				</button>
			</div>
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
			</div>
		</>
	);
}
