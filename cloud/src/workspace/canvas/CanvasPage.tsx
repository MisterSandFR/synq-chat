import type { Editor } from '@tiptap/core';
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import * as Y from 'yjs';

import { CANVAS_IMAGE_TYPES, PAGE_GRADIENTS, PAGE_TEMPLATES, canvasPath, type CanvasMeta, type PagePatch, type PageRelated } from '../../../shared/canvas';
import { P, has } from '../../../shared/permissions';
import type { Channel, Member } from '../../../shared/types';
import { api, errorText, upload } from '../../api';
import { Floating } from '../../floating';
import { navigate } from '../../router';
import { Avatar, Dialog, Icon, useDismiss } from '../../ui';
import { EmojiPicker } from '../chat/EmojiPicker';
import { FavoriteStar } from '../favorites/FavoritesSection';
import { CanvasEditor } from './CanvasEditor';
import { CommentsPanel, type PendingComment } from './CommentsPanel';
import { toMarkdown } from './markdown';
import { PageIcon, PageTree } from './PageTree';
import { ShareDialog } from '../access/ShareDialog';
import { createPage, duplicatePage, localPage, pageLabel, patchPage, refreshPages, usePages } from './pages';
import { CanvasSync, canvasSocketUrl, colorFor, type SyncStatus } from './sync';
import './canvas.css';
import './pages.css';

type Props = {
	workspaceId: string;
	canvasId: string | null;
	myId: string;
	members: Map<string, Member>;
	channels: Channel[];
	perms: Record<string, number>;
	workspacePerms: number;
	onOpenChannel: (id: string) => void;
	channelLabel: (id: string) => string;
};

const go = (href: string) => (event: MouseEvent) => {
	if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
		event.preventDefault();
		navigate(href);
	}
};

