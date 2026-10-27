import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

import type { MailboxInfo, MailboxInput, MailStatus, MailTestResult, MailThread, MailThreadDetail } from '../../shared/mail';
import type { Channel, Me, WorkspaceDetail, WorkspaceSummary } from '../../shared/types';
import { api, errorText } from '../api';
import { Avatar, Dialog, Icon, fileIcon, formatSize } from '../ui';
import './mail.css';

type Filter = { workspaceId: string; boxId: string; status: MailStatus; mine: boolean };

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const formatDate = (value: number) => dateFormat.format(new Date(value));

export function MailView({ me, workspaces }: { me: Me; workspaces: WorkspaceSummary[] }) {
	const [boxes, setBoxes] = useState<MailboxInfo[] | null>(null);
	const [filter, setFilter] = useState<Filter>({ workspaceId: '', boxId: '', status: 'open', mine: false });
	const [threads, setThreads] = useState<MailThread[] | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [editing, setEditing] = useState<MailboxInfo | 'new' | null>(null);
	const [error, setError] = useState<string | null>(null);

	const loadBoxes = useCallback(async () => {
		try {
			setBoxes(await api<MailboxInfo[]>('GET', '/mail/boxes'));
		} catch (e) {
			setError(errorText(e));
		}
	}, []);

	const loadThreads = useCallback(async () => {
		const query = new URLSearchParams({ status: filter.status });
		if (filter.boxId) {
			query.set('box', filter.boxId);
		}
		if (filter.workspaceId) {
			query.set('workspace', filter.workspaceId);
		}
		if (filter.mine) {
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

	const boxById = useMemo(() => new Map((boxes ?? []).map((box) => [box.id, box])), [boxes]);
	const visible = (boxes ?? []).filter((box) => !filter.workspaceId || box.shares.some((share) => share.workspaceId === filter.workspaceId));
	const update = (patch: Partial<Filter>) => setFilter((current) => ({ ...current, ...patch }));

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
			<section className='mail-list'>
				<div className='mail-list-head'>
					<div className='segmented'>
						<button aria-selected={filter.status === 'open'} onClick={() => update({ status: 'open' })}>
							Ouverts
						</button>
						<button aria-selected={filter.status === 'done'} onClick={() => update({ status: 'done' })}>
							Traités
						</button>
					</div>
					<button className='btn btn-ghost' aria-pressed={filter.mine} onClick={() => update({ mine: !filter.mine })}>
						{filter.mine ? 'Tous' : 'Assignés à moi'}
					</button>
				</div>
				{error && <p className='notice notice-error'>{error}</p>}
				{threads === null ? (
					<div className='spinner' aria-busy />
				) : threads.length === 0 ? (
					<p className='mail-empty'>{boxes?.length ? 'Aucune conversation.' : 'Aucune boîte. Ajoute une boîte Mailcow pour commencer.'}</p>
				) : (
					threads.map((thread) => (
						<button key={thread.id} className='mail-thread' aria-selected={selected === thread.id} onClick={() => setSelected(thread.id)}>
							<div className='mail-thread-top'>
								<strong>{thread.from || 'Expéditeur inconnu'}</strong>
								<time>{formatDate(thread.lastAt)}</time>
							</div>
							<div className='mail-thread-subject'>{thread.subject || '(sans objet)'}</div>
							<div className='mail-thread-snippet'>{thread.snippet}</div>
							<div className='mail-thread-meta'>
								<span>{boxById.get(thread.mailboxId)?.name}</span>
								{thread.messageCount > 1 && <span>{thread.messageCount} messages</span>}
								{thread.assigneeName && <span className='pill'>{thread.assigneeName}</span>}
							</div>
						</button>
					))
				)}
			</section>
			<section className='mail-reader'>
				{selected ? (
					<ThreadReader key={selected} id={selected} me={me} boxes={boxes ?? []} onBack={() => setSelected(null)} onChanged={loadThreads} />
				) : (
					<p className='mail-empty'>Sélectionne une conversation.</p>
				)}
			</section>
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

function ThreadReader({ id, me, boxes, onBack, onChanged }: { id: string; me: Me; boxes: MailboxInfo[]; onBack: () => void; onChanged: () => Promise<void> }) {
	const [detail, setDetail] = useState<MailThreadDetail | null>(null);
	const [members, setMembers] = useState<Array<{ id: string; name: string }>>([]);
	const [mode, setMode] = useState<'reply' | 'note'>('reply');
	const [draft, setDraft] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			setDetail(await api<MailThreadDetail>('GET', `/mail/threads/${id}`));
		} catch (e) {
			setError(errorText(e));
		}
	}, [id]);

	useEffect(() => {
		void load();
	}, [load]);

	const box = detail ? boxes.find((b) => b.id === detail.thread.mailboxId) : undefined;
	const shareKey = box?.shares.map((share) => share.workspaceId).join(',') ?? '';

	// Assignables : membres des espaces de partage ; le serveur revérifie l'accès.
	useEffect(() => {
		let cancelled = false;
		const ids = shareKey ? shareKey.split(',') : [];
		void Promise.all(ids.map((wid) => api<WorkspaceDetail>('GET', `/w/${wid}/info`).catch(() => null))).then((infos) => {
			if (cancelled) {
				return;
			}
			const names = new Map<string, string>([[me.user.id, me.user.name]]);
			for (const info of infos) {
				for (const member of info?.members ?? []) {
					names.set(member.id, member.name);
				}
			}
			setMembers([...names].map(([memberId, name]) => ({ id: memberId, name })).sort((a, b) => a.name.localeCompare(b.name)));
		});
		return () => {
			cancelled = true;
		};
	}, [shareKey, me.user.id, me.user.name]);

	const run = async (task: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await task();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	const patch = (body: { status?: MailStatus; assigneeId?: string | null }) =>
		run(async () => {
			await api('PATCH', `/mail/threads/${id}`, body);
			await load();
			await onChanged();
		});

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!draft.trim()) {
			return;
		}
		void run(async () => {
			await api('POST', `/mail/threads/${id}/${mode === 'reply' ? 'reply' : 'notes'}`, { body: draft });
			setDraft('');
			await load();
			await onChanged();
		});
	};

	if (!detail) {
		return error ? <p className='notice notice-error'>{error}</p> : <div className='spinner' aria-busy />;
	}
	const { thread, messages, notes, access } = detail;
	return (
		<div className='mail-read'>
			<header className='mail-read-head'>
				<button className='icon-btn mail-back' onClick={onBack} title='Retour' aria-label='Retour'>
					<Icon name='chevron-left' />
				</button>
				<div className='mail-read-title'>
					<h2>{thread.subject || '(sans objet)'}</h2>
					<span>{box ? `${box.name} · ${box.address}` : ''}</span>
				</div>
				{access.reply && (
					<>
						<select className='mail-select' value={thread.assigneeId ?? ''} disabled={busy} onChange={(e) => void patch({ assigneeId: e.target.value || null })} aria-label='Assigner'>
							<option value=''>Non assigné</option>
							{members.map((member) => (
								<option key={member.id} value={member.id}>
									{member.id === me.user.id ? `${member.name} (moi)` : member.name}
								</option>
							))}
							{thread.assigneeId && !members.some((member) => member.id === thread.assigneeId) && <option value={thread.assigneeId}>{thread.assigneeName ?? 'Membre'}</option>}
						</select>
						<button className='btn' disabled={busy} onClick={() => void patch({ status: thread.status === 'open' ? 'done' : 'open' })}>
							<Icon name='check' size={16} />
							{thread.status === 'open' ? 'Marquer traité' : 'Rouvrir'}
						</button>
					</>
				)}
			</header>
			{error && <p className='notice notice-error'>{error}</p>}
			<div className='mail-read-body'>
				{messages.map((message) => (
					<article key={message.id} className={`mail-msg mail-msg-${message.direction}`}>
						<header>
							<Avatar name={message.fromName || message.fromAddr} size={32} />
							<div>
								<strong>{message.fromName || message.fromAddr}</strong>
								<span>
									{message.fromName ? `${message.fromAddr} · ` : ''}à {message.to}
								</span>
							</div>
							<time>{formatDate(message.date)}</time>
						</header>
						<div className='mail-msg-text'>{message.body}</div>
						{message.attachments.length > 0 && (
							<div className='mail-attachments'>
								{message.attachments.map((attachment) => (
									<a key={attachment.index} className='mail-attachment' href={`/api/mail/messages/${message.id}/attachments/${attachment.index}`} download={attachment.name}>
										<Icon name={fileIcon(attachment.type)} size={16} />
										<span>{attachment.name}</span>
										<small>{formatSize(attachment.size)}</small>
									</a>
								))}
							</div>
						)}
					</article>
				))}
				{notes.length > 0 && (
					<section className='mail-notes'>
						<h3>Notes internes</h3>
						{notes.map((note) => (
							<div key={note.id} className='mail-note'>
								<header>
									<strong>{note.authorName}</strong>
									<time>{formatDate(note.createdAt)}</time>
								</header>
								<p>{note.body}</p>
							</div>
						))}
					</section>
				)}
			</div>
			{access.reply && (
				<form className='mail-compose' onSubmit={submit}>
					<div className='segmented'>
						<button type='button' aria-selected={mode === 'reply'} onClick={() => setMode('reply')}>
							Répondre
						</button>
						<button type='button' aria-selected={mode === 'note'} onClick={() => setMode('note')}>
							Note interne
						</button>
					</div>
					<textarea
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						placeholder={mode === 'reply' ? 'Ta réponse, envoyée depuis la boîte' : 'Visible uniquement par l’équipe'}
						maxLength={mode === 'reply' ? 20_000 : 2000}
					/>
					<div className='mail-compose-bar'>
						<span className='field-hint'>{mode === 'reply' ? 'Réponse dans le fil (In-Reply-To).' : 'Jamais envoyée au client.'}</span>
						<button className='btn btn-primary' disabled={busy || !draft.trim()}>
							<Icon name={mode === 'reply' ? 'send' : 'pencil'} size={16} />
							{mode === 'reply' ? 'Envoyer' : 'Ajouter la note'}
						</button>
					</div>
				</form>
			)}
		</div>
	);
}

