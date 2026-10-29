import { useEffect, useMemo, useRef, useState } from 'react';

import { LEVEL_LABELS, atLeast } from '../../../shared/access';
import { canvasPath, type CanvasMeta } from '../../../shared/canvas';
import type { ChannelResource, ChannelResources, ResourceKind } from '../../../shared/channel-resources';
import type { ListDetail } from '../../../shared/lists';
import type { Channel } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Floating } from '../../floating';
import { navigate } from '../../router';
import { Dialog, Icon, useDismiss } from '../../ui';
import { ShareDialog } from '../access/ShareDialog';
import { refreshPages, refreshTreeBases, usePageCategories, usePages, useTreeBases } from '../canvas/pages';
import './channel-resources.css';

type Props = { workspaceId: string; channel: Channel; version: number; onClose: () => void };

const hrefOf = (workspaceId: string, kind: ResourceKind, id: string) => (kind === 'page' ? canvasPath(workspaceId, id) : `/w/${workspaceId}/listes/${id}`);

const plural = (n: number) => (n > 1 ? `${n} membres du salon n’y ont pas accès` : '1 membre du salon n’y a pas accès');

function ResourceIcon({ kind, icon }: { kind: ResourceKind; icon: string | null }) {
	return <span className='cr-icon'>{icon && !icon.startsWith(':') ? icon : <Icon name={kind === 'page' ? 'file' : 'list'} size={16} />}</span>;
}

// Sélecteur de l'arbre : seulement les pages et suivis que l'on voit déjà.
function LinkPicker({ workspaceId, linked, onPick }: { workspaceId: string; linked: Set<string>; onPick: (kind: ResourceKind, id: string) => void }) {
	const ref = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	useDismiss(ref, open, () => setOpen(false));
	const pages = usePages(workspaceId);
	const bases = useTreeBases(workspaceId);
	const options = useMemo(() => {
		const needle = query.trim().toLowerCase();
		const all = [
			...(pages ?? []).filter((p) => p.archivedAt === null).map((p) => ({ kind: 'page' as const, id: p.id, title: p.title || 'Sans titre', icon: p.icon })),
			...(bases ?? []).map((b) => ({ kind: 'list' as const, id: b.id, title: b.title || 'Sans titre', icon: b.icon })),
		];
		return all.filter((o) => !linked.has(`${o.kind}:${o.id}`) && (!needle || o.title.toLowerCase().includes(needle))).slice(0, 40);
	}, [pages, bases, linked, query]);
	return (
		<div ref={ref}>
			<button type='button' className='btn btn-ghost cr-action' aria-haspopup='listbox' aria-expanded={open} onClick={() => setOpen(!open)}>
				<Icon name='link' size={16} /> Lier une page ou un suivi
			</button>
			{open && (
				<Floating anchor={ref} placement='bottom-start' className='popover cr-picker' role='dialog' aria-label='Lier une page ou un suivi' style={{ width: 320 }}>
					<input className='cr-search' autoFocus placeholder='Chercher une page ou un suivi' aria-label='Chercher une page ou un suivi' value={query} onChange={(e) => setQuery(e.target.value)} />
					<div className='cr-picker-list' role='listbox'>
						{options.length === 0 && <p className='cr-picker-empty'>{pages === null ? 'Chargement…' : 'Rien à lier'}</p>}
						{options.map((o) => (
							<button
								key={`${o.kind}:${o.id}`}
								type='button'
								role='option'
								aria-selected={false}
								className='menu-item cr-option'
								onClick={() => {
									setOpen(false);
									setQuery('');
									onPick(o.kind, o.id);
								}}
							>
								<ResourceIcon kind={o.kind} icon={o.icon} />
								<span className='grow ellipsis'>{o.title}</span>
								<span className='cr-kind'>{o.kind === 'page' ? 'Page' : 'Suivi'}</span>
							</button>
						))}
					</div>
				</Floating>
			)}
		</div>
	);
}

// Création dans l'arbre, catégorie au choix, puis lien au salon.
function CreateLinked({ workspaceId, channelId, kind, onClose, onDone }: { workspaceId: string; channelId: string; kind: ResourceKind; onClose: () => void; onDone: () => void }) {
	const categories = usePageCategories(workspaceId).filter((c) => atLeast(c.level, 'edit'));
	const [title, setTitle] = useState('');
	const [categoryId, setCategoryId] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const submit = async () => {
		setBusy(true);
		try {
			if (kind === 'page') {
				const page = await api<CanvasMeta>('POST', `/w/${workspaceId}/channels/${channelId}/canvas`, { title, categoryId: categoryId || null });
				await refreshPages(workspaceId);
				onDone();
				navigate(canvasPath(workspaceId, page.id));
			} else {
				const list = await api<ListDetail>('POST', `/w/${workspaceId}/lists`, { title, template: 'project', channelId, categoryId: categoryId || null });
				void refreshTreeBases(workspaceId).catch(() => undefined);
				onDone();
				navigate(`/w/${workspaceId}/listes/${list.id}`);
			}
		} catch (e) {
			setError(errorText(e));
			setBusy(false);
		}
	};
	return (
		<Dialog open onClose={onClose} title={kind === 'page' ? 'Nouvelle page liée' : 'Nouveau suivi lié'}>
			<form
				className='stack'
				onSubmit={(e) => {
					e.preventDefault();
					void submit();
				}}
			>
				<label className='field'>
					<span>Titre</span>
					<input autoFocus value={title} maxLength={200} placeholder={kind === 'page' ? 'Sans titre' : 'Nom du suivi'} onChange={(e) => setTitle(e.target.value)} />
				</label>
				<label className='field'>
					<span>Emplacement dans l’arbre</span>
					<select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
						<option value=''>Sans catégorie</option>
						{categories.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
							</option>
						))}
					</select>
				</label>
				<p className='field-hint'>Créée dans l’arbre avec les accès de son emplacement. Le lien au salon ne donne aucun droit.</p>
				{error && <p className='notice notice-error'>{error}</p>}
				<div className='ga-actions'>
					<span className='grow' />
					<button type='button' className='btn btn-ghost' onClick={onClose}>
						Annuler
					</button>
					<button type='submit' className='btn btn-primary' disabled={busy || (kind === 'list' && !title.trim())}>
						Créer
					</button>
				</div>
			</form>
		</Dialog>
	);
}

