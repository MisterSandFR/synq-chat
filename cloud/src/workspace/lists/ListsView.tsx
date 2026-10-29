import { useEffect, useMemo, useState } from 'react';

import { LIST_TEMPLATES, LIST_VIEW_KINDS, type ListDetail, type ListSummary, type ListTemplate } from '../../../shared/lists';
import type { Channel, Member } from '../../../shared/types';
import { api, ApiError } from '../../api';
import { navigate, usePath, useSearch } from '../../router';
import { Avatar, Dialog, Icon } from '../../ui';
import { ListPage } from './BasePage';
import { TYPE_ICON } from './cells';
import { MenuButton } from './table';
import { refreshTreeBases } from '../canvas/pages';
import './lists.css';

type Props = { workspaceId: string; members: Map<string, Member>; channels: Channel[]; version: number; myId: string };

const updated = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Action impossible pour le moment.');

export function ListsView({ workspaceId, members, channels, version, myId }: Props) {
	const path = usePath();
	const segment = path.split('/')[4] ?? null;
	const salon = new URLSearchParams(useSearch()).get('salon');
	const rooms = useMemo(() => channels.filter((c) => c.kind === 'text'), [channels]);
	if (segment && segment !== 'nouvelle') {
		return <ListPage key={segment} workspaceId={workspaceId} listId={segment} members={members} rooms={rooms} version={version} myId={myId} />;
	}
	return <ListIndex workspaceId={workspaceId} rooms={rooms} salon={salon} creating={segment === 'nouvelle'} version={version} members={members} />;
}

