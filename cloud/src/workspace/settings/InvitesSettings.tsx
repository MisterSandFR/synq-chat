import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { INVITE_LABEL_MAX, type Invite, type InviteInput } from '../../../shared/invites';
import { DEFAULT_GRADE, P, has } from '../../../shared/permissions';
import type { Channel, WorkspaceDetail } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Dialog, Icon } from '../../ui';
import './invites.css';
import { confirmDialog } from '../../dialogs';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const EXPIRY_OPTIONS: [string, string][] = [
	[String(30 * MINUTE), '30 minutes'],
	[String(HOUR), '1 heure'],
	[String(6 * HOUR), '6 heures'],
	[String(12 * HOUR), '12 heures'],
	[String(DAY), '1 jour'],
	[String(7 * DAY), '7 jours'],
	['', 'Jamais'],
];

const USES_OPTIONS: [string, string][] = [['', 'Illimité'], ['1', '1 utilisation'], ...[5, 10, 25, 50, 100].map((n): [string, string] => [String(n), `${n} utilisations`])];

const inviteLink = (code: string) => `${location.origin}/invite/${code}`;

function remaining(invite: Invite, now: number): string {
	if (invite.state === 'revoked') {
		return 'Révoqué';
	}
	if (invite.state === 'expired') {
		return 'Expiré';
	}
	if (invite.state === 'exhausted') {
		return 'Épuisé';
	}
	if (invite.expiresAt === null) {
		return 'Sans expiration';
	}
	const left = invite.expiresAt - now;
	if (left < HOUR) {
		return `Expire dans ${Math.max(1, Math.ceil(left / MINUTE))} min`;
	}
	return left < DAY ? `Expire dans ${Math.ceil(left / HOUR)} h` : `Expire dans ${Math.ceil(left / DAY)} j`;
}

type Props = { info: WorkspaceDetail; channels: Channel[]; myId: string };

