import { useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';

import type { Favorite, FavoriteRef } from '../../../shared/favorites';
import type { Channel, Member } from '../../../shared/types';
import { navigate, readPref, writePref } from '../../router';
import { Icon } from '../../ui';
import { useContextMenu, type ContextMenuItem } from '../ContextMenu';
import { DirectAvatar, directName } from '../dm-threads/DirectAvatar';
import type { WorkspaceState } from '../useWorkspace';
import { currentFavorites, endFavoriteDrag, favoriteDrag, isFavorite, placeFavorite, startFavoriteDrag, toggleFavorite, useFavorites } from './store';
import './favorites.css';

const foldKey = (workspaceId: string) => `favorites_folded_${workspaceId}`;
const keyOf = (ref: FavoriteRef) => `${ref.kind}:${ref.refId}`;

// Entrée de clic droit, lue à l'ouverture du menu.
export function favoriteItem(ref: FavoriteRef, title = ''): ContextMenuItem {
	const on = isFavorite(currentFavorites(), ref);
	return { label: on ? 'Retirer des favoris' : 'Ajouter aux favoris', icon: 'star', onSelect: () => void toggleFavorite(ref, !on, title) };
}

export function favoriteDragProps(ref: FavoriteRef) {
	return {
		draggable: true,
		onDragStart: (e: DragEvent) => {
			e.stopPropagation();
			startFavoriteDrag(ref);
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', ref.refId);
		},
		onDragEnd: endFavoriteDrag,
	};
}

export function FavoriteStar({ kind, refId, title = '' }: FavoriteRef & { title?: string }) {
	const { items } = useFavorites();
	const on = isFavorite(items, { kind, refId });
	const label = on ? 'Retirer des favoris' : 'Ajouter aux favoris';
	return (
		<button type='button' className='icon-btn fav-star' aria-pressed={on} aria-label={label} title={label} onClick={() => void toggleFavorite({ kind, refId }, !on, title)}>
			<Icon name='star' />
		</button>
	);
}

type Props = {
	workspaceId: string;
	state: WorkspaceState;
	channelId: string | null;
	members: Map<string, Member>;
	myId: string;
	renderChannel: (channel: Channel) => ReactNode;
	onNavigate: () => void;
};

export function FavoritesSection({ workspaceId, state, channelId, members, myId, renderChannel, onNavigate }: Props) {
	const { items, dragging } = useFavorites();
	const ctx = useContextMenu();
	const [folded, setFolded] = useState(() => readPref(foldKey(workspaceId)) === '1');
	const [over, setOver] = useState<string | null>(null);
	const channels = state.channels ?? [];
	// Salon supprimé ou accès retiré : le favori disparaît de la section.
	const shown = items.filter((f) => f.kind !== 'channel' || channels.some((c) => c.id === f.refId));
	if (!shown.length && !dragging) {
		return null;
	}

	const pathOf = (f: Favorite) => `/w/${workspaceId}/${f.kind === 'channel' ? f.refId : `${f.kind === 'canvas' ? 'canevas' : 'listes'}/${f.refId}`}`;
	const isActive = (f: Favorite) => (f.kind === 'channel' ? f.refId === channelId : location.pathname === pathOf(f));
	const open = (f: Favorite) => {
		onNavigate();
		navigate(pathOf(f));
	};
	const go = (f: Favorite) => (e: MouseEvent) => {
		e.preventDefault();
		open(f);
	};
	const fold = () => {
		writePref(foldKey(workspaceId), folded ? '0' : '1');
		setFolded(!folded);
	};

	const dropProps = (key: string, before: FavoriteRef | null) => ({
		onDragOver: (e: DragEvent) => {
			if (favoriteDrag.ref) {
				e.preventDefault();
				e.stopPropagation();
				e.dataTransfer.dropEffect = 'move';
				setOver(key);
			}
		},
		onDragLeave: () => setOver((current) => (current === key ? null : current)),
		onDrop: (e: DragEvent) => {
			const ref = favoriteDrag.ref;
			setOver(null);
			if (ref) {
				e.preventDefault();
				e.stopPropagation();
				endFavoriteDrag();
				void placeFavorite(ref, before);
			}
		},
	});

	const menu = (f: Favorite, index: number): ContextMenuItem[] => [
		{ label: 'Ouvrir', icon: f.kind === 'canvas' ? 'file' : f.kind === 'list' ? 'list' : 'hash', onSelect: () => open(f) },
		...(index > 0 ? [{ label: 'Monter', icon: 'up' as const, onSelect: () => void placeFavorite(f, shown[index - 1]!) }] : []),
		...(index < shown.length - 1 ? [{ label: 'Descendre', icon: 'down' as const, onSelect: () => void placeFavorite(f, shown[index + 2] ?? null) }] : []),
		'sep',
		{ label: 'Retirer des favoris', icon: 'star', onSelect: () => void toggleFavorite(f, false) },
	];

	const row = (f: Favorite): ReactNode => {
		if (f.kind === 'channel') {
			const channel = channels.find((c) => c.id === f.refId)!;
			if (channel.kind !== 'dm') {
				return renderChannel(channel);
			}
			const dm = state.dmThreads.dms?.find((d) => d.id === channel.id);
			const active = channel.id === channelId;
			const unread = active ? 0 : (state.unread[channel.id] ?? 0);
			return (
				<a href={`#${channel.id}`} className={`channel sb-pill${unread > 0 ? ' channel-unread' : ''}`} aria-current={active ? 'page' : undefined} onClick={go(f)}>
					<span className='sb-tile fav-tile-dm' aria-hidden>
						{dm ? <DirectAvatar conversation={dm} members={members} myId={myId} online={state.online} size={22} /> : <Icon name='chat' size={15} />}
					</span>
					<span className='channel-name'>{dm ? directName(dm, members, myId) : 'Conversation'}</span>
					{unread > 0 && <span className='pill'>{unread > 99 ? '99+' : unread}</span>}
				</a>
			);
		}
		return (
			<a href={pathOf(f)} className='channel sb-pill' aria-current={isActive(f) ? 'page' : undefined} onClick={go(f)}>
				<span className='sb-tile' aria-hidden>
					<Icon name={f.kind === 'canvas' ? 'file' : 'list'} size={15} />
				</span>
				<span className='channel-name'>{f.title || (f.kind === 'canvas' ? 'Canevas sans titre' : 'Liste sans titre')}</span>
			</a>
		);
	};

	const visible = folded ? shown.filter(isActive) : shown;
	return (
		<div className={`nav-section fav-section${over === 'end' ? ' fav-over' : ''}`} {...dropProps('end', null)}>
			<div className='nav-section-head fav-head'>
				<button type='button' className='fav-toggle' aria-expanded={!folded} onClick={fold}>
					<span className={`cat-chevron${folded ? ' cat-chevron-shut' : ''}`}>
						<Icon name='chevron' size={12} strokeWidth={2.4} />
					</span>
					Favoris
				</button>
			</div>
			{shown.length === 0 ? (
				<p className='fav-drop'>Dépose ici pour l’ajouter aux favoris</p>
			) : (
				visible.map((f) => (
					<div key={keyOf(f)} className={`fav-item${over === keyOf(f) ? ' dnd-over' : ''}`} {...favoriteDragProps(f)} {...dropProps(keyOf(f), f)} {...ctx.bind(() => menu(f, shown.indexOf(f)))}>
						{row(f)}
					</div>
				))
			)}
			{ctx.menu}
		</div>
	);
}