function ListIndex({ workspaceId, rooms, salon, creating, version, members }: { workspaceId: string; rooms: Channel[]; salon: string | null; creating: boolean; version: number; members: Map<string, Member> }) {
	const [lists, setLists] = useState<ListSummary[] | null>(null);
	const [open, setOpen] = useState(creating);
	const room = rooms.find((r) => r.id === salon);

	useEffect(() => setOpen(creating), [creating]);
	useEffect(() => {
		void api<ListSummary[]>('GET', `/w/${workspaceId}/lists${salon ? `?channel=${salon}` : ''}`)
			.then(setLists)
			.catch(() => setLists([]));
	}, [workspaceId, salon, version]);

	return (
		<section className='lst-index'>
			<header className='lst-index-head'>
				<div>
					<h2>{room ? `Suivis de #${room.name}` : 'Suivis'}</h2>
					<p className='muted'>Tableaux, kanbans, calendriers et chronologies partagés avec l’équipe.</p>
				</div>
				<span className='grow' />
				{room && (
					<button type='button' className='btn btn-ghost' onClick={() => navigate(`/w/${workspaceId}/listes`)}>
						Tous les suivis
					</button>
				)}
				<button type='button' className='btn btn-primary' onClick={() => setOpen(true)}>
					<Icon name='plus' size={16} /> Nouveau suivi
				</button>
			</header>
			{lists === null ? (
				<div className='spinner' aria-busy />
			) : lists.length === 0 ? (
				<div className='lst-blank'>
					<Icon name='list' size={28} />
					<p>Aucun suivi pour l’instant.</p>
					<button type='button' className='btn' onClick={() => setOpen(true)}>
						Créer un suivi
					</button>
				</div>
			) : (
				<ul className='lst-cards'>
					{lists.map((l) => {
						const channel = rooms.find((r) => r.id === l.channelId);
						const author = members.get(l.createdBy);
						return (
							<li key={l.id}>
								<a
									className='lst-card'
									href={`/w/${workspaceId}/listes/${l.id}`}
									onClick={(e) => {
										e.preventDefault();
										navigate(`/w/${workspaceId}/listes/${l.id}`);
									}}
								>
									<span className='lst-card-icon'>
										<Icon name='list' />
									</span>
									<span className='lst-card-text'>
										<strong className='ellipsis'>{l.title}</strong>
										<span className='muted'>
											{l.itemCount} élément{l.itemCount > 1 ? 's' : ''} · modifiée le {updated.format(l.updatedAt)}
										</span>
									</span>
									{channel && <span className='tag'># {channel.name}</span>}
									{author && <Avatar name={author.name} url={author.avatarUrl} size={22} />}
								</a>
							</li>
						);
					})}
				</ul>
			)}
			{open && <CreateList workspaceId={workspaceId} rooms={rooms} initialChannel={salon} onClose={() => (creating ? navigate(`/w/${workspaceId}/listes`) : setOpen(false))} />}
		</section>
	);
}

// `place` : créé dans l'arbre des pages (sous une page ou dans une catégorie), sans salon.
export function CreateList({
	workspaceId,
	rooms,
	initialChannel,
	place,
	onClose,
}: {
	workspaceId: string;
	rooms: Channel[];
	initialChannel: string | null;
	place?: { parentId?: string | null; categoryId?: string | null };
	onClose: () => void;
}) {
	const [template, setTemplate] = useState<ListTemplate>('project');
	const [title, setTitle] = useState('');
	const [channelId, setChannelId] = useState<string | null>(initialChannel);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const channel = rooms.find((r) => r.id === channelId);
	const submit = async () => {
		setBusy(true);
		try {
			const created = await api<ListDetail>('POST', `/w/${workspaceId}/lists`, { template, title, channelId: place ? null : channelId, parentId: place?.parentId ?? null, categoryId: place?.categoryId ?? null });
			void refreshTreeBases(workspaceId).catch(() => undefined);
			if (place) {
				onClose();
			}
			navigate(`/w/${workspaceId}/listes/${created.id}`);
		} catch (e) {
			setError(message(e));
			setBusy(false);
		}
	};
	return (
		<Dialog open onClose={onClose} title='Nouveau suivi' wide>
			<div className='lst-create'>
				<div className='lst-templates' role='radiogroup' aria-label='Modèle'>
					{(Object.keys(LIST_TEMPLATES) as ListTemplate[]).map((key) => (
						<button key={key} type='button' role='radio' aria-checked={template === key} className='lst-template' onClick={() => setTemplate(key)}>
							<strong>{LIST_TEMPLATES[key].label}</strong>
							<span className='muted'>{LIST_TEMPLATES[key].hint}</span>
							<span className='lst-template-cols'>
								{LIST_TEMPLATES[key].views.map((v) => (
									<span key={v.name}>{LIST_VIEW_KINDS.find((k) => k.id === v.kind)?.label}</span>
								))}
								{LIST_TEMPLATES[key].columns.slice(0, 3).map((c) => (
									<span key={c.id}>
										<Icon name={TYPE_ICON[c.type]} size={12} /> {c.name}
									</span>
								))}
							</span>
						</button>
					))}
				</div>
				<label className='field'>
					Nom
					<input className='input' value={title} placeholder={LIST_TEMPLATES[template].title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
				</label>
				{!place && (
				<div className='field'>
					Salon rattaché
					<MenuButton label={<span className='grow ellipsis'>{channel ? `# ${channel.name}` : 'Aucun, visible par tout l’espace'}</span>} className='btn lst-wide-btn'>
						{(close) => (
							<div className='lst-menu-scroll'>
								<button
									type='button'
									role='menuitem'
									className='menu-item'
									onClick={() => {
										setChannelId(null);
										close();
									}}
								>
									Aucun, visible par tout l’espace
								</button>
								{rooms.map((r) => (
									<button
										key={r.id}
										type='button'
										role='menuitem'
										className='menu-item'
										onClick={() => {
											setChannelId(r.id);
											close();
										}}
									>
										<Icon name='hash' size={14} /> {r.name}
									</button>
								))}
							</div>
						)}
					</MenuButton>
					<span className='field-hint'>Un suivi rattaché suit la visibilité du salon.</span>
				</div>
				)}
				{error && <p className='notice notice-error'>{error}</p>}
				<div className='lst-actions'>
					<button type='button' className='btn btn-ghost' onClick={onClose}>
						Annuler
					</button>
					<button type='button' className='btn btn-primary' disabled={busy} onClick={() => void submit()}>
						Créer le suivi
					</button>
				</div>
			</div>
		</Dialog>
	);
}