export function InvitesTab({ info, channels, myId }: Props) {
	const [invites, setInvites] = useState<Invite[] | null>(null);
	const [filter, setFilter] = useState<'active' | 'ended'>('active');
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [copied, setCopied] = useState<string | null>(null);
	const load = useCallback(
		() =>
			api<Invite[]>('GET', `/w/${info.id}/invites`)
				.then(setInvites)
				.catch((err) => setError(errorText(err))),
		[info.id],
	);
	useEffect(() => void load(), [load]);

	const now = Date.now();
	const active = (invites ?? []).filter((i) => i.state === 'valid');
	const ended = (invites ?? []).filter((i) => i.state !== 'valid');
	const shown = filter === 'active' ? active : ended;
	const canRevokeAll = has(info.perms, P.MANAGE_WORKSPACE);
	const copy = (code: string) => void navigator.clipboard.writeText(inviteLink(code)).then(() => setCopied(code));
	const revoke = async (invite: Invite) => {
		if (!(await confirmDialog({ title: `Révoquer le lien ${invite.code} ?`, message: 'Il ne pourra plus servir.', confirmLabel: 'Révoquer', danger: true }))) {
			return;
		}
		setError(null);
		try {
			await api('DELETE', `/w/${info.id}/invites/${invite.code}`);
			await load();
		} catch (err) {
			setError(errorText(err));
		}
	};

	return (
		<div className='stack'>
			<div className='invites-head'>
				<p className='muted grow'>Chaque lien peut expirer, limiter ses utilisations, ouvrir un salon et attribuer des grades à l’arrivée.</p>
				{has(info.perms, P.CREATE_INVITES) && (
					<button type='button' className='btn btn-primary' onClick={() => setCreating(true)}>
						<Icon name='user-plus' size={16} /> Inviter des personnes
					</button>
				)}
			</div>
			<div className='segmented invites-filter' role='tablist' aria-label='Filtrer les invitations'>
				<button type='button' role='tab' aria-selected={filter === 'active'} onClick={() => setFilter('active')}>
					Actives <span className='invites-count'>{active.length}</span>
				</button>
				<button type='button' role='tab' aria-selected={filter === 'ended'} onClick={() => setFilter('ended')}>
					Expirées <span className='invites-count'>{ended.length}</span>
				</button>
			</div>
			{error && <p className='notice notice-error'>{error}</p>}
			{invites === null ? (
				!error && <div className='spinner' aria-busy />
			) : shown.length === 0 ? (
				<p className='muted'>{filter === 'active' ? 'Aucun lien actif.' : 'Aucun lien expiré, épuisé ou révoqué.'}</p>
			) : (
				<ul className='list invites-list'>
					{shown.map((invite) => {
						const channel = invite.channelId ? channels.find((c) => c.id === invite.channelId) : null;
						const grades = invite.gradeIds.flatMap((id) => info.grades.filter((g) => g.id === id));
						return (
							<li key={invite.code} className='invite-row'>
								<div className='invite-main'>
									<div className='invite-title'>
										<code className='invite-code'>{invite.code}</code>
										{invite.label && <span className='ellipsis'>{invite.label}</span>}
									</div>
									<div className='invite-meta muted'>
										<span>Par {invite.creatorName || 'un ancien membre'}</span>
										<span>
											{invite.uses} / {invite.maxUses ?? '∞'} utilisations
										</span>
										<span>{remaining(invite, now)}</span>
										{channel && (
											<span>
												<Icon name='hash' size={13} />
												{channel.name}
											</span>
										)}
										{invite.temporary && <span className='grade-chip'>Temporaire</span>}
										{grades.map((grade) => (
											<span key={grade.id} className='grade-chip' style={{ borderColor: grade.color || undefined }}>
												<span className='grade-dot' style={{ background: grade.color || 'var(--line-strong)' }} aria-hidden />
												{grade.name}
											</span>
										))}
									</div>
								</div>
								{invite.state === 'valid' && (
									<div className='invite-actions'>
										<button type='button' className='icon-btn icon-btn-sm' onClick={() => copy(invite.code)} aria-label={`Copier le lien ${invite.code}`} title='Copier le lien'>
											<Icon name={copied === invite.code ? 'check' : 'copy'} size={16} />
										</button>
										{(invite.createdBy === myId || canRevokeAll) && (
											<button type='button' className='icon-btn icon-btn-sm' onClick={() => void revoke(invite)} aria-label={`Révoquer le lien ${invite.code}`} title='Révoquer'>
												<Icon name='trash' size={16} />
											</button>
										)}
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
			<CreateInviteDialog open={creating} onClose={() => setCreating(false)} info={info} channels={channels} onCreated={load} />
		</div>
	);
}

function CreateInviteDialog({ open, onClose, info, channels, onCreated }: { open: boolean; onClose: () => void; info: WorkspaceDetail; channels: Channel[]; onCreated: () => Promise<unknown> }) {
	const [expiresIn, setExpiresIn] = useState(String(7 * DAY));
	const [maxUses, setMaxUses] = useState('');
	const [channelId, setChannelId] = useState('');
	const [gradeIds, setGradeIds] = useState<string[]>([]);
	const [temporary, setTemporary] = useState(false);
	const [label, setLabel] = useState('');
	const [created, setCreated] = useState<Invite | null>(null);
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const textChannels = channels.filter((c) => c.kind === 'text');
	// Même règle que le serveur : gérer les grades, et seulement ceux sous le sien.
	const assignable = info.owner || has(info.perms, P.MANAGE_GRADES) ? info.grades.filter((g) => g.id !== DEFAULT_GRADE && (info.owner || g.position < info.top)) : [];

	const close = () => {
		onClose();
		setCreated(null);
		setCopied(false);
		setError(null);
	};
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const body: InviteInput = {
				expiresIn: expiresIn ? Number(expiresIn) : null,
				maxUses: maxUses ? Number(maxUses) : null,
				channelId: channelId || null,
				gradeIds,
				temporary: temporary && Boolean(expiresIn),
				label,
			};
			setCreated(await api<Invite>('POST', `/w/${info.id}/invites`, body));
			setCopied(false);
			await onCreated();
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onClose={close} title='Inviter des personnes'>
			{created ? (
				<div className='stack'>
					<p className='muted'>
						Partage ce lien pour inviter des personnes dans {info.name}.
						{created.temporary && ' Les membres arrivés par ce lien seront retirés à son expiration.'}
					</p>
					<div className='inline-form'>
						<input readOnly value={inviteLink(created.code)} aria-label='Lien d’invitation' onFocus={(e) => e.target.select()} />
						<button type='button' className='btn btn-primary' onClick={() => void navigator.clipboard.writeText(inviteLink(created.code)).then(() => setCopied(true))}>
							{copied ? 'Copié' : 'Copier'}
						</button>
					</div>
					<div className='invite-form-actions'>
						<button type='button' className='btn' onClick={() => setCreated(null)}>
							Créer un autre lien
						</button>
						<button type='button' className='btn' onClick={close}>
							Terminé
						</button>
					</div>
				</div>
			) : (
				<form className='stack' onSubmit={submit}>
					<div className='invite-form-row'>
						<label className='field'>
							Expire après
							<select value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)}>
								{EXPIRY_OPTIONS.map(([value, text]) => (
									<option key={value} value={value}>
										{text}
									</option>
								))}
							</select>
						</label>
						<label className='field'>
							Nombre max d’utilisations
							<select value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
								{USES_OPTIONS.map(([value, text]) => (
									<option key={value} value={value}>
										{text}
									</option>
								))}
							</select>
						</label>
					</div>
					<label className='field'>
						Salon d’arrivée
						<select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
							<option value=''>Salon par défaut</option>
							{textChannels.map((c) => (
								<option key={c.id} value={c.id}>
									#{c.name}
								</option>
							))}
						</select>
					</label>
					{assignable.length > 0 && (
						<fieldset className='invite-grades'>
							<legend>Grades attribués à l’arrivée</legend>
							<div className='invite-grade-list'>
								{assignable.map((grade) => (
									<label key={grade.id} className='invite-grade'>
										<input
											type='checkbox'
											checked={gradeIds.includes(grade.id)}
											onChange={(e) => setGradeIds(e.target.checked ? [...gradeIds, grade.id] : gradeIds.filter((id) => id !== grade.id))}
										/>
										<span className='grade-dot' style={{ background: grade.color || 'var(--line-strong)' }} aria-hidden />
										{grade.name}
									</label>
								))}
							</div>
						</fieldset>
					)}
					<label className='check invite-temporary'>
						<input type='checkbox' checked={temporary && Boolean(expiresIn)} disabled={!expiresIn} onChange={(e) => setTemporary(e.target.checked)} />
						<span>
							Adhésion temporaire
							<span className='muted'>{expiresIn ? ' : le membre est retiré à l’expiration du lien' : ' : choisis une durée d’expiration'}</span>
						</span>
					</label>
					<label className='field'>
						Note interne
						<input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={INVITE_LABEL_MAX} placeholder='Ex. : recrutement de l’automne' />
					</label>
					{error && <p className='notice notice-error'>{error}</p>}
					<div className='invite-form-actions'>
						<button type='button' className='btn' onClick={close}>
							Annuler
						</button>
						<button type='submit' className='btn btn-primary' disabled={busy}>
							Créer le lien
						</button>
					</div>
				</form>
			)}
		</Dialog>
	);
}
