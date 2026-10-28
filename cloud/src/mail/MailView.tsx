import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import type { MailboxInfo, MailDraft, MailScheduleInput, MailThread, MailThreadDetail } from '../../shared/mail';
import type { Me, WorkspaceSummary } from '../../shared/types';
import { AiAssist } from '../ai/AiAssist';
import { api, errorText } from '../api';
import { Icon } from '../ui';
import { useUserEvents } from '../userEvents';
import { ResizeHandle, useResizable } from '../workspace/resizable';
import { BoxDialog } from './BoxDialog';
import { Composer, newSeed, seedFromDraft, type ComposeSeed } from './Composer';
import { longDate } from './format';
import { searchTerms } from './Highlight';
import { ThreadList, ordered, type MailTab } from './ThreadList';
import { ThreadView } from './ThreadView';
import './mail.css';

type Filter = { workspaceId: string; boxId: string; tab: MailTab };
type Open = { seed: ComposeSeed; minimized: boolean; maximized: boolean };

const initialThread = () => new URLSearchParams(location.search).get('thread');

const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function MailView({ me, workspaces }: { me: Me; workspaces: WorkspaceSummary[] }) {
	const navWidth = useResizable({ pref: 'mail_nav_width', min: 180, max: 360, initial: 220, edge: 'end' });
	const listWidth = useResizable({ pref: 'mail_list_width', min: 260, max: 640, initial: 340, edge: 'end' });
	const [boxes, setBoxes] = useState<MailboxInfo[] | null>(null);
	const [filter, setFilter] = useState<Filter>({ workspaceId: '', boxId: '', tab: 'open' });
	const [threads, setThreads] = useState<MailThread[] | null>(null);
	const [drafts, setDrafts] = useState<MailDraft[] | null>(null);
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<MailThread[] | null>(null);
	const [selected, setSelected] = useState<string | null>(initialThread);
	const [editing, setEditing] = useState<MailboxInfo | 'new' | null>(null);
	const [composers, setComposers] = useState<Open[]>([]);
	const [version, setVersion] = useState(0);
	const [flash, setFlash] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const loadBoxes = useCallback(async () => {
		try {
			setBoxes(await api<MailboxInfo[]>('GET', '/mail/boxes'));
		} catch (e) {
			setError(errorText(e));
		}
	}, []);

	const loadThreads = useCallback(async () => {
		if (filter.tab === 'drafts') {
			return;
		}
		const query = new URLSearchParams({ status: filter.tab === 'mine' ? 'open' : filter.tab });
		if (filter.boxId) {
			query.set('box', filter.boxId);
		}
		if (filter.workspaceId) {
			query.set('workspace', filter.workspaceId);
		}
		if (filter.tab === 'mine') {
			query.set('mine', '1');
		}
		try {
			setThreads(await api<MailThread[]>('GET', `/mail/threads?${query}`));
			setError(null);
		} catch (e) {
			setError(errorText(e));
		}
	}, [filter]);

	const loadDrafts = useCallback(async () => {
		try {
			setDrafts(await api<MailDraft[]>('GET', '/mail/drafts'));
		} catch (e) {
			setError(errorText(e));
		}
	}, []);

	useEffect(() => {
		void loadBoxes();
	}, [loadBoxes]);

	// Filet de sécurité si le canal personnel est coupé.
	useEffect(() => {
		setThreads(null);
		void loadThreads();
		const timer = setInterval(() => (void loadThreads(), void loadBoxes()), 60_000);
		return () => clearInterval(timer);
	}, [loadThreads, loadBoxes]);

	useEffect(() => {
		if (filter.tab === 'drafts') {
			setDrafts(null);
			void loadDrafts();
		}
	}, [filter.tab, loadDrafts]);

	// Nouveau mail ou action d'un collègue : liste, compteurs et fil ouvert relus d'un coup.
	const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(pending.current), []);
	useUserEvents((event) => {
		if (event.t !== 'mail' && event.t !== 'resync') {
			return;
		}
		clearTimeout(pending.current);
		pending.current = setTimeout(() => {
			void loadThreads();
			void loadBoxes();
			if (filter.tab === 'drafts') {
				void loadDrafts();
			}
			setVersion((v) => v + 1);
		}, 300);
	});

	const terms = useMemo(() => searchTerms(query), [query]);
	const searching = query.trim().length >= 2;

	useEffect(() => {
		if (!searching) {
			setResults(null);
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			const params = new URLSearchParams({ q: query.trim() });
			if (filter.boxId) {
				params.set('box', filter.boxId);
			}
			if (filter.workspaceId) {
				params.set('workspace', filter.workspaceId);
			}
			api<MailThread[]>('GET', `/mail/search?${params}`)
				.then((found) => !cancelled && (setResults(found), setError(null)))
				.catch((e) => !cancelled && setError(errorText(e)));
		}, 300);
		setResults(null);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [query, searching, filter.boxId, filter.workspaceId]);

	useEffect(() => {
		if (!flash) {
			return;
		}
		const timer = setTimeout(() => setFlash(null), 4000);
		return () => clearTimeout(timer);
	}, [flash]);

	const setUnread = (id: string, unread: boolean) => {
		const patch = (list: MailThread[] | null) => list?.map((thread) => (thread.id === id ? { ...thread, unread } : thread)) ?? null;
		setThreads(patch);
		setResults(patch);
	};

	const select = useCallback((id: string | null) => {
		setSelected(id);
		history.replaceState(null, '', id ? `/mail?thread=${encodeURIComponent(id)}` : '/mail');
	}, []);

	// Le serveur marque lu à la lecture du fil : liste locale et compteurs suivent.
	const onRead = useCallback(
		(id: string) => {
			setUnread(id, false);
			void loadBoxes();
		},
		[loadBoxes],
	);

	const markUnread = useCallback(
		async (id: string) => {
			try {
				await api<MailThread>('POST', `/mail/threads/${id}/read`, { read: false });
				setUnread(id, true);
				select(null);
				void loadBoxes();
			} catch (e) {
				setError(errorText(e));
			}
		},
		[loadBoxes, select],
	);

	const boxById = useMemo(() => new Map((boxes ?? []).map((box) => [box.id, box])), [boxes]);
	const visible = (boxes ?? []).filter((box) => !filter.workspaceId || box.shares.some((share) => share.workspaceId === filter.workspaceId));
	const senders = (boxes ?? []).filter((box) => box.access.reply);
	const update = (patch: Partial<Filter>) => setFilter((current) => ({ ...current, ...patch }));
	const totalUnread = visible.reduce((sum, box) => sum + (box.unread ?? 0), 0);
	const shown = searching ? results : filter.tab === 'drafts' ? null : threads;

	const keys = useRef({ shown, selected, select, markUnread });
	keys.current = { shown, selected, select, markUnread };

	// j / k : fil suivant ou précédent ; u : non lu.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target) || document.querySelector('dialog[open], .mail-pop')) {
				return;
			}
			const k = keys.current;
			if (event.key === 'u' && k.selected) {
				event.preventDefault();
				void k.markUnread(k.selected);
				return;
			}
			if ((event.key === 'j' || event.key === 'k') && k.shown?.length) {
				const list = searching ? k.shown : ordered(k.shown);
				const index = list.findIndex((thread) => thread.id === k.selected);
				const next = index < 0 ? 0 : Math.min(list.length - 1, Math.max(0, index + (event.key === 'j' ? 1 : -1)));
				event.preventDefault();
				k.select(list[next]!.id);
				document.querySelector(`.mail-thread[aria-selected='true']`)?.scrollIntoView({ block: 'nearest' });
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [searching]);

	const compose = (seed: ComposeSeed) =>
		setComposers((current) => {
			if (current.some((item) => item.seed.id === seed.id)) {
				return current.map((item) => (item.seed.id === seed.id ? { ...item, minimized: false } : item));
			}
			// Un seul ouvert à la fois : les autres se réduisent.
			return [...current.map((item) => ({ ...item, minimized: true, maximized: false })), { seed, minimized: false, maximized: false }];
		});

	const patchComposer = (id: string, patch: (item: Open) => Partial<Open>) =>
		setComposers((current) => current.map((item) => (item.seed.id === id ? { ...item, ...patch(item) } : item)));

	const closeComposer = (id: string) => {
		setComposers((current) => current.filter((item) => item.seed.id !== id));
		setVersion((v) => v + 1);
		if (filter.tab === 'drafts') {
			void loadDrafts();
		}
	};

	const sent = (id: string | null, detail: MailThreadDetail) => {
		if (id) {
			setComposers((current) => current.filter((item) => item.seed.id !== id));
		}
		setVersion((v) => v + 1);
		void loadThreads();
		if (filter.tab === 'drafts') {
			void loadDrafts();
		}
		select(detail.thread.id);
	};

	const unschedule = async (draft: MailDraft) => {
		try {
			await api<MailDraft>('POST', `/mail/drafts/${draft.id}/schedule`, { sendAt: null } satisfies MailScheduleInput);
			await loadDrafts();
			setFlash('Envoi prévu annulé.');
		} catch (e) {
			setError(errorText(e));
		}
	};

	const startNew = () => {
		const mailboxId = filter.boxId && senders.some((box) => box.id === filter.boxId) ? filter.boxId : senders[0]?.id;
		if (mailboxId) {
			compose(newSeed({ mailboxId }));
		}
	};

	const title = filter.boxId ? (boxById.get(filter.boxId)?.name ?? 'Boîte') : 'Toutes les boîtes';
	const empty = !boxes?.length ? 'Aucune boîte. Ajoute une boîte Mailcow pour commencer.' : filter.tab === 'snoozed' ? 'Aucun fil en attente.' : 'Aucune conversation.';

	return (
		<div
			className={`mail${selected ? ' mail-reading' : ''}`}
			style={{ '--mail-nav-w': `${navWidth.width}px`, '--mail-list-w': `${listWidth.width}px` } as CSSProperties}
		>
			<ResizeHandle resize={navWidth} label='Redimensionner la liste des boîtes' className='mail-resize-nav' />
			<ResizeHandle resize={listWidth} label='Redimensionner la liste des conversations' className='mail-resize-list' />
			<aside className='mail-nav'>
				<div className='mail-nav-head'>
					<h1>Mail</h1>
					<button className='icon-btn' title='Ajouter une boîte' aria-label='Ajouter une boîte' onClick={() => setEditing('new')}>
						<Icon name='plus' />
					</button>
				</div>
				<select className='mail-select' value={filter.workspaceId} onChange={(e) => update({ workspaceId: e.target.value, boxId: '' })} aria-label='Espace'>
					<option value=''>Tous les espaces</option>
					{workspaces.map((workspace) => (
						<option key={workspace.id} value={workspace.id}>
							{workspace.name}
						</option>
					))}
				</select>
				<div className='mail-boxes'>
					<button className='mail-box' aria-selected={!filter.boxId} onClick={() => update({ boxId: '' })}>
						<span className='mail-box-name'>
							Toutes les boîtes
							{totalUnread > 0 && <span className='mail-box-count' aria-label={`${totalUnread} non lus`}>{totalUnread}</span>}
						</span>
					</button>
					{visible.map((box) => (
						<div key={box.id} className='mail-box-row'>
							<button className='mail-box' aria-selected={filter.boxId === box.id} onClick={() => update({ boxId: box.id })}>
								<span className='mail-box-name'>
									{box.name}
									{box.unread > 0 && <span className='mail-box-count' aria-label={`${box.unread} non lus`}>{box.unread}</span>}
								</span>
								<span className='mail-box-addr'>{box.address}</span>
								{box.syncError && (
									<span className='mail-box-error' title={box.syncError}>
										Relève en échec
									</span>
								)}
							</button>
							{box.access.manage && (
								<button className='icon-btn icon-btn-sm' title='Réglages de la boîte' aria-label='Réglages de la boîte' onClick={() => setEditing(box)}>
									<Icon name='settings' size={15} />
								</button>
							)}
						</div>
					))}
				</div>
			</aside>
			<ThreadList
				title={title}
				tab={filter.tab}
				threads={shown}
				drafts={drafts}
				boxes={boxById}
				selected={selected}
				error={error ?? null}
				empty={empty}
				canCompose={senders.length > 0}
				query={query}
				terms={searching ? terms : []}
				searching={searching}
				onQuery={setQuery}
				onTab={(tab) => update({ tab })}
				onSelect={select}
				onCompose={startNew}
				onDraft={(draft) => compose(seedFromDraft(draft))}
				onUnschedule={(draft) => void unschedule(draft)}
			/>
			<section className='mail-reader'>
				{selected ? (
					<ThreadView
						key={selected}
						id={selected}
						me={me}
						boxes={boxes ?? []}
						workspaces={workspaces}
						version={version}
						openDrafts={composers.map((item) => item.seed.id)}
						onBack={() => select(null)}
						onChanged={loadThreads}
						onCompose={compose}
						onSent={(detail) => sent(null, detail)}
						onRead={() => onRead(selected)}
						onUnread={() => void markUnread(selected)}
					/>
				) : (
					<p className='mail-empty'>Sélectionne une conversation.</p>
				)}
			</section>
			{flash && (
				<p className='mail-flash' role='status'>
					<Icon name='clock' size={15} />
					{flash}
				</p>
			)}
			{composers.length > 0 && (
				<div className='mail-composers'>
					{composers.map((item) => (
						<Composer
							key={item.seed.id}
							seed={item.seed}
							boxes={boxes ?? []}
							minimized={item.minimized}
							maximized={item.maximized}
							onMinimize={() => patchComposer(item.seed.id, (open) => ({ minimized: !open.minimized, maximized: false }))}
							onMaximize={() => patchComposer(item.seed.id, (open) => ({ maximized: !open.maximized }))}
							onClose={() => closeComposer(item.seed.id)}
							onSent={(detail) => sent(item.seed.id, detail)}
							onScheduled={(at) => setFlash(`Envoi prévu ${longDate(at)}.`)}
							aiSlot={(field) => <AiAssist textarea={field.textarea} value={field.value} onChange={field.onChange} context={item.seed.context ?? item.seed.subject} />}
						/>
					))}
				</div>
			)}
			{editing && (
				<BoxDialog
					box={editing === 'new' ? null : editing}
					workspaces={workspaces}
					onClose={() => setEditing(null)}
					onSaved={async () => {
						await loadBoxes();
						await loadThreads();
					}}
				/>
			)}
		</div>
	);
}
