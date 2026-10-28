import type { Editor } from '@tiptap/core';
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';
import * as Y from 'yjs';

import { canvasPath, type CanvasMeta } from '../../../shared/canvas';
import { P, has } from '../../../shared/permissions';
import type { Channel, Member } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Floating } from '../../floating';
import { navigate } from '../../router';
import { Avatar, Icon, useDismiss } from '../../ui';
import { CanvasEditor } from './CanvasEditor';
import { toMarkdown } from './markdown';
import { CanvasSync, canvasSocketUrl, colorFor, type SyncStatus } from './sync';
import './canvas.css';

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

export function CanvasPage(props: Props) {
	return props.canvasId ? <CanvasDocument key={props.canvasId} {...props} canvasId={props.canvasId} /> : <CanvasList {...props} />;
}

function CanvasList({ workspaceId, members, channelLabel }: Props) {
	const [items, setItems] = useState<CanvasMeta[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		api<CanvasMeta[]>('GET', `/w/${workspaceId}/canvases`)
			.then(setItems)
			.catch((e: unknown) => setError(errorText(e)));
	}, [workspaceId]);

	const create = async () => {
		try {
			const canvas = await api<CanvasMeta>('POST', `/w/${workspaceId}/canvases`, { title: 'Sans titre' });
			navigate(canvasPath(workspaceId, canvas.id));
		} catch (e) {
			setError(errorText(e));
		}
	};

	return (
		<div className='canvas-list'>
			<div className='canvas-list-head'>
				<div>
					<h2>Canevas</h2>
					<p className='muted'>Notes, plans et procédures rédigés à plusieurs, en direct.</p>
				</div>
				<button type='button' className='btn btn-primary' onClick={() => void create()}>
					<Icon name='plus' size={16} /> Nouveau canevas
				</button>
			</div>
			{error && <p className='notice notice-error'>{error}</p>}
			{items === null ? (
				!error && <div className='spinner' aria-busy />
			) : items.length === 0 ? (
				<div className='canvas-empty'>
					<p>Aucun canevas pour l’instant.</p>
					<p className='muted'>Crée le premier, ou ouvre l’onglet Canevas d’un salon.</p>
				</div>
			) : (
				<ul className='canvas-rows'>
					{items.map((c) => (
						<li key={c.id}>
							<a href={canvasPath(workspaceId, c.id)} className='canvas-row' onClick={go(canvasPath(workspaceId, c.id))}>
								<span className='canvas-row-icon'>
									<Icon name='file' size={18} />
								</span>
								<span className='canvas-row-main'>
									<span className='canvas-row-title ellipsis'>{c.title}</span>
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
			)}
		</div>
	);
}

const noSubscribe = () => () => undefined;

const STATUS: Record<SyncStatus, string> = { connecting: 'Connexion…', synced: 'Enregistré', offline: 'Hors ligne, reconnexion…' };

function CanvasDocument({ workspaceId, canvasId, myId, members, channels, perms, workspacePerms, onOpenChannel, channelLabel }: Props & { canvasId: string }) {
	const [meta, setMeta] = useState<CanvasMeta | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [session, setSession] = useState<{ doc: Y.Doc; sync: CanvasSync } | null>(null);
	const [editor, setEditor] = useState<Editor | null>(null);
	const [title, setTitle] = useState('');
	const [peers, setPeers] = useState<Array<{ id: number; name: string; color: string }>>([]);
	const [menu, setMenu] = useState<'share' | 'more' | null>(null);
	const shareRef = useRef<HTMLDivElement>(null);
	const moreRef = useRef<HTMLDivElement>(null);
	useDismiss(menu === 'share' ? shareRef : moreRef, menu !== null, () => setMenu(null));
	const status = useSyncExternalStore(session?.sync.subscribe ?? noSubscribe, () => session?.sync.status ?? 'connecting');
	const myName = members.get(myId)?.name ?? 'Moi';

	useEffect(() => {
		api<CanvasMeta>('GET', `/w/${workspaceId}/canvases/${canvasId}`)
			.then(setMeta)
			.catch((e: unknown) => setError(errorText(e)));
	}, [workspaceId, canvasId]);

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
		const read = () => setTitle(map.get('title') ?? meta.title);
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
	}, [session, meta]);

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
					Voir tous les canevas
				</button>
			</div>
		);
	}
	if (!meta || !session) {
		return <div className='spinner' aria-busy />;
	}

	const editable = meta.access === 'write';
	const link = `${location.origin}${canvasPath(workspaceId, meta.id)}`;
	const targets = channels.filter((c) => c.kind === 'text' && has(perms[c.id] ?? 0, P.SEND_MESSAGES));
	const canDelete = meta.createdBy === myId || has(workspacePerms, P.MANAGE_CHANNELS);

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
		a.download = `${(title || 'canevas').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.md`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	};

	const remove = async () => {
		setMenu(null);
		if (!window.confirm('Supprimer ce canevas pour tout le monde ?')) {
			return;
		}
		try {
			await api('DELETE', `/w/${workspaceId}/canvases/${meta.id}`);
			navigate(`/w/${workspaceId}/canevas`);
		} catch (e) {
			setNotice(errorText(e));
		}
	};

	return (
		<div className='canvas-page'>
			<div className='canvas-head'>
				{meta.channelId ? (
					<div className='canvas-tabs' role='tablist' aria-label='Vues du salon'>
						<button type='button' role='tab' aria-selected={false} className='canvas-tab' onClick={() => onOpenChannel(meta.channelId!)}>
							<Icon name='hash' size={15} />
							<span className='ellipsis'>{channelLabel(meta.channelId)}</span>
						</button>
						<button type='button' role='tab' aria-selected className='canvas-tab'>
							<Icon name='file' size={15} /> Canevas
						</button>
					</div>
				) : (
					<a href={`/w/${workspaceId}/canevas`} className='canvas-crumb' onClick={go(`/w/${workspaceId}/canevas`)}>
						Tous les canevas
					</a>
				)}
				<span className='grow' />
				<span className='canvas-peers' aria-label={`${peers.length} autre${peers.length > 1 ? 's' : ''} personne${peers.length > 1 ? 's' : ''} sur ce canevas`}>
					{peers.slice(0, 5).map((p) => (
						<span key={p.id} className='canvas-peer' style={{ borderColor: p.color }} title={p.name}>
							<Avatar name={p.name} size={24} />
						</span>
					))}
				</span>
				<span className={`canvas-status canvas-status-${status}`} role='status'>
					{editable ? STATUS[status] : 'Lecture seule'}
				</span>
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
				<div ref={moreRef} className='canvas-anchor'>
					<button type='button' className='icon-btn' aria-label='Plus d’actions' aria-haspopup='menu' aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')}>
						<Icon name='more' />
					</button>
					{menu === 'more' && (
						<Floating anchor={moreRef} placement='bottom-end' className='popover' role='menu' style={{ width: 240 }}>
							<button type='button' role='menuitem' className='menu-item' onClick={exportMarkdown}>
								<Icon name='download' size={16} /> Exporter en Markdown
							</button>
							{canDelete && (
								<button type='button' role='menuitem' className='menu-item menu-item-danger' onClick={() => void remove()}>
									<Icon name='trash' size={16} /> Supprimer le canevas
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
			<div className='canvas-scroll'>
				<article className='canvas-sheet'>
					<input
						className='canvas-title'
						value={title}
						readOnly={!editable}
						placeholder='Sans titre'
						maxLength={120}
						aria-label='Titre du canevas'
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
						<span>Modifié {when(meta.updatedAt).replace(/^Aujourd’hui/, 'aujourd’hui')}</span>
					</div>
					<CanvasEditor
						workspaceId={workspaceId}
						meta={meta}
						doc={session.doc}
						sync={session.sync}
						members={members}
						me={{ name: myName, color: colorFor(myId) }}
						title={title}
						onEditor={setEditor}
						onError={setNotice}
					/>
				</article>
			</div>
		</div>
	);
}