function BoxDialog({ box, workspaces, onClose, onSaved }: { box: MailboxInfo | null; workspaces: WorkspaceSummary[]; onClose: () => void; onSaved: () => Promise<void> }) {
	const owner = !box || box.access.owner;
	const [form, setForm] = useState<MailboxInput>(() => ({
		name: box?.name ?? '',
		address: box?.address ?? '',
		imapHost: box?.config?.imapHost ?? '',
		imapPort: 993,
		smtpHost: box?.config?.smtpHost ?? '',
		smtpPort: box?.config?.smtpPort ?? 465,
		username: box?.config?.username ?? '',
		password: '',
	}));
	const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
	const [busy, setBusy] = useState(false);

	const set = <K extends keyof MailboxInput>(key: K, value: MailboxInput[K]) => setForm((current) => ({ ...current, [key]: value }));
	const payload = () => ({ ...form, password: form.password || undefined, id: box?.id });

	const run = async (task: () => Promise<void>) => {
		setBusy(true);
		setStatus(null);
		try {
			await task();
		} catch (e) {
			setStatus({ tone: 'error', text: errorText(e) });
		} finally {
			setBusy(false);
		}
	};

	const save = (event: FormEvent) => {
		event.preventDefault();
		void run(async () => {
			await api(box ? 'PATCH' : 'POST', box ? `/mail/boxes/${box.id}` : '/mail/boxes', payload());
			await onSaved();
			onClose();
		});
	};

	const test = () =>
		run(async () => {
			const result = await api<MailTestResult>('POST', '/mail/test', payload());
			const failures = [result.imap && `IMAP : ${result.imap}`, result.smtp && `SMTP : ${result.smtp}`].filter(Boolean);
			setStatus(failures.length ? { tone: 'error', text: failures.join(' ; ') } : { tone: 'ok', text: 'Connexion IMAP et SMTP réussie.' });
		});

	const remove = () => {
		if (box && confirm(`Supprimer la boîte « ${box.name} » et ses conversations ?`)) {
			void run(async () => {
				await api('DELETE', `/mail/boxes/${box.id}`);
				await onSaved();
				onClose();
			});
		}
	};

	return (
		<Dialog open onClose={onClose} title={box ? box.name : 'Ajouter une boîte mail'} wide>
			{owner && (
				<form className='mail-form' onSubmit={save}>
					<div className='mail-form-row'>
						<label className='field'>
							<span>Nom</span>
							<input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={64} placeholder='Support' required />
						</label>
						<label className='field'>
							<span>Adresse</span>
							<input type='email' value={form.address} onChange={(e) => set('address', e.target.value)} placeholder='support@exemple.fr' required />
						</label>
					</div>
					<div className='mail-form-row'>
						<label className='field'>
							<span>Serveur IMAP</span>
							<input value={form.imapHost} onChange={(e) => set('imapHost', e.target.value)} placeholder='mail.exemple.fr' required />
						</label>
						<label className='field'>
							<span>Port IMAP</span>
							<select value={993} disabled>
								<option value={993}>993 (TLS)</option>
							</select>
						</label>
					</div>
					<div className='mail-form-row'>
						<label className='field'>
							<span>Serveur SMTP</span>
							<input value={form.smtpHost} onChange={(e) => set('smtpHost', e.target.value)} placeholder='mail.exemple.fr' required />
						</label>
						<label className='field'>
							<span>Port SMTP</span>
							<select value={form.smtpPort} onChange={(e) => set('smtpPort', Number(e.target.value))}>
								<option value={465}>465 (TLS)</option>
								<option value={587}>587 (STARTTLS)</option>
							</select>
						</label>
					</div>
					<div className='mail-form-row'>
						<label className='field'>
							<span>Identifiant</span>
							<input value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete='off' required />
						</label>
						<label className='field'>
							<span>Mot de passe d’application</span>
							<input
								type='password'
								value={form.password ?? ''}
								onChange={(e) => set('password', e.target.value)}
								autoComplete='new-password'
								placeholder={box ? 'Inchangé' : ''}
								required={!box}
							/>
						</label>
					</div>
					<p className='field-hint'>Mot de passe chiffré côté serveur, jamais réaffiché. Relève toutes les minutes.</p>
					{status ? (
						<p className={`notice notice-${status.tone}`}>{status.text}</p>
					) : (
						box?.syncError && <p className='notice notice-error'>Dernière relève : {box.syncError}</p>
					)}
					<div className='mail-form-actions'>
						{box && (
							<button type='button' className='btn btn-danger' disabled={busy} onClick={remove}>
								<Icon name='trash' size={16} />
								Supprimer
							</button>
						)}
						<button type='button' className='btn' disabled={busy} onClick={() => void test()}>
							Tester la connexion
						</button>
						<button className='btn btn-primary' disabled={busy}>
							{box ? 'Enregistrer' : 'Ajouter'}
						</button>
					</div>
				</form>
			)}
			{box && <ShareEditor box={box} workspaces={workspaces} onChanged={onSaved} />}
		</Dialog>
	);
}

