import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { MailboxInfo, MailboxInput, MailShare, MailShareGrade, MailShareSpaces, MailTestResult } from '../../shared/mail';
import type { Channel, WorkspaceDetail, WorkspaceSummary } from '../../shared/types';
import { api, errorText } from '../api';
import { Dialog, Icon } from '../ui';
import { ShareGrades, reachOf, reachText } from './ShareGrades';
import { confirmDialog } from '../dialogs';

export function BoxDialog({ box, workspaces, onClose, onSaved }: { box: MailboxInfo | null; workspaces: WorkspaceSummary[]; onClose: () => void; onSaved: () => Promise<void> }) {
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
		signature: box?.signature ?? '',
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

	const remove = async () => {
		if (box && (await confirmDialog({ title: `Supprimer la boîte « ${box.name} » ?`, message: 'Ses conversations seront retirées de Synq.', confirmLabel: 'Supprimer', danger: true }))) {
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
				<label className='field'>
					<span>Signature</span>
					<textarea className='mail-textarea' value={form.signature ?? ''} onChange={(e) => set('signature', e.target.value)} maxLength={2000} rows={3} placeholder='Ajoutée sous chaque message envoyé depuis cette boîte' />
				</label>
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

const channelText = (n: number) => (n ? `${n} salon${n > 1 ? 's' : ''}` : 'tout l’espace');

function ShareEditor({ box, workspaces, onChanged }: { box: MailboxInfo; workspaces: WorkspaceSummary[]; onChanged: () => Promise<void> }) {
	const [shares, setShares] = useState<MailShare[]>(box.shares);
	const [workspaceId, setWorkspaceId] = useState('');
	const [channels, setChannels] = useState<Channel[]>([]);
	const [picked, setPicked] = useState<string[]>([]);
	const [draft, setDraft] = useState<MailShareGrade[]>([]);
	const [infos, setInfos] = useState<Record<string, WorkspaceDetail | null>>({});
	const [error, setError] = useState<string | null>(null);
	const requested = useRef(new Set<string>());
	const [spaces, setSpaces] = useState<string[] | null>(null);
	const canManage = box.access.owner || box.access.manage;
	const existing = shares.find((share) => share.workspaceId === workspaceId);
	const offered = workspaces.filter((workspace) => spaces?.includes(workspace.id) && !shares.some((item) => item.workspaceId === workspace.id));

	useEffect(() => {
		if (box.access.owner) {
			void api<MailShareSpaces>('GET', '/mail/share-spaces')
				.then((result) => setSpaces(result.workspaceIds))
				.catch(() => setSpaces([]));
		}
	}, [box.access.owner]);

	// Grades et membres de chaque espace concerné, chargés une fois.
	const wanted = [...new Set([...shares.map((share) => share.workspaceId), workspaceId])].filter(Boolean).join(',');
	useEffect(() => {
		for (const id of wanted ? wanted.split(',') : []) {
			if (requested.current.has(id)) {
				continue;
			}
			requested.current.add(id);
			void api<WorkspaceDetail>('GET', `/w/${id}/info`)
				.catch(() => null)
				.then((info) => setInfos((current) => ({ ...current, [id]: info })));
		}
	}, [wanted]);

	useEffect(() => {
		setPicked(existing?.channelIds ?? []);
		setDraft([]);
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
	}, [workspaceId]);

	const attempt = async (task: () => Promise<void>, rollback?: () => void) => {
		setError(null);
		try {
			await task();
		} catch (e) {
			rollback?.();
			setError(errorText(e));
		}
	};

	const share = () =>
		attempt(async () => {
			// Partage existant : salons seuls, les grades se règlent ligne par ligne.
			const updated = await api<MailboxInfo>('PUT', `/mail/boxes/${box.id}/shares/${workspaceId}`, existing ? { channelIds: picked } : { channelIds: picked, grades: draft });
			setShares(updated.shares);
			setWorkspaceId('');
			await onChanged();
		});

	const saveRules = (wid: string, rules: MailShareGrade[]) => {
		const before = shares;
		setShares((current) => current.map((item) => (item.workspaceId === wid ? { ...item, grades: rules } : item)));
		void attempt(
			async () => {
				const updated = await api<MailboxInfo>('PUT', `/mail/boxes/${box.id}/shares/${wid}/grades`, { grades: rules });
				setShares(updated.shares);
				await onChanged();
			},
			() => setShares(before),
		);
	};

	const unshare = (wid: string) =>
		attempt(async () => {
			await api('DELETE', `/mail/boxes/${box.id}/shares/${wid}`);
			setShares((current) => current.filter((item) => item.workspaceId !== wid));
			if (workspaceId === wid) {
				setWorkspaceId('');
			}
			await onChanged();
		});

	const toggle = (id: string) => setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
	const draftInfo = workspaceId && !existing ? infos[workspaceId] : undefined;

	return (
		<section className='mail-share'>
			<h3>Partage</h3>
			<p className='field-hint'>Sans partage, la boîte reste personnelle. Dans un espace, chaque grade reçoit un niveau : lecture, réponse ou gestion. Le propriétaire et les administrateurs de l’espace ont toujours la gestion.</p>
			{shares.map((item) => {
				const info = infos[item.workspaceId];
				return (
					<div key={item.workspaceId} className='mail-share-card'>
						<div className='mail-share-item'>
							<Icon name='users' size={16} />
							<span>
								{item.workspaceName}{' '}
								<small>
									{reachText(item.reach)} · {channelText(item.channelIds.length)}
								</small>
							</span>
							{canManage && (
								<>
									<button type='button' className='btn btn-ghost' onClick={() => setWorkspaceId(item.workspaceId)}>
										Salons
									</button>
									<button type='button' className='btn btn-ghost' onClick={() => void unshare(item.workspaceId)}>
										Retirer
									</button>
								</>
							)}
						</div>
						<ShareGrades grades={info?.grades ?? []} members={info?.members ?? []} rules={item.grades} disabled={!canManage || !info} onChange={(rules) => saveRules(item.workspaceId, rules)} />
					</div>
				);
			})}
			{box.access.owner &&
				spaces &&
				(offered.length > 0 ? (
					<select className='mail-select' value={existing ? '' : workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} aria-label='Espace de partage'>
						<option value=''>Partager dans un espace…</option>
						{offered.map((workspace) => (
							<option key={workspace.id} value={workspace.id}>
								{workspace.name}
							</option>
						))}
					</select>
				) : (
					<p className='field-hint'>
						{shares.length ? 'Aucun autre espace ne vous autorise à partager une boîte.' : 'Aucun espace ne vous autorise à partager une boîte.'} Un administrateur de l’espace peut vous l’ouvrir dans les réglages, section Boîtes mail.
					</p>
				))}
			{workspaceId && (
				<div className='mail-share-draft'>
					{existing && <p className='mail-share-draft-title'>Salons de {existing.workspaceName}</p>}
					{channels.length > 0 && (
						<div className='mail-channels'>
							{channels.map((channel) => (
								<label key={channel.id}>
									<input type='checkbox' checked={picked.includes(channel.id)} onChange={() => toggle(channel.id)} />#{channel.name}
								</label>
							))}
						</div>
					)}
					{!existing && (
						<>
							<ShareGrades grades={draftInfo?.grades ?? []} members={draftInfo?.members ?? []} rules={draft} disabled={!draftInfo} onChange={setDraft} />
							{draftInfo && <p className='field-hint'>{reachText(reachOf(draftInfo.members, draft, box.ownerId))}</p>}
						</>
					)}
					<div className='mail-form-actions'>
						<button type='button' className='btn' onClick={() => setWorkspaceId('')}>
							Annuler
						</button>
						<button type='button' className='btn btn-primary' onClick={() => void share()}>
							{existing ? 'Mettre à jour' : 'Partager'}
						</button>
					</div>
				</div>
			)}
			{error && <p className='notice notice-error'>{error}</p>}
		</section>
	);
}