const when = (at: number) => {
	const date = new Date(at);
	return date.toDateString() === new Date().toDateString()
		? `Aujourd’hui à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
		: date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

function Editors({ ids, members }: { ids: string[]; members: Map<string, Member> }) {
	return (
		<span className='canvas-editors'>
			{ids.slice(0, 4).map((id) => {
				const member = members.get(id);
				return member ? <Avatar key={id} name={member.name} url={member.avatarUrl} size={22} /> : null;
			})}
		</span>
	);
}

export const coverStyle = (cover: string) => (cover.startsWith('gradient:') ? undefined : { backgroundImage: `url("${cover}")` });
export const coverClass = (cover: string) => `page-cover${cover.startsWith('gradient:') ? ` page-cover-g${cover.slice(9)}` : ''}`;

export function CanvasPage(props: Props) {
	return props.canvasId ? <CanvasDocument key={props.canvasId} {...props} canvasId={props.canvasId} /> : <PagesHome {...props} />;
}

export function TemplatePicker({ workspaceId, open, onClose, parentId = null }: { workspaceId: string; open: boolean; onClose: () => void; parentId?: string | null }) {
	const [error, setError] = useState<string | null>(null);
	const pick = async (template?: string) => {
		try {
			await createPage(workspaceId, { template, parentId });
			onClose();
		} catch (e) {
			setError(errorText(e));
		}
	};
	return (
		<Dialog open={open} onClose={onClose} title='Nouvelle page depuis un modèle' wide>
			{error && <p className='notice notice-error'>{error}</p>}
			<div className='page-templates'>
				<button type='button' className='page-template' onClick={() => void pick()}>
					<span className='page-template-icon'>
						<Icon name='file' size={20} />
					</span>
					<strong>Page vide</strong>
					<span>Partir de zéro</span>
				</button>
				{PAGE_TEMPLATES.map((t) => (
					<button key={t.id} type='button' className='page-template' onClick={() => void pick(t.id)}>
						<span className='page-template-icon'>{t.icon}</span>
						<strong>{t.title}</strong>
						<span>{t.description}</span>
					</button>
				))}
			</div>
		</Dialog>
	);
}

function PagesHome({ workspaceId, members, channelLabel }: Props) {
	const items = usePages(workspaceId);
	const [error, setError] = useState<string | null>(null);
	const [templates, setTemplates] = useState(() => new URLSearchParams(location.search).has('modeles'));
	const [archived, setArchived] = useState<CanvasMeta[] | null>(null);
	const [showArchived, setShowArchived] = useState(false);

	const loadArchived = () =>
		api<CanvasMeta[]>('GET', `/w/${workspaceId}/canvases?archived=1`)
			.then(setArchived)
			.catch((e: unknown) => setError(errorText(e)));

	useEffect(() => {
		if (showArchived) {
			void loadArchived();
		}
	}, [showArchived, workspaceId]);

	const restore = async (page: CanvasMeta) => {
		try {
			await patchPage(workspaceId, page.id, { archived: false });
			await loadArchived();
		} catch (e) {
			setError(errorText(e));
		}
	};

	const purge = async (page: CanvasMeta) => {
		if (!window.confirm(`Supprimer définitivement « ${pageLabel(page)} » et ses sous-pages ?`)) {
			return;
		}
		try {
			await api('DELETE', `/w/${workspaceId}/canvases/${page.id}`);
			await loadArchived();
		} catch (e) {
			setError(errorText(e));
		}
	};

	const recent = [...(items ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);

	return (
		<div className='canvas-list'>
			<div className='canvas-list-head'>
				<div>
					<h2>Pages</h2>
					<p className='muted'>Notes, wikis et comptes-rendus rédigés à plusieurs, rangés en arbre.</p>
				</div>
				<div className='page-home-actions'>
					<button type='button' className='btn' onClick={() => setTemplates(true)}>
						<Icon name='copy' size={16} /> <span className='hide-mobile'>Depuis un modèle</span>
					</button>
					<button type='button' className='btn btn-primary' onClick={() => void createPage(workspaceId).catch((e: unknown) => setError(errorText(e)))}>
						<Icon name='plus' size={16} /> Nouvelle page
					</button>
				</div>
			</div>
			{error && <p className='notice notice-error'>{error}</p>}
			{items === null ? (
				!error && <div className='spinner' aria-busy />
			) : items.length === 0 ? (
				<div className='canvas-empty'>
					<p>Aucune page pour l’instant.</p>
					<p className='muted'>Crée la première, pars d’un modèle, ou ouvre l’onglet Page d’un salon.</p>
				</div>
			) : (
				<div className='page-home'>
					<section className='page-home-tree'>
						<h3>Toutes les pages</h3>
						<PageTree workspaceId={workspaceId} activeId={null} onError={setError} />
					</section>
					<section>
						<h3>Récentes</h3>
						<ul className='canvas-rows'>
							{recent.map((c) => (
								<li key={c.id}>
									<a href={canvasPath(workspaceId, c.id)} className='canvas-row' onClick={go(canvasPath(workspaceId, c.id))}>
										<span className='canvas-row-icon'>
											<PageIcon icon={c.icon} size={18} />
										</span>
										<span className='canvas-row-main'>
											<span className='canvas-row-title ellipsis'>{pageLabel(c)}</span>
											<span className='canvas-row-excerpt ellipsis'>{c.excerpt || 'Vide pour l’instant'}</span>
										</span>
										{c.channelId && (
											<span className='canvas-chip hide-mobile'>
												<Icon name='hash' size={13} />
												<span className='ellipsis'>{channelLabel(c.channelId)}</span>
											</span>
										)}
										<Editors ids={c.editors} members={members} />
										<time className='canvas-row-date hide-mobile'>{when(c.updatedAt)}</time>
									</a>
								</li>
							))}
						</ul>
					</section>
				</div>
			)}
			<section className='page-archived'>
				<button type='button' className='page-archived-toggle' aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
					<span className={`page-caret${showArchived ? ' page-caret-open' : ''}`}>
						<Icon name='chevron' size={12} />
					</span>
					Archivées
				</button>
				{showArchived &&
					(archived === null ? (
						<div className='spinner' aria-busy />
					) : archived.length === 0 ? (
						<p className='muted page-archived-empty'>Aucune page archivée.</p>
					) : (
						<ul className='page-archived-list'>
							{archived.map((p) => (
								<li key={p.id}>
									<PageIcon icon={p.icon} />
									<a href={canvasPath(workspaceId, p.id)} className='grow ellipsis' onClick={go(canvasPath(workspaceId, p.id))}>
										{pageLabel(p)}
									</a>
									<time className='muted hide-mobile'>Archivée {when(p.archivedAt ?? p.updatedAt).toLowerCase()}</time>
									{p.access === 'write' && (
										<button type='button' className='btn' onClick={() => void restore(p)}>
											Restaurer
										</button>
									)}
									<button type='button' className='btn btn-danger-ghost' onClick={() => void purge(p)}>
										Supprimer définitivement
									</button>
								</li>
							))}
						</ul>
					))}
			</section>
			<TemplatePicker workspaceId={workspaceId} open={templates} onClose={() => setTemplates(false)} />
		</div>
	);
}

const noSubscribe = () => () => undefined;

const STATUS: Record<SyncStatus, string> = { connecting: 'Connexion…', synced: 'Enregistré', offline: 'Hors ligne, reconnexion…' };

function CanvasDocument({ workspaceId, canvasId, myId, members, channels, perms, workspacePerms, onOpenChannel, channelLabel }: Props & { canvasId: string }) {
	const [meta, setMeta] = useState<CanvasMeta | null>(null);
	const [sharing, setSharing] = useState(false);
	const [accessTick, setAccessTick] = useState(0);
	const [related, setRelated] = useState<PageRelated | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [session, setSession] = useState<{ doc: Y.Doc; sync: CanvasSync } | null>(null);
	const [editor, setEditor] = useState<Editor | null>(null);
	const [title, setTitle] = useState('');
	const [peers, setPeers] = useState<Array<{ id: number; name: string; color: string }>>([]);
	const [menu, setMenu] = useState<'share' | 'more' | 'cover' | null>(null);
	const [iconAt, setIconAt] = useState<DOMRect | null>(null);
	const [comments, setComments] = useState<{ pending: PendingComment | null; focus: string | null } | null>(() => {
		const thread = new URLSearchParams(location.search).get('commentaire');
		return thread ? { pending: null, focus: thread } : null;
	});
	const [openThreads, setOpenThreads] = useState(0);
	const shareRef = useRef<HTMLDivElement>(null);
	const moreRef = useRef<HTMLDivElement>(null);
	const coverRef = useRef<HTMLDivElement>(null);
	const coverInput = useRef<HTMLInputElement>(null);
	useDismiss(menu === 'share' ? shareRef : menu === 'cover' ? coverRef : moreRef, menu !== null, () => setMenu(null));
	const status = useSyncExternalStore(session?.sync.subscribe ?? noSubscribe, () => session?.sync.status ?? 'connecting');
	const myName = members.get(myId)?.name ?? 'Moi';
	usePages(workspaceId);

	const loadRelated = () =>
		api<PageRelated>('GET', `/w/${workspaceId}/canvases/${canvasId}/related`)
			.then(setRelated)
			.catch(() => undefined);

	useEffect(() => {
		api<CanvasMeta>('GET', `/w/${workspaceId}/canvases/${canvasId}`)
			.then(setMeta)
			.catch((e: unknown) => setError(errorText(e)));
		void loadRelated();
		window.addEventListener('focus', loadRelated);
		return () => window.removeEventListener('focus', loadRelated);
	}, [workspaceId, canvasId, accessTick]);

	useEffect(() => {
		const reread = () => setAccessTick((n) => n + 1);
		window.addEventListener('synq-canvas-access', reread);
		return () => window.removeEventListener('synq-canvas-access', reread);
	}, []);

	useEffect(() => {
		if (!meta) {
			return;
		}
		const doc = new Y.Doc();
		const sync = new CanvasSync(doc, canvasSocketUrl(workspaceId, meta.id));
		setSession({ doc, sync });
		return () => {
			sync.destroy();
			doc.destroy();
			setSession(null);
		};
	}, [workspaceId, meta?.id]);

	useEffect(() => {
		if (!session || !meta) {
			return;
		}
		const map = session.doc.getMap<string>('meta');
		const read = () => {
			const next = map.get('title') ?? meta.title;
			setTitle(next);
			localPage(workspaceId, meta.id, { title: next });
		};
		read();
		map.observe(read);
		const awareness = session.sync.awareness;
		const readPeers = () =>
			setPeers(
				[...awareness.getStates()]
					.filter(([id, state]) => id !== session.doc.clientID && state.user)
					.map(([id, state]) => ({ id, name: String(state.user.name), color: String(state.user.color) })),
			);
		readPeers();
		awareness.on('change', readPeers);
		return () => {
			map.unobserve(read);
			awareness.off('change', readPeers);
		};
	}, [session, meta?.id]);

	// Premier passage : le titre choisi à la création entre dans le document partagé.
	useEffect(() => {
		const map = session?.doc.getMap<string>('meta');
		if (status === 'synced' && meta?.access === 'write' && map && !map.has('title')) {
			map.set('title', meta.title);
		}
	}, [status, session, meta]);

	useEffect(() => {
		editor?.commands.updateUser({ name: myName, color: colorFor(myId) });
	}, [editor, myName, myId]);

	if (error) {
		return (
			<div className='canvas-empty'>
				<p>{error}</p>
				<button type='button' className='btn' onClick={() => navigate(`/w/${workspaceId}/canevas`)}>
					Voir toutes les pages
				</button>
			</div>
		);
	}
	if (!meta || !session) {
		return <div className='spinner' aria-busy />;
	}

	const archived = meta.archivedAt !== null;
	const editable = meta.access === 'write' && !archived;
	const link = `${location.origin}${canvasPath(workspaceId, meta.id)}`;
	const targets = channels.filter((c) => c.kind === 'text' && has(perms[c.id] ?? 0, P.SEND_MESSAGES));
	const canDelete = meta.level === 'manage';

	const update = async (patch: PagePatch) => {
		setMenu(null);
		try {
			const next = await patchPage(workspaceId, meta.id, patch);
			setMeta((prev) => (prev ? { ...prev, ...next } : next));
		} catch (e) {
			setNotice(errorText(e));
		}
	};

	const share = async (channel: Channel) => {
		setMenu(null);
		try {
			await api('POST', `/w/${workspaceId}/channels/${channel.id}/messages`, { body: link });
			setNotice(`Lien envoyé dans #${channel.name}`);
		} catch (e) {
			setNotice(errorText(e));
		}
	};

	const exportMarkdown = () => {
		setMenu(null);
		if (!editor) {
			return;
		}
		const blob = new Blob([toMarkdown(title || 'Sans titre', editor.getJSON())], { type: 'text/markdown;charset=utf-8' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `${(title || 'page').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.md`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	};

	const remove = async () => {
		setMenu(null);
		if (!window.confirm('Supprimer définitivement cette page et ses sous-pages pour tout le monde ?')) {
			return;
		}
		try {
			await api('DELETE', `/w/${workspaceId}/canvases/${meta.id}`);
			await refreshPages(workspaceId);
			navigate(`/w/${workspaceId}/canevas`);
		} catch (e) {
			setNotice(errorText(e));
		}
	};

	const uploadCover = async (file: File) => {
		if (!CANVAS_IMAGE_TYPES.includes(file.type)) {
			setNotice('Seules les images (PNG, JPEG, GIF, WebP, AVIF) peuvent servir de couverture.');
			return;
		}
		try {
			const { id } = await upload<{ id: string }>(`/w/${workspaceId}/canvases/${meta.id}/files`, file);
			await update({ cover: id });
		} catch (e) {
			setNotice(errorText(e));
		}
	};

	const coverMenu = (
		<Floating anchor={coverRef} placement='bottom-end' className='popover page-cover-menu' role='menu'>
			<div className='page-swatches'>
				{Array.from({ length: PAGE_GRADIENTS }, (_, i) => (
					<button key={i} type='button' className={`page-swatch page-cover-g${i}`} aria-label={`Dégradé ${i + 1}`} onClick={() => void update({ cover: `gradient:${i}` })} />
				))}
			</div>
			<button type='button' role='menuitem' className='menu-item' onClick={() => (setMenu(null), coverInput.current?.click())}>
				<Icon name='image' size={16} /> Importer une image
			</button>
			{meta.cover && (
				<button type='button' role='menuitem' className='menu-item menu-item-danger' onClick={() => void update({ cover: null })}>
					<Icon name='trash' size={16} /> Retirer la couverture
				</button>
			)}
		</Floating>
	);

	const crumbs = related?.ancestors ?? [];

	return (
		<div className={`canvas-page${comments ? ' page-with-comments' : ''}`}>
			<div className='canvas-head'>
				{meta.channelId ? (
					<div className='canvas-tabs' role='tablist' aria-label='Vues du salon'>
						<button type='button' role='tab' aria-selected={false} className='canvas-tab' onClick={() => onOpenChannel(meta.channelId!)}>
							<Icon name='hash' size={15} />
							<span className='ellipsis'>{channelLabel(meta.channelId)}</span>
						</button>
						<button type='button' role='tab' aria-selected className='canvas-tab'>
							<Icon name='file' size={15} /> Page
						</button>
					</div>
				) : (
					<nav className='page-crumbs' aria-label='Fil d’Ariane'>
						<a href={`/w/${workspaceId}/canevas`} onClick={go(`/w/${workspaceId}/canevas`)}>
							Pages
						</a>
						{crumbs.map((c) => (
							<Fragment key={c.id}>
								<span className='page-crumb-sep'>/</span>
								<a href={canvasPath(workspaceId, c.id)} className='ellipsis' onClick={go(canvasPath(workspaceId, c.id))}>
									<PageIcon icon={c.icon} size={13} /> {pageLabel(c)}
								</a>
							</Fragment>
						))}
						<span className='page-crumb-sep'>/</span>
						<span className='page-crumb-current ellipsis' aria-current='page'>
							{title || 'Sans titre'}
						</span>
					</nav>
				)}
				<FavoriteStar kind='canvas' refId={meta.id} title={meta.title} />
				<span className='grow' />
				<span className='canvas-peers' aria-label={`${peers.length} autre${peers.length > 1 ? 's' : ''} personne${peers.length > 1 ? 's' : ''} sur cette page`}>
					{peers.slice(0, 5).map((p) => (
						<span key={p.id} className='canvas-peer' style={{ borderColor: p.color }} title={p.name}>
							<Avatar name={p.name} size={24} />
						</span>
					))}
				</span>
				<span className={`canvas-status canvas-status-${status} hide-mobile`} role='status'>
					{archived ? 'Archivée' : editable ? STATUS[status] : 'Lecture seule'}
				</span>
				<button type='button' className='btn page-comments-btn' aria-pressed={!!comments} onClick={() => setComments(comments ? null : { pending: null, focus: null })}>
					<Icon name='chat' size={16} /> <span className='hide-mobile'>Commentaires</span>
					{openThreads > 0 && <span className='page-count'>{openThreads}</span>}
				</button>
				<div ref={shareRef} className='canvas-anchor'>
					<button type='button' className='btn' aria-haspopup='menu' aria-expanded={menu === 'share'} onClick={() => setMenu(menu === 'share' ? null : 'share')}>
						<Icon name='share' size={16} /> <span className='hide-mobile'>Partager</span>
					</button>
					{menu === 'share' && (
						<Floating anchor={shareRef} placement='bottom-end' className='popover' role='menu' style={{ width: 260 }}>
							<button
								type='button'
								role='menuitem'
								className='menu-item'
								onClick={() => {
									setMenu(null);
									setSharing(true);
								}}
							>
								<Icon name='users' size={16} /> {meta.level === 'manage' ? 'Gérer l’accès…' : 'Voir qui a accès'}
							</button>
							<button
								type='button'
								role='menuitem'
								className='menu-item'
								onClick={() => {
									setMenu(null);
									void navigator.clipboard.writeText(link).then(() => setNotice('Lien copié'));
								}}
							>
								<Icon name='link' size={16} /> Copier le lien
							</button>
							{targets.length > 0 && <div className='menu-sep' />}
							{targets.map((c) => (
								<button key={c.id} type='button' role='menuitem' className='menu-item' onClick={() => void share(c)}>
									<Icon name='hash' size={16} /> <span className='grow ellipsis'>Envoyer dans {c.name}</span>
								</button>
							))}
						</Floating>
					)}
				</div>
				{sharing && <ShareDialog workspaceId={workspaceId} kind='page' id={meta.id} title={pageLabel(meta)} onClose={() => setSharing(false)} onChanged={() => void refreshPages(workspaceId).catch(() => undefined)} />}
				<div ref={moreRef} className='canvas-anchor'>
					<button type='button' className='icon-btn' aria-label='Plus d’actions' aria-haspopup='menu' aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')}>
						<Icon name='more' />
					</button>
					{menu === 'more' && (
						<Floating anchor={moreRef} placement='bottom-end' className='popover' role='menu' style={{ width: 240 }}>
							<button type='button' role='menuitem' className='menu-item' onClick={exportMarkdown}>
								<Icon name='download' size={16} /> Exporter en Markdown
							</button>
							{editable && !meta.channelId && (
								<button
									type='button'
									role='menuitem'
									className='menu-item'
									onClick={() => {
										setMenu(null);
										void duplicatePage(workspaceId, meta.id)
											.then((copy) => navigate(canvasPath(workspaceId, copy.id)))
											.catch((e: unknown) => setNotice(errorText(e)));
									}}
								>
									<Icon name='copy' size={16} /> Dupliquer
								</button>
							)}
							{editable && !meta.channelId && (
								<button type='button' role='menuitem' className='menu-item' onClick={() => void update({ archived: true })}>
									<Icon name='folder' size={16} /> Archiver
								</button>
							)}
							{canDelete && (
								<button type='button' role='menuitem' className='menu-item menu-item-danger' onClick={() => void remove()}>
									<Icon name='trash' size={16} /> Supprimer définitivement
								</button>
							)}
						</Floating>
					)}
				</div>
			</div>
			{notice && (
				<p className='notice canvas-notice' role='status' onAnimationEnd={() => setNotice(null)}>
					{notice}
				</p>
			)}
			<div className='page-body'>
				<div className='canvas-scroll'>
					{archived && (
						<div className='page-archived-banner' role='status'>
							<span className='grow'>Cette page est archivée : elle reste lisible mais n’est plus modifiable.</span>
							{meta.access === 'write' && (
								<button type='button' className='btn' onClick={() => void update({ archived: false })}>
									Restaurer
								</button>
							)}
						</div>
					)}
					{meta.cover && (
						<div ref={coverRef} className={coverClass(meta.cover)} style={coverStyle(meta.cover)}>
							{editable && (
								<button type='button' className='btn page-cover-change' onClick={() => setMenu(menu === 'cover' ? null : 'cover')}>
									Changer la couverture
								</button>
							)}
							{menu === 'cover' && coverMenu}
						</div>
					)}
					<article className={`canvas-sheet${meta.cover ? ' page-has-cover' : ''}`}>
						{meta.icon && (
							<button type='button' className='page-icon' aria-label='Changer l’icône' disabled={!editable} onClick={(e) => setIconAt(e.currentTarget.getBoundingClientRect())}>
								{meta.icon}
							</button>
						)}
						{editable && (
							<div className='page-chrome' ref={meta.cover ? undefined : coverRef}>
								{!meta.icon && (
									<button type='button' className='page-chrome-btn' onClick={(e) => setIconAt(e.currentTarget.getBoundingClientRect())}>
										<Icon name='smile' size={15} /> Ajouter une icône
									</button>
								)}
								{meta.icon && (
									<button type='button' className='page-chrome-btn' onClick={() => void update({ icon: null })}>
										<Icon name='close' size={15} /> Retirer l’icône
									</button>
								)}
								{!meta.cover && (
									<button type='button' className='page-chrome-btn' onClick={() => void update({ cover: `gradient:${Math.floor(Math.random() * PAGE_GRADIENTS)}` })}>
										<Icon name='image' size={15} /> Ajouter une couverture
									</button>
								)}
								<button type='button' className='page-chrome-btn' onClick={() => setComments({ pending: null, focus: null })}>
									<Icon name='chat' size={15} /> Commenter
								</button>
								{!meta.cover && menu === 'cover' && coverMenu}
							</div>
						)}
						<input
							className='canvas-title'
							value={title}
							readOnly={!editable}
							placeholder='Sans titre'
							maxLength={120}
							aria-label='Titre de la page'
							onChange={(e) => session.doc.getMap<string>('meta').set('title', e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									editor?.commands.focus('start');
								}
							}}
						/>
						<div className='canvas-byline'>
							<Editors ids={meta.editors} members={members} />
							<span>Modifiée {when(meta.updatedAt).replace(/^Aujourd’hui/, 'aujourd’hui')}</span>
						</div>
						<CanvasEditor
							key={editable ? 'w' : 'r'}
							workspaceId={workspaceId}
							meta={{ ...meta, access: editable ? 'write' : 'read' }}
							doc={session.doc}
							sync={session.sync}
							members={members}
							me={{ name: myName, color: colorFor(myId) }}
							title={title}
							onEditor={setEditor}
							onError={setNotice}
							onComment={(pending) => setComments({ pending, focus: null })}
							onOpenThread={(thread) => setComments({ pending: null, focus: thread })}
						/>
						<footer className='page-foot'>
							<section>
								<h4>Sous-pages</h4>
								{related?.children.length ? (
									<ul>
										{related.children.map((c) => (
											<li key={c.id}>
												<a href={canvasPath(workspaceId, c.id)} onClick={go(canvasPath(workspaceId, c.id))}>
													<PageIcon icon={c.icon} /> <span className='ellipsis'>{pageLabel(c)}</span>
												</a>
											</li>
										))}
									</ul>
								) : (
									<p className='muted'>Aucune sous-page.</p>
								)}
								{editable && (
									<button type='button' className='page-chrome-btn' onClick={() => void createPage(workspaceId, { parentId: meta.id }).catch((e: unknown) => setNotice(errorText(e)))}>
										<Icon name='plus' size={15} /> Ajouter une sous-page
									</button>
								)}
							</section>
							<section>
								<h4>Pages qui mentionnent celle-ci</h4>
								{related?.backlinks.length ? (
									<ul>
										{related.backlinks.map((c) => (
											<li key={c.id}>
												<a href={canvasPath(workspaceId, c.id)} onClick={go(canvasPath(workspaceId, c.id))}>
													<PageIcon icon={c.icon} /> <span className='ellipsis'>{pageLabel(c)}</span>
												</a>
											</li>
										))}
									</ul>
								) : (
									<p className='muted'>Aucune page ne mentionne celle-ci. Tape [[ dans une autre page pour la lier.</p>
								)}
							</section>
						</footer>
					</article>
				</div>
				{comments && (
					<CommentsPanel
						workspaceId={workspaceId}
						pageId={meta.id}
						editor={editor}
						members={members}
						myId={myId}
						canWrite={editable}
						pending={comments.pending}
						focus={comments.focus}
						onPendingDone={() => setComments({ pending: null, focus: null })}
						onClose={() => setComments(null)}
						onCount={setOpenThreads}
					/>
				)}
			</div>
			{iconAt && (
				<EmojiPicker
					anchor={iconAt}
					onPick={(icon) => {
						setIconAt(null);
						void update({ icon });
					}}
					onClose={() => setIconAt(null)}
				/>
			)}
			<input
				ref={coverInput}
				type='file'
				accept={CANVAS_IMAGE_TYPES.join(',')}
				hidden
				onChange={(e) => {
					const file = e.target.files?.[0];
					e.target.value = '';
					if (file) {
						void uploadCover(file);
					}
				}}
			/>
		</div>
	);
}