function ShareEditor({ box, workspaces, onChanged }: { box: MailboxInfo; workspaces: WorkspaceSummary[]; onChanged: () => Promise<void> }) {
	const [shares, setShares] = useState(box.shares);
	const [workspaceId, setWorkspaceId] = useState('');
	const [channels, setChannels] = useState<Channel[]>([]);
	const [picked, setPicked] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setPicked(shares.find((share) => share.workspaceId === workspaceId)?.channelIds ?? []);
		if (!workspaceId) {
			setChannels([]);
			return;
		}
		let cancelled = false;
		void api<Channel[]>('GET', `/w/${workspaceId}/channels`)
			.then((list) => !cancelled && setChannels(list.filter((channel) => channel.kind !== 'voice')))
			.catch(() => !cancelled && setChannels([]));
		return () => {
			cancelled = true;
		};
	}, [workspaceId, shares]);

	const share = async () => {
		setError(null);
		try {
			const updated = await api<MailboxInfo>('PUT', `/mail/boxes/${box.id}/shares/${workspaceId}`, { channelIds: picked });
			setShares(updated.shares);
			setWorkspaceId('');
			await onChanged();
		} catch (e) {
			setError(errorText(e));
		}
	};

	const unshare = async (wid: string) => {
		setError(null);
		try {
			await api('DELETE', `/mail/boxes/${box.id}/shares/${wid}`);
			setShares((current) => current.filter((item) => item.workspaceId !== wid));
			await onChanged();
		} catch (e) {
			setError(errorText(e));
		}
	};

	const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

	return (
		<section className='mail-share'>
			<h3>Partage</h3>
			<p className='field-hint'>Sans partage, la boîte reste personnelle. Dans un espace, l’accès suit les grades : voir, répondre, gérer.</p>
			{shares.map((item) => (
				<div key={item.workspaceId} className='mail-share-item'>
					<Icon name='users' size={16} />
					<span>
						{item.workspaceName} <small>{item.channelIds.length ? `${item.channelIds.length} salon${item.channelIds.length > 1 ? 's' : ''}` : 'tout l’espace'}</small>
					</span>
					<button className='btn btn-ghost' onClick={() => setWorkspaceId(item.workspaceId)}>
						Salons
					</button>
					<button className='btn btn-ghost' onClick={() => void unshare(item.workspaceId)}>
						Retirer
					</button>
				</div>
			))}
			<select className='mail-select' value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} aria-label='Espace de partage'>
				<option value=''>Choisir un espace…</option>
				{workspaces.map((workspace) => (
					<option key={workspace.id} value={workspace.id}>
						{workspace.name}
					</option>
				))}
			</select>
			{workspaceId && (
				<>
					{channels.length > 0 && (
						<div className='mail-channels'>
							{channels.map((channel) => (
								<label key={channel.id}>
									<input type='checkbox' checked={picked.includes(channel.id)} onChange={() => toggle(channel.id)} />#{channel.name}
								</label>
							))}
						</div>
					)}
					<div className='mail-form-actions'>
						<button className='btn btn-primary' onClick={() => void share()}>
							{shares.some((item) => item.workspaceId === workspaceId) ? 'Mettre à jour' : 'Partager'}
						</button>
					</div>
				</>
			)}
			{error && <p className='notice notice-error'>{error}</p>}
		</section>
	);
}
