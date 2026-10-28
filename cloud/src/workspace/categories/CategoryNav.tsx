import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';

import type { Category, Layout } from '../../../shared/categories';
import type { Channel, ChannelKind, WorkspaceDetail } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Dialog, Icon } from '../../ui';
import { useContextMenu, type ContextMenuItem } from '../ContextMenu';
import { AccessDialog } from '../grade-access/AccessDialog';
import { ChannelPermissions, OverridesEditor } from './OverridesEditor';
import { useCategories } from './useCategories';
import './categories.css';

type Props = {
	workspaceId: string;
	info: WorkspaceDetail | null;
	channels: Channel[];
	channelId: string | null;
	staff: boolean;
	onOpenChannel: (id: string) => void;
	onCreateChannel: (kind: Exclude<ChannelKind, 'dm'>) => void;
	renderChannel: (channel: Channel) => ReactNode;
	// Rendu en fin de liste, dans la même zone de défilement.
	footer?: ReactNode;
};

type Group = { category: Category | null; items: Channel[] };
type Drag = { type: 'channel' | 'category'; id: string };
type Prompt = { title: string; label: string; initial: string; submit: (value: string) => Promise<unknown> };

const collapsedKey = (workspaceId: string) => `synq:collapsed:${workspaceId}`;

function readCollapsed(workspaceId: string): Set<string> {
	try {
		return new Set(JSON.parse(localStorage.getItem(collapsedKey(workspaceId)) ?? '[]') as string[]);
	} catch {
		return new Set();
	}
}

const byPosition = (a: Channel, b: Channel) => a.position - b.position || a.name.localeCompare(b.name);

