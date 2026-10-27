import { useCallback, useEffect, useMemo, useState } from 'react';

import type { MailboxInfo, MailThread, MailThreadDetail } from '../../shared/mail';
import type { Me, WorkspaceSummary } from '../../shared/types';
import { AiAssist } from '../ai/AiAssist';
import { api, errorText } from '../api';
import { Icon } from '../ui';
import { BoxDialog } from './BoxDialog';
import { Composer, newSeed, type ComposeSeed } from './Composer';
import { ThreadList, type MailTab } from './ThreadList';
import { ThreadView } from './ThreadView';
import './mail.css';

type Filter = { workspaceId: string; boxId: string; tab: MailTab };
type Open = { seed: ComposeSeed; minimized: boolean; maximized: boolean };
type Seen = { since: number; threads: Record<string, number> };

const SEEN_KEY = 'synq:mail-seen';
const SEEN_MAX = 500;

// Lu/non lu propre à ce navigateur : le serveur ne suit pas la lecture.
function readSeen(): Seen {
	try {
		const raw = localStorage.getItem(SEEN_KEY);
		if (raw) {
			return JSON.parse(raw) as Seen;
		}
	} catch {
		// Stockage indisponible.
	}
	const fresh = { since: Date.now(), threads: {} };
	writeSeen(fresh);
	return fresh;
}

function writeSeen(seen: Seen) {
	try {
		const entries = Object.entries(seen.threads).sort((a, b) => b[1] - a[1]).slice(0, SEEN_MAX);
		localStorage.setItem(SEEN_KEY, JSON.stringify({ since: seen.since, threads: Object.fromEntries(entries) }));
	} catch {
		// Stockage indisponible.
	}
}

const initialThread = () => new URLSearchParams(location.search).get('thread');

export function MailView({ me, workspaces }: { me: Me; workspaces: WorkspaceSummary[] }) {
	const [boxes, setBoxes] = useState<MailboxInfo[] | null>(null);
	const [filter, setFilter] = useState<Filter>({ workspaceId: '', boxId: '', tab: 'open' });
	const [threads, setThreads] = useState<MailThread[] | null>(null);
	const [selected, setSelected] = useState<string | null>(initialThread);
	const [editing, setEditing] = useState<MailboxInfo | 'new' | null>(null);
	const [composers, setComposers] = useState<Open[]>([]);
	const [version, setVersion] = useState(0);
	const [seen, setSeen] = useState(readSeen);
	const [error, setError] = useState<string | null>(null);

	const loadBoxes = useCallback(async () => {
		try {
			setBoxes(await api<MailboxInfo[]>('GET', '/mail/boxes'));
		} catch (e) {
			setError(errorText(e));
		}
	}, []);

	const loadThreads = useCallback(async () => {
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

	useEffect(() => {
		void loadBoxes();
	}, [loadBoxes]);

	// Relève serveur toutes les 60 s : la liste suit le même rythme.
	useEffect(() => {
		setThreads(null);
		void loadThreads();
		const timer = setInterval(() => void loadThreads(), 60_000);
		return () => clearInterval(timer);
	}, [loadThreads]);

	const markSeen = useCallback((id: string) => {
		setSeen((current) => {
			const next = { since: current.since, threads: { ...current.threads, [id]: Date.now() } };
			writeSeen(next);
			return next;
		});
	}, []);

	const select = useCallback(
		(id: string | null) => {
			setSelected(id);
			history.replaceState(null, '', id ? `/mail?thread=${encodeURIComponent(id)}` : '/mail');
			if (id) {
				markSeen(id);
			}
		},
		[markSeen],
	);

	useEffect(() => {
		if (selected) {
			markSeen(selected);
		}
	}, [selected, version, markSeen]);

	const boxById = useMemo(() => new Map((boxes ?? []).map((box) => [box.id, box])), [boxes]);
	const visible = (boxes ?? []).filter((box) => !filter.workspaceId || box.shares.some((share) => share.workspaceId === filter.workspaceId));
	const senders = (boxes ?? []).filter((box) => box.access.reply);
	const update = (patch: Partial<Filter>) => setFilter((current) => ({ ...current, ...patch }));
	const isUnread = (thread: MailThread) => thread.lastAt > (seen.threads[thread.id] ?? seen.since);

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
	};

	const sent = (id: string | null, detail: MailThreadDetail) => {
		if (id) {
			setComposers((current) => current.filter((item) => item.seed.id !== id));
		}
		setVersion((v) => v + 1);
		void loadThreads();
		select(detail.thread.id);
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
		<div className={`mail${selected ? ' mail-reading' : ''}`}>
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
						<span className='mail-box-name'>Toutes les boîtes</span>
					</button>
					{visible.map((box) => (
						<div key={box.id} className='mail-box-row'>
							<button className='mail-box' aria-selected={filter.boxId === box.id} onClick={() => update({ boxId: box.id })}>
								<span className='mail-box-name'>{box.name}</span>
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
				threads={threads}
				boxes={boxById}
				selected={selected}
				error={error}
				empty={empty}
				canCompose={senders.length > 0}
				isUnread={isUnread}
				onTab={(tab) => update({ tab })}
				onSelect={select}
				onCompose={startNew}
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
					/>
				) : (
					<p className='mail-empty'>Sélectionne une conversation.</p>
				)}
			</section>
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
							aiSlot={(field) => <AiAssist textarea={field.textarea} value={field.value} onChange={field.onChange} context={item.seed.subject} />}
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
