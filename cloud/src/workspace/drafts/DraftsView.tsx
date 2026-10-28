import { useEffect, useState } from 'react';

import type { Draft, ScheduledMessage, SentPage } from '../../../shared/drafts';
import type { Message } from '../../../shared/types';
import { api, errorText } from '../../api';
import { readPref, writePref } from '../../router';
import { Icon } from '../../ui';
import { excerpt, type Lookup } from '../richText';
import { pastText, whenText } from './format';
import { DRAFTS_TAB_PREF } from './Marks';
import { ScheduleDialog } from './ScheduleDialog';
import { putDraft, putScheduled, useDrafts } from './store';
import './drafts.css';

type Tab = 'drafts' | 'scheduled' | 'sent';

const TABS: Array<{ id: Tab; label: string }> = [
	{ id: 'drafts', label: 'Brouillons' },
	{ id: 'scheduled', label: 'Programmés' },
	{ id: 'sent', label: 'Envoyés' },
];

type Props = {
	workspaceId: string;
	connId: string | null;
	lookup: Lookup;
	channelLabel: (channelId: string) => string;
	onOpenChannel: (channelId: string) => void;
	onOpenThread: (channelId: string, rootId: number) => void;
	onOpenMessage: (channelId: string, id: number) => void;
};

const files = (n: number) => (n ? `${n} fichier${n > 1 ? 's' : ''}` : '');

export function DraftsView({ workspaceId, connId, lookup, channelLabel, onOpenChannel, onOpenThread, onOpenMessage }: Props) {
	const [tab, setTabState] = useState<Tab>(() => {
		const saved = readPref(DRAFTS_TAB_PREF);
		return TABS.some((t) => t.id === saved) ? (saved as Tab) : 'drafts';
	});
	const { drafts, scheduled, loaded } = useDrafts();
	const [error, setError] = useState<string | null>(null);
	const [moving, setMoving] = useState<ScheduledMessage | null>(null);

	const setTab = (next: Tab) => {
		setTabState(next);
		setError(null);
		writePref(DRAFTS_TAB_PREF, next);
	};

	const run = (action: Promise<unknown>) => {
		setError(null);
		action.catch((e: unknown) => setError(errorText(e)));
	};

	const where = (channelId: string, threadRoot: number) => (threadRoot ? `Fil dans ${channelLabel(channelId)}` : channelLabel(channelId));
	const open = (channelId: string, threadRoot: number) => (threadRoot ? onOpenThread(channelId, threadRoot) : onOpenChannel(channelId));
	const counts: Record<Tab, number> = { drafts: drafts.length, scheduled: scheduled.length, sent: 0 };

	return (
		<section className='dm-view drafts-view' aria-label='Brouillons et envois'>
			<header className='dm-view-head'>
				<h2>Brouillons et envois</h2>
			</header>
			<div className='drafts-tabs'>
				<div className='segmented' role='tablist' aria-label='Afficher'>
					{TABS.map((t) => (
						<button key={t.id} type='button' role='tab' aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
							{t.label}
							{counts[t.id] > 0 && <span className='drafts-tab-count'>{counts[t.id]}</span>}
						</button>
					))}
				</div>
			</div>
			{error && <p className='notice notice-error drafts-notice'>{error}</p>}
			{tab === 'sent' ? (
				<SentList workspaceId={workspaceId} connId={connId} lookup={lookup} channelLabel={channelLabel} onOpen={onOpenMessage} onOpenThread={onOpenThread} />
			) : !loaded ? (
				<div className='spinner' aria-busy />
			) : tab === 'drafts' ? (
				drafts.length === 0 ? (
					<p className='dm-empty muted'>Aucun brouillon. Ce que tu commences à écrire dans un salon ou un fil est gardé ici, sur tous tes appareils.</p>
				) : (
					<ul className='dm-list'>
						{drafts.map((d: Draft) => (
							<li key={`${d.channelId}:${d.threadRoot}`} className='draft-item'>
								<button type='button' className='dm-row' onClick={() => open(d.channelId, d.threadRoot)}>
									<span className='draft-icon'>
										<Icon name={d.threadRoot ? 'thread' : 'pencil'} size={16} />
									</span>
									<span className='dm-row-main'>
										<span className='dm-row-top'>
											<strong className='ellipsis'>{where(d.channelId, d.threadRoot)}</strong>
											<time dateTime={new Date(d.updatedAt).toISOString()}>{pastText(d.updatedAt)}</time>
										</span>
										<span className='dm-row-last ellipsis'>{excerpt(d.body, lookup, 140) || files(d.attachments.length)}</span>
									</span>
								</button>
								<div className='draft-actions'>
									<button
										type='button'
										className='icon-btn icon-btn-sm'
										aria-label='Supprimer le brouillon'
										title='Supprimer'
										onClick={() =>
											run(api('DELETE', `/w/${workspaceId}/drafts/${d.channelId}?thread=${d.threadRoot}`).then(() => putDraft(d.channelId, d.threadRoot, null)))
										}
									>
										<Icon name='trash' size={15} />
									</button>
								</div>
							</li>
						))}
					</ul>
				)
			) : scheduled.length === 0 ? (
				<p className='dm-empty muted'>Aucun message programmé. Choisis une heure avec la flèche à côté du bouton d’envoi.</p>
			) : (
				<ul className='dm-list'>
					{scheduled.map((s) => (
						<li key={s.id} className={`draft-item${s.status === 'failed' ? ' is-failed' : ''}`}>
							<button type='button' className='dm-row' onClick={() => open(s.channelId, s.threadRoot)}>
								<span className='draft-icon'>
									<Icon name='clock' size={16} />
								</span>
								<span className='dm-row-main'>
									<span className='dm-row-top'>
										<strong className='ellipsis'>{where(s.channelId, s.threadRoot)}</strong>
									</span>
									<span className='dm-row-last ellipsis'>{excerpt(s.body, lookup, 140) || files(s.attachments.length)}</span>
									<span className='draft-when'>{s.status === 'failed' ? `Non envoyé : ${s.error ?? 'erreur inconnue'}` : `Envoi ${whenText(s.sendAt)}`}</span>
								</span>
							</button>
							<div className='draft-actions'>
								<button
									type='button'
									className='icon-btn icon-btn-sm'
									aria-label='Envoyer maintenant'
									title='Envoyer maintenant'
									onClick={() => run(api('POST', `/w/${workspaceId}/scheduled/${s.id}/send`).then(() => putScheduled(scheduled.filter((x) => x.id !== s.id))))}
								>
									<Icon name='send' size={15} />
								</button>
								<button type='button' className='icon-btn icon-btn-sm' aria-label='Modifier l’heure' title='Modifier l’heure' onClick={() => setMoving(s)}>
									<Icon name='clock' size={15} />
								</button>
								<button
									type='button'
									className='icon-btn icon-btn-sm'
									aria-label='Supprimer le message programmé'
									title='Supprimer'
									onClick={() => run(api('DELETE', `/w/${workspaceId}/scheduled/${s.id}`).then(() => putScheduled(scheduled.filter((x) => x.id !== s.id))))}
								>
									<Icon name='trash' size={15} />
								</button>
							</div>
						</li>
					))}
				</ul>
			)}
			{moving && (
				<ScheduleDialog
					title='Modifier l’heure d’envoi'
					submitLabel='Enregistrer'
					initial={moving.status === 'pending' ? moving.sendAt : Date.now() + 3600 * 1000}
					onClose={() => setMoving(null)}
					onSubmit={async (sendAt) => {
						const updated = await api<ScheduledMessage>('PATCH', `/w/${workspaceId}/scheduled/${moving.id}`, { sendAt });
						putScheduled(scheduled.map((x) => (x.id === updated.id ? updated : x)).sort((a, b) => a.sendAt - b.sendAt));
					}}
				/>
			)}
		</section>
	);
}