export function CategoryNav({ workspaceId, info, channels, channelId, staff, onOpenChannel, onCreateChannel, renderChannel, footer }: Props) {
	const categories = useCategories(workspaceId, channels);
	const [collapsed, setCollapsed] = useState(() => readCollapsed(workspaceId));
	const [prompt, setPrompt] = useState<Prompt | null>(null);
	const [perms, setPerms] = useState<{ category?: Category; channel?: Channel } | null>(null);
	const [over, setOver] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const drag = useRef<Drag | null>(null);
	const context = useContextMenu();

	useEffect(() => setCollapsed(readCollapsed(workspaceId)), [workspaceId]);

	const groups = useMemo<Group[]>(() => {
		const known = new Set(categories.map((k) => k.id));
		return [
			{ category: null, items: channels.filter((c) => !c.categoryId || !known.has(c.categoryId)).sort(byPosition) },
			...categories.map((category) => ({ category, items: channels.filter((c) => c.categoryId === category.id).sort(byPosition) })),
		];
	}, [channels, categories]);

	const report = (e: unknown) => setError(errorText(e));

	const toggle = (id: string) => {
		const next = new Set(collapsed);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		setCollapsed(next);
		try {
			localStorage.setItem(collapsedKey(workspaceId), JSON.stringify([...next]));
		} catch {
			// Stockage indisponible : état gardé pour la session.
		}
	};

	const save = (layout: Layout) => void api('PUT', `/w/${workspaceId}/layout`, layout).then(() => setError(null), report);

	const order = () => groups.flatMap((g) => g.items.map((c) => ({ id: c.id, categoryId: g.category?.id ?? null })));

	const dropOnCategory = (target: Category) => {
		const current = drag.current;
		if (!current) {
			return;
		}
		if (current.type === 'category') {
			if (current.id === target.id) {
				return;
			}
			const ids = categories.map((k) => k.id).filter((id) => id !== current.id);
			ids.splice(ids.indexOf(target.id), 0, current.id);
			save({ categories: ids, channels: [] });
			return;
		}
		const moves = order().filter((m) => m.id !== current.id);
		moves.push({ id: current.id, categoryId: target.id });
		save({ categories: categories.map((k) => k.id), channels: moves });
	};

	const dropOnChannel = (target: Channel) => {
		const current = drag.current;
		if (!current || current.id === target.id) {
			return;
		}
		if (current.type === 'category') {
			const category = categories.find((k) => k.id === target.categoryId);
			if (category) {
				dropOnCategory(category);
			}
			return;
		}
		const moves = order().filter((m) => m.id !== current.id);
		const index = moves.findIndex((m) => m.id === target.id);
		if (index < 0) {
			return;
		}
		moves.splice(index, 0, { id: current.id, categoryId: moves[index]!.categoryId });
		save({ categories: categories.map((k) => k.id), channels: moves });
	};

	const dragProps = (key: string, type: Drag['type'], id: string, onDrop: () => void) =>
		staff
			? {
					draggable: true,
					onDragStart: (e: DragEvent) => {
						e.stopPropagation();
						drag.current = { type, id };
						e.dataTransfer.effectAllowed = 'move';
						e.dataTransfer.setData('text/plain', id);
					},
					onDragOver: (e: DragEvent) => {
						if (drag.current) {
							e.preventDefault();
							e.stopPropagation();
							setOver(key);
						}
					},
					onDragLeave: () => setOver((current) => (current === key ? null : current)),
					onDrop: (e: DragEvent) => {
						e.preventDefault();
						e.stopPropagation();
						setOver(null);
						onDrop();
						drag.current = null;
					},
					onDragEnd: () => {
						drag.current = null;
						setOver(null);
					},
				}
			: {};

	const createIn = (category: Category | null, kind: ChannelKind): Prompt => ({
		title: kind === 'voice' ? 'Créer un salon vocal' : 'Créer un salon',
		label: 'Nom du salon',
		initial: '',
		submit: async (name) => {
			const channel = await api<Channel>('POST', `/w/${workspaceId}/channels`, { name, kind, categoryId: category?.id ?? null });
			onOpenChannel(channel.id);
		},
	});

	const categoryItems = (category: Category): ContextMenuItem[] => {
		const items: ContextMenuItem[] = [{ label: collapsed.has(category.id) ? 'Déplier la catégorie' : 'Replier la catégorie', icon: 'chevron', onSelect: () => toggle(category.id) }];
		if (staff) {
			items.push(
				'sep',
				{ label: 'Créer un salon ici', icon: 'hash', onSelect: () => setPrompt(createIn(category, 'text')) },
				{ label: 'Créer un salon vocal ici', icon: 'speaker', onSelect: () => setPrompt(createIn(category, 'voice')) },
				{
					label: 'Renommer la catégorie',
					icon: 'pencil',
					onSelect: () =>
						setPrompt({ title: 'Renommer la catégorie', label: 'Nom de la catégorie', initial: category.name, submit: (name) => api('PATCH', `/w/${workspaceId}/categories/${category.id}`, { name }) }),
				},
				{ label: 'Permissions de la catégorie', icon: 'settings', onSelect: () => setPerms({ category }) },
				'sep',
				{
					label: 'Supprimer la catégorie',
					icon: 'trash',
					danger: true,
					onSelect: () => window.confirm(`Supprimer la catégorie ${category.name} ? Ses salons sont conservés.`) && void api('DELETE', `/w/${workspaceId}/categories/${category.id}`).catch(report),
				},
			);
		}
		return items;
	};

	const [accessId, setAccessId] = useState<string | null>(null);
	const accessChannel = accessId ? channels.find((c) => c.id === accessId) : undefined;

	const channelItems = (channel: Channel): ContextMenuItem[] => {
		const items: ContextMenuItem[] = [
			{ label: 'Ouvrir', icon: channel.kind === 'voice' ? 'speaker' : 'hash', onSelect: () => onOpenChannel(channel.id) },
			{ label: 'Marquer comme lu', icon: 'check', onSelect: () => void api('POST', `/w/${workspaceId}/channels/${channel.id}/read`).catch(report) },
			{ label: 'Copier le lien', onSelect: () => void navigator.clipboard?.writeText(`${location.origin}/w/${workspaceId}/${channel.id}`).catch(report) },
		];
		if (staff) {
			items.push(
				'sep',
				{
					label: 'Renommer le salon',
					icon: 'pencil',
					onSelect: () => setPrompt({ title: 'Renommer le salon', label: 'Nom du salon', initial: channel.name, submit: (name) => api('PATCH', `/w/${workspaceId}/channels/${channel.id}`, { name }) }),
				},
				{ label: 'Gérer l’accès', icon: 'shield', onSelect: () => setAccessId(channel.id) },
				{ label: 'Permissions du salon', icon: 'settings', onSelect: () => setPerms({ channel }) },
				{
					label: 'Dupliquer',
					icon: 'plus',
					onSelect: () =>
						void api<Channel>('POST', `/w/${workspaceId}/channels`, {
							name: `${channel.name}-copie`,
							kind: channel.kind,
							topic: channel.topic,
							categoryId: channel.categoryId,
							userLimit: channel.userLimit,
						}).then((copy) => onOpenChannel(copy.id), report),
				},
				'sep',
				{
					label: 'Supprimer le salon',
					icon: 'trash',
					danger: true,
					onSelect: () => window.confirm(`Supprimer ${channel.name} avec ses messages et fichiers ?`) && void api('DELETE', `/w/${workspaceId}/channels/${channel.id}`).catch(report),
				},
			);
		}
		return items;
	};

	const navItems = (): ContextMenuItem[] =>
		staff
			? [
					{
						label: 'Créer une catégorie',
						icon: 'plus',
						onSelect: () => setPrompt({ title: 'Créer une catégorie', label: 'Nom de la catégorie', initial: '', submit: (name) => api('POST', `/w/${workspaceId}/categories`, { name }) }),
					},
					{ label: 'Créer un salon', icon: 'hash', onSelect: () => onCreateChannel('text') },
					{ label: 'Créer un salon vocal', icon: 'speaker', onSelect: () => onCreateChannel('voice') },
				]
			: [];

	const permChannel = perms?.channel ? (channels.find((c) => c.id === perms.channel!.id) ?? perms.channel) : null;

	return (
		<nav className='nav' aria-label='Salons' {...context.bind(navItems)}>
			{groups.map((group, index) => {
				const category = group.category;
				if (!category && group.items.length === 0) {
					return null;
				}
				const shut = category ? collapsed.has(category.id) : false;
				const items = shut ? group.items.filter((c) => c.id === channelId) : group.items;
				return (
					<div key={category?.id ?? 'loose'} className={`nav-section${index > 0 ? ' cat-group' : ''}`}>
						{category && (
							<div
								className={`nav-section-head cat-head${over === `k:${category.id}` ? ' dnd-over' : ''}`}
								{...dragProps(`k:${category.id}`, 'category', category.id, () => dropOnCategory(category))}
								{...context.bind(() => categoryItems(category))}
							>
								<button type='button' className='cat-toggle' aria-expanded={!shut} onClick={() => toggle(category.id)}>
									<span className={`cat-chevron${shut ? ' cat-chevron-shut' : ''}`}>
										<Icon name='chevron' size={12} strokeWidth={2.2} />
									</span>
									<span className='ellipsis'>{category.name}</span>
								</button>
								{staff && (
									<button
										type='button'
										className='icon-btn icon-btn-sm'
										aria-label={`Créer un salon dans ${category.name}`}
										title='Créer un salon'
										onClick={() => setPrompt(createIn(category, 'text'))}
									>
										<Icon name='plus' size={14} strokeWidth={2} />
									</button>
								)}
							</div>
						)}
						{items.map((channel) => (
							<div
								key={channel.id}
								className={`cat-item${over === `c:${channel.id}` ? ' dnd-over' : ''}`}
								{...dragProps(`c:${channel.id}`, 'channel', channel.id, () => dropOnChannel(channel))}
								{...context.bind(() => channelItems(channel))}
							>
								{renderChannel(channel)}
							</div>
						))}
					</div>
				);
			})}
			{error && (
				<p className='notice notice-error' style={{ margin: 8 }}>
					{error}
				</p>
			)}
			{context.menu}
			<NamePrompt prompt={prompt} onClose={() => setPrompt(null)} />
			{perms && info && (
				<Dialog open onClose={() => setPerms(null)} title={perms.category ? `Permissions de ${perms.category.name}` : `Permissions de ${permChannel?.name ?? ''}`} wide>
					{perms.category ? (
						<div className='stack'>
							<p className='muted'>Les salons synchronisés de la catégorie reçoivent aussi ces permissions.</p>
							<OverridesEditor info={info} path={`/w/${workspaceId}/categories/${perms.category.id}/overrides`} />
						</div>
					) : (
						permChannel && <ChannelPermissions info={info} channel={permChannel} />
					)}
				</Dialog>
			)}
			{accessChannel && info && <AccessDialog info={info} channel={accessChannel} onClose={() => setAccessId(null)} />}
			{footer}
		</nav>
	);
}

function NamePrompt({ prompt, onClose }: { prompt: Prompt | null; onClose: () => void }) {
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	return (
		<Dialog open={prompt !== null} onClose={onClose} title={prompt?.title ?? ''}>
			{prompt && (
				<form
					className='stack'
					onSubmit={async (e) => {
						e.preventDefault();
						const value = String(new FormData(e.currentTarget).get('name') ?? '').trim();
						if (!value) {
							return;
						}
						setBusy(true);
						try {
							await prompt.submit(value);
							setError(null);
							onClose();
						} catch (failure) {
							setError(errorText(failure));
						} finally {
							setBusy(false);
						}
					}}
				>
					<label className='field'>
						{prompt.label}
						<input name='name' defaultValue={prompt.initial} maxLength={40} autoFocus required />
					</label>
					{error && <p className='notice notice-error'>{error}</p>}
					<div className='row' style={{ justifyContent: 'flex-end' }}>
						<button type='button' className='btn btn-ghost' onClick={onClose}>
							Annuler
						</button>
						<button type='submit' className='btn btn-primary' disabled={busy}>
							Valider
						</button>
					</div>
				</form>
			)}
		</Dialog>
	);
}
