import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import type { MailThread } from '../../shared/mail';
import type { Channel, WorkspaceSummary } from '../../shared/types';
import { api, errorText } from '../api';
import { Dialog, Icon, useDismiss, type IconName } from '../ui';
import { longDate, snoozeChoices } from './format';

export type ThreadPatch = { status?: 'open' | 'done'; assigneeId?: string | null; pinned?: boolean; snoozedUntil?: number | null };

type Member = { id: string; name: string };

type Props = {
	thread: MailThread;
	canReply: boolean;
	busy: boolean;
	aiOpen: boolean;
	meId: string;
	members: Member[];
	workspaces: WorkspaceSummary[];
	onBack: () => void;
	onPatch: (patch: ThreadPatch) => void;
	onDelete: () => void;
	onAi: () => void;
	onReply: (all: boolean) => void;
	onForward: () => void;
	onNote: () => void;
};

function Pop({ icon, label, text, children, align = 'left' }: { icon: IconName; label: string; text?: string; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	return (
		<div className='mail-pop-anchor' ref={ref}>
			<button className={text ? 'btn btn-ghost mail-tool-text' : 'icon-btn'} onClick={() => setOpen(!open)} title={label} aria-label={label} aria-expanded={open}>
				<Icon name={icon} size={17} />
				{text && <span>{text}</span>}
			</button>
			{open && <div className={`popover mail-pop${align === 'right' ? ' mail-pop-right' : ''}`}>{children(() => setOpen(false))}</div>}
		</div>
	);
}

export function ThreadToolbar({ thread, canReply, busy, aiOpen, meId, members, workspaces, onBack, onPatch, onDelete, onAi, onReply, onForward, onNote }: Props) {
	const [copied, setCopied] = useState(false);
	const [sharing, setSharing] = useState(false);
	const [date, setDate] = useState('');
	const snoozed = Boolean(thread.snoozedUntil && thread.snoozedUntil > Date.now());

	const copyLink = async () => {
		await navigator.clipboard.writeText(`${location.origin}/mail?thread=${thread.id}`).catch(() => undefined);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	const assignee = thread.assigneeId ? (members.find((member) => member.id === thread.assigneeId)?.name ?? thread.assigneeName ?? 'Membre') : null;

	return (
		<div className='mail-toolbar'>
			<button className='icon-btn mail-back' onClick={onBack} title='Retour' aria-label='Retour'>
				<Icon name='chevron-left' />
			</button>
			{canReply && (
				<>
					<button className='btn btn-ghost mail-tool-text' disabled={busy} onClick={() => onPatch({ status: thread.status === 'open' ? 'done' : 'open' })} title='Terminé (e)'>
						<Icon name='check' size={17} />
						<span>{thread.status === 'open' ? 'Terminé' : 'Rouvrir'}</span>
					</button>
					<button className='icon-btn' disabled={busy} onClick={onDelete} title='Supprimer (#)' aria-label='Supprimer'>
						<Icon name='trash' size={17} />
					</button>
					<button className='icon-btn' disabled={busy} aria-pressed={Boolean(thread.pinned)} onClick={() => onPatch({ pinned: !thread.pinned })} title={thread.pinned ? 'Désépingler' : 'Épingler'} aria-label='Épingler'>
						<Icon name='pin' size={17} />
					</button>
					<Pop icon='clock' label={snoozed ? `Rappel : ${longDate(thread.snoozedUntil!)}` : 'Me le rappeler'}>
						{(close) => (
							<>
								<div className='menu-label'>Me le rappeler</div>
								{snoozeChoices().map((choice) => (
									<button key={choice.key} className='menu-item' onClick={() => (close(), onPatch({ snoozedUntil: choice.at }))}>
										<span className='mail-pop-grow'>{choice.label}</span>
										<small className='muted'>{longDate(choice.at)}</small>
									</button>
								))}
								<form
									className='mail-pop-date'
									onSubmit={(e: FormEvent) => {
										e.preventDefault();
										const at = new Date(date).getTime();
										if (at > Date.now()) {
											close();
											onPatch({ snoozedUntil: at });
										}
									}}
								>
									<input type='datetime-local' value={date} onChange={(e) => setDate(e.target.value)} aria-label='Date du rappel' />
									<button className='btn' disabled={!date}>
										Valider
									</button>
								</form>
								{snoozed && (
									<>
										<div className='menu-sep' />
										<button className='menu-item' onClick={() => (close(), onPatch({ snoozedUntil: null }))}>
											Annuler le rappel
										</button>
									</>
								)}
							</>
						)}
					</Pop>
				</>
			)}
			<button className='icon-btn' onClick={() => void copyLink()} title={copied ? 'Lien copié' : 'Copier le lien'} aria-label='Copier le lien'>
				<Icon name={copied ? 'check' : 'link'} size={17} />
			</button>
			<button className='icon-btn' aria-pressed={aiOpen} onClick={onAi} title='Demander à l’IA' aria-label='Demander à l’IA'>
				<Icon name='sparkle' size={17} />
			</button>
			{canReply && (
				<Pop icon='more' label='Plus'>
					{(close) => (
						<>
							<button className='menu-item' onClick={() => (close(), onReply(false))}>
								<Icon name='reply' size={16} />
								Répondre <kbd className='mail-kbd'>r</kbd>
							</button>
							<button className='menu-item' onClick={() => (close(), onReply(true))}>
								<Icon name='reply-all' size={16} />
								Répondre à tous
							</button>
							<button className='menu-item' onClick={() => (close(), onForward())}>
								<Icon name='forward' size={16} />
								Transférer <kbd className='mail-kbd'>f</kbd>
							</button>
							<button className='menu-item' onClick={() => (close(), onNote())}>
								<Icon name='pencil' size={16} />
								Ajouter une note interne
							</button>
						</>
					)}
				</Pop>
			)}
			<span className='mail-toolbar-spacer' />
			{canReply && (
				<Pop icon='user' label='Attribuer' text={assignee ?? 'Attribuer'} align='right'>
					{(close) => (
						<div className='mail-pop-list'>
							<button className='menu-item' aria-selected={!thread.assigneeId} onClick={() => (close(), onPatch({ assigneeId: null }))}>
								Non assigné
							</button>
							{members.map((member) => (
								<button key={member.id} className='menu-item' aria-selected={thread.assigneeId === member.id} onClick={() => (close(), onPatch({ assigneeId: member.id }))}>
									{member.id === meId ? `${member.name} (moi)` : member.name}
								</button>
							))}
						</div>
					)}
				</Pop>
			)}
			<button className='btn btn-ghost mail-tool-text' onClick={() => setSharing(true)} title='Partager dans un salon'>
				<Icon name='share' size={17} />
				<span>Partager</span>
			</button>
			{sharing && <ShareDialog thread={thread} workspaces={workspaces} onClose={() => setSharing(false)} />}
		</div>
	);
}

function ShareDialog({ thread, workspaces, onClose }: { thread: MailThread; workspaces: WorkspaceSummary[]; onClose: () => void }) {
	const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
	const [channels, setChannels] = useState<Channel[] | null>(null);
	const [channelId, setChannelId] = useState('');
	const [comment, setComment] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setChannels(null);
		setChannelId('');
		if (!workspaceId) {
			return;
		}
		let cancelled = false;
		void api<Channel[]>('GET', `/w/${workspaceId}/channels`)
			.then((list) => {
				if (!cancelled) {
					const rooms = list.filter((channel) => channel.kind !== 'voice');
					setChannels(rooms);
					setChannelId(rooms[0]?.id ?? '');
				}
			})
			.catch(() => !cancelled && setChannels([]));
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await api('POST', `/mail/threads/${thread.id}/share`, { workspaceId, channelId, comment: comment.trim() || undefined });
			onClose();
		} catch (e) {
			setError(errorText(e));
			setBusy(false);
		}
	};

	return (
		<Dialog open onClose={onClose} title='Partager dans un salon'>
			<form className='mail-form' onSubmit={(e) => void submit(e)}>
				<p className='field-hint'>Le salon reçoit une carte avec le sujet, l’expéditeur et un extrait. Seuls ceux qui ont accès à la boîte peuvent ouvrir le fil.</p>
				<div className='mail-form-row'>
					<label className='field'>
						<span>Espace</span>
						<select className='mail-select' value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
							{workspaces.map((workspace) => (
								<option key={workspace.id} value={workspace.id}>
									{workspace.name}
								</option>
							))}
						</select>
					</label>
					<label className='field'>
						<span>Salon</span>
						<select className='mail-select' value={channelId} onChange={(e) => setChannelId(e.target.value)} disabled={!channels?.length}>
							{channels === null ? <option>Chargement…</option> : channels.length === 0 ? <option value=''>Aucun salon</option> : null}
							{channels?.map((channel) => (
								<option key={channel.id} value={channel.id}>
									#{channel.name}
								</option>
							))}
						</select>
					</label>
				</div>
				<label className='field'>
					<span>Commentaire</span>
					<textarea className='mail-textarea' value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder='Facultatif' />
				</label>
				{error && <p className='notice notice-error'>{error}</p>}
				<div className='mail-form-actions'>
					<button type='button' className='btn' onClick={onClose}>
						Annuler
					</button>
					<button className='btn btn-primary' disabled={busy || !channelId}>
						Partager
					</button>
				</div>
			</form>
		</Dialog>
	);
}