// Onglet « Pages et suivis » : liens sans effet sur les droits.
export function ResourcesPanel({ workspaceId, channel, version, onClose }: Props) {
	const base = `/w/${workspaceId}/channels/${channel.id}/resources`;
	const [state, setState] = useState<ChannelResources | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState<ResourceKind | null>(null);
	const [sharing, setSharing] = useState<ChannelResource | null>(null);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		let live = true;
		api<ChannelResources>('GET', base).then(
			(next) => live && (setState(next), setError(null)),
			(failure) => live && setError(errorText(failure)),
		);
		return () => {
			live = false;
		};
	}, [base, version, tick]);

	const run = async (method: 'POST' | 'DELETE', path: string, body?: unknown) => {
		try {
			setState(await api<ChannelResources>(method, path, body));
			setError(null);
		} catch (failure) {
			setError(errorText(failure));
		}
	};

	const items = state?.items ?? [];
	const linked = new Set(items.map((r) => `${r.kind}:${r.id}`));

	return (
		<aside className='side-panel' aria-label={`Pages et suivis de ${channel.name}`}>
			<header className='side-panel-head'>
				<h2>Pages et suivis</h2>
				<button type='button' className='icon-btn' aria-label='Fermer' title='Fermer' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<div className='side-panel-body cr-body'>
				{state?.canLink && (
					<div className='cr-actions'>
						<LinkPicker workspaceId={workspaceId} linked={linked} onPick={(kind, id) => void run('POST', base, { kind, id })} />
						<button type='button' className='btn btn-ghost cr-action' onClick={() => setCreating('page')}>
							<Icon name='plus' size={16} /> Nouvelle page liée
						</button>
						<button type='button' className='btn btn-ghost cr-action' onClick={() => setCreating('list')}>
							<Icon name='plus' size={16} /> Nouveau suivi lié
						</button>
					</div>
				)}
				{error && <p className='notice notice-error'>{error}</p>}
				{!state && !error && <p className='muted'>Chargement…</p>}
				{state && items.length === 0 && (
					<div className='cr-empty'>
						<Icon name='file' size={22} />
						<p>Aucune page ni aucun suivi lié à ce salon.</p>
						<p className='muted'>Lier une page la rend facile à retrouver ici, sans changer qui peut l’ouvrir.</p>
					</div>
				)}
				<ul className='cr-list'>
					{items.map((r) => {
						const href = hrefOf(workspaceId, r.kind, r.id);
						return (
							<li key={`${r.kind}:${r.id}`} className='cr-item'>
								<div className='cr-row'>
									<ResourceIcon kind={r.kind} icon={r.icon} />
									<a
										href={href}
										className='cr-title ellipsis'
										onClick={(e) => {
											if (e.button === 0 && !e.metaKey && !e.ctrlKey) {
												e.preventDefault();
												navigate(href);
											}
										}}
									>
										{r.title}
									</a>
									<span className='cr-level'>{LEVEL_LABELS[r.level]}</span>
									{r.canRemove && (
										<button type='button' className='icon-btn icon-btn-sm' aria-label={`Retirer le lien vers ${r.title}`} title='Retirer le lien' onClick={() => void run('DELETE', `${base}/${r.kind}/${r.id}`)}>
											<Icon name='close' size={14} />
										</button>
									)}
								</div>
								{r.missing > 0 && (
									<div className='cr-banner'>
										<Icon name='eye-off' size={14} />
										<span className='grow'>{plural(r.missing)}</span>
										{r.missingIds && (
											<button type='button' className='btn btn-ghost cr-share' onClick={() => setSharing(r)}>
												Partager
											</button>
										)}
									</div>
								)}
							</li>
						);
					})}
				</ul>
			</div>
			{creating && <CreateLinked workspaceId={workspaceId} channelId={channel.id} kind={creating} onClose={() => setCreating(null)} onDone={() => setCreating(null)} />}
			{sharing && (
				<ShareDialog
					workspaceId={workspaceId}
					kind={sharing.kind === 'page' ? 'page' : 'base'}
					id={sharing.id}
					title={sharing.title}
					suggest={sharing.missingIds}
					onClose={() => {
						setSharing(null);
						setTick((n) => n + 1);
					}}
				/>
			)}
		</aside>
	);
}