type SentProps = {
	workspaceId: string;
	connId: string | null;
	lookup: Lookup;
	channelLabel: (channelId: string) => string;
	onOpen: (channelId: string, id: number) => void;
	onOpenThread: (channelId: string, rootId: number) => void;
};

function SentList({ workspaceId, connId, lookup, channelLabel, onOpen, onOpenThread }: SentProps) {
	const [messages, setMessages] = useState<Message[] | null>(null);
	const [next, setNext] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const load = (before: number | null) => {
		setBusy(true);
		return api<SentPage>('GET', `/w/${workspaceId}/sent${before ? `?before=${before}` : ''}`)
			.then((page) => {
				setMessages((current) => [...(before ? (current ?? []) : []), ...page.messages]);
				setNext(page.next);
				setError(null);
			})
			.catch((e: unknown) => setError(errorText(e)))
			.finally(() => setBusy(false));
	};

	useEffect(() => {
		if (connId) {
			void load(null);
		}
		// Rechargé à la reconnexion.
	}, [workspaceId, connId]);

	if (error && !messages) {
		return <p className='notice notice-error drafts-notice'>{error}</p>;
	}
	if (!messages) {
		return <div className='spinner' aria-busy />;
	}
	if (!messages.length) {
		return <p className='dm-empty muted'>Tu n’as encore rien envoyé dans cet espace.</p>;
	}
	return (
		<>
			<ul className='dm-list'>
				{messages.map((m) => (
					<li key={m.id} className='draft-item'>
						<button type='button' className='dm-row' onClick={() => (m.threadRoot ? onOpenThread(m.channelId, m.threadRoot) : onOpen(m.channelId, m.id))}>
							<span className='draft-icon'>
								<Icon name={m.threadRoot ? 'thread' : 'hash'} size={16} />
							</span>
							<span className='dm-row-main'>
								<span className='dm-row-top'>
									<strong className='ellipsis'>{m.threadRoot ? `Fil dans ${channelLabel(m.channelId)}` : channelLabel(m.channelId)}</strong>
									<time dateTime={new Date(m.createdAt).toISOString()}>{pastText(m.createdAt)}</time>
								</span>
								<span className='dm-row-last ellipsis'>{excerpt(m.body, lookup, 140) || files(m.attachments.length) || 'Message'}</span>
							</span>
						</button>
					</li>
				))}
			</ul>
			{error && <p className='notice notice-error drafts-notice'>{error}</p>}
			{next !== null && (
				<div className='drafts-more'>
					<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => void load(next)}>
						Afficher plus
					</button>
				</div>
			)}
		</>
	);
}
