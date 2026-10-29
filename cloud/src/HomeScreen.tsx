import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent } from 'react';

import { invitePath, type SpaceSummary } from '../shared/home';
import { AVATAR_TYPES } from '../shared/rc';
import { ACCENTS, type Me, type User, type WorkspaceSummary } from '../shared/types';
import type { Notice } from './App';
import { api, errorText, upload } from './api';
import { Floating } from './floating';
import { lastWorkspace, navigate, rememberReturn } from './router';
import { Avatar, Dialog, Icon, Logo, SpaceLogo, useDismiss } from './ui';
import './home.css';

type Props = { me: Me; notice: Notice; onNotice: (n: Notice) => void; onChanged: () => Promise<unknown> };

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

const open = (id: string) => (e: MouseEvent) => {
	e.preventDefault();
	navigate(`/w/${id}`);
};

function useSummaries(workspaces: WorkspaceSummary[]): Record<string, SpaceSummary> {
	const [summaries, setSummaries] = useState<Record<string, SpaceSummary>>({});
	const ids = workspaces.map((w) => w.id).join(',');
	useEffect(() => {
		let alive = true;
		for (const id of ids ? ids.split(',') : []) {
			// Compteurs facultatifs : une carte sans résumé reste utilisable.
			api<SpaceSummary>('GET', `/w/${id}/summary`)
				.then((summary) => alive && setSummaries((prev) => ({ ...prev, [id]: summary })))
				.catch(() => undefined);
		}
		return () => {
			alive = false;
		};
	}, [ids]);
	return summaries;
}

export function HomeScreen({ me, notice, onNotice, onChanged }: Props) {
	const [creating, setCreating] = useState(false);
	const [profile, setProfile] = useState(false);
	const summaries = useSummaries(me.workspaces);

	const act = async (task: () => Promise<unknown>, ok: string) => {
		try {
			await task();
			await onChanged();
			onNotice({ tone: 'ok', text: ok });
		} catch (err) {
			onNotice({ tone: 'error', text: errorText(err) });
		}
	};

	const last = lastWorkspace();
	const resumed = me.workspaces.find((w) => w.id === last);
	const featured = resumed ?? me.workspaces[0];
	const others = me.workspaces.filter((w) => w !== featured);
	const canCreate = !me.guest;
	const firstName = me.user.name.trim().split(/\s+/)[0] || me.user.name;
	const role = (w: WorkspaceSummary) => (w.owner ? 'Propriétaire' : me.guest ? 'Invité' : 'Membre');

	return (
		<div className='home'>
			<header className='home-bar'>
				<Logo height={26} />
				<AccountMenu me={me} onProfile={() => setProfile(true)} act={act} />
			</header>

			<main className='home-main'>
				{notice && <p className={`notice notice-${notice.tone}`}>{notice.text}</p>}

				<div className='home-hello'>
					<h1>{featured ? `Bonjour, ${firstName}` : `Bienvenue, ${firstName}`}</h1>
					<p>
						{featured
							? resumed
								? 'Reprends là où tu t’étais arrêté.'
								: 'Choisis un espace pour continuer.'
							: canCreate
								? 'Crée l’espace de ton équipe, ou rejoins celui où l’on t’a invité.'
								: 'Aucune conversation ne t’est ouverte pour l’instant.'}
					</p>
				</div>

				{featured && (
					<a className='home-featured themed' style={{ '--accent': featured.accent } as CSSProperties} href={`/w/${featured.id}`} onClick={open(featured.id)}>
						<SpaceLogo name={featured.name} accent={featured.accent} url={featured.logoUrl} size={56} />
						<span className='home-featured-text'>
							<span className='home-featured-name ellipsis'>{featured.name}</span>
							<SpaceFacts role={role(featured)} summary={summaries[featured.id]} />
							<Activity summary={summaries[featured.id]} />
						</span>
						<span className='btn btn-primary home-open'>Ouvrir</span>
					</a>
				)}

				{others.length > 0 && (
					<section aria-labelledby='home-others'>
						<h2 id='home-others' className='home-section-title'>
							{resumed ? 'Tes autres espaces' : 'Tes espaces'}
							<span className='muted'>{others.length}</span>
						</h2>
						<ul className='home-list'>
							{others.map((w) => (
								<li key={w.id}>
									<a className='home-row' href={`/w/${w.id}`} onClick={open(w.id)}>
										<SpaceLogo name={w.name} accent={w.accent} url={w.logoUrl} size={38} />
										<span className='home-row-text'>
											<span className='home-row-name ellipsis'>{w.name}</span>
											<SpaceFacts role={role(w)} summary={summaries[w.id]} />
										</span>
										<RowActivity summary={summaries[w.id]} />
										<span className='btn home-row-open'>Ouvrir</span>
										<span className='home-row-chevron'>
											<Icon name='chevron-right' size={16} />
										</span>
									</a>
								</li>
							))}
						</ul>
					</section>
				)}

				{!featured && canCreate && (
					<div className='home-slot'>
						<span className='home-slot-logo' aria-hidden />
						<span className='muted'>Ton premier espace apparaîtra ici.</span>
					</div>
				)}

				{me.guest ? (
					<p className='home-guest'>
						<Icon name='shield' size={16} />
						<span>Compte invité : tu vois seulement les conversations où l’on t’a ajouté. Pour rejoindre un autre espace, demande un lien à son équipe.</span>
					</p>
				) : featured ? (
					<section className='home-more' aria-label='Autres actions'>
						<JoinForm />
						<button type='button' className='btn' onClick={() => setCreating(true)}>
							<Icon name='plus' size={16} /> Créer un espace
						</button>
					</section>
				) : (
					<section className='home-start'>
						<div className='home-tile'>
							<h2>Créer un espace</h2>
							<p className='home-tile-text'>Salons, appels, mail partagé, pages et suivis pour ton équipe.</p>
							<button type='button' className='btn btn-primary' onClick={() => setCreating(true)}>
								<Icon name='plus' size={16} /> Créer un espace
							</button>
						</div>
						<div className='home-tile'>
							<JoinForm tile />
						</div>
					</section>
				)}
			</main>

			{canCreate && <CreateSpaceDialog open={creating} onClose={() => setCreating(false)} onChanged={onChanged} />}
			<ProfileDialog open={profile} onClose={() => setProfile(false)} me={me} onChanged={onChanged} onNotice={onNotice} />
		</div>
	);
}

function SpaceFacts({ role, summary }: { role: string; summary: SpaceSummary | undefined }) {
	return (
		<span className='home-facts'>
			<span className='home-role'>{role}</span>
			{summary?.members != null && (
				<span className='home-fact'>
					<Icon name='users' size={14} /> {plural(summary.members, 'membre', 'membres')}
				</span>
			)}
		</span>
	);
}

function Activity({ summary }: { summary: SpaceSummary | undefined }) {
	if (!summary) {
		// Hauteur réservée : la carte ne saute pas à l'arrivée des compteurs.
		return <span className='home-activity' aria-hidden>&nbsp;</span>;
	}
	if (summary.unread === 0 && summary.mentions === 0) {
		return (
			<span className='home-activity muted'>
				<span className='home-activity-item'>
					<Icon name='check' size={14} /> Tout est lu
				</span>
			</span>
		);
	}
	return (
		<span className='home-activity'>
			{summary.mentions > 0 && (
				<span className='home-activity-item'>
					<span className='pill'>{summary.mentions > 99 ? '99+' : summary.mentions}</span>
					{summary.mentions > 1 ? 'mentions' : 'mention'}
				</span>
			)}
			{summary.unread > 0 && (
				<span className='home-activity-item'>
					<span className='dot' aria-hidden />
					{plural(summary.unread, 'conversation non lue', 'conversations non lues')}
				</span>
			)}
		</span>
	);
}

function RowActivity({ summary }: { summary: SpaceSummary | undefined }) {
	if (summary?.mentions) {
		return (
			<span className='pill' aria-label={plural(summary.mentions, 'mention', 'mentions')}>
				{summary.mentions > 99 ? '99+' : summary.mentions}
			</span>
		);
	}
	if (summary?.unread) {
		return <span className='home-row-unread' aria-label={plural(summary.unread, 'conversation non lue', 'conversations non lues')} title={plural(summary.unread, 'conversation non lue', 'conversations non lues')} />;
	}
	return null;
}

function JoinForm({ tile }: { tile?: boolean }) {
	const id = useId();
	const [error, setError] = useState<string | null>(null);
	const join = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const path = invitePath(String(new FormData(event.currentTarget).get('invite') ?? ''));
		if (!path) {
			setError('Lien non reconnu. Colle le lien complet reçu, de la forme app.synq.team/invite/…');
			return;
		}
		navigate(path);
	};
	return (
		<form className='home-join' onSubmit={join}>
			{tile && (
				<>
					<h2>Rejoindre un espace</h2>
					<p className='home-tile-text'>Colle le lien d’invitation reçu, ou son code.</p>
				</>
			)}
			<label htmlFor={id} className={tile ? 'sr-only' : 'home-join-label'}>
				Rejoindre avec un lien d’invitation
			</label>
			<div className='inline-form'>
				<input id={id} name='invite' placeholder='Lien ou code' autoComplete='off' spellCheck={false} required onChange={() => setError(null)} />
				<button className='btn'>Rejoindre</button>
			</div>
			{error && (
				<p className='home-join-error' role='alert'>
					{error}
				</p>
			)}
		</form>
	);
}

function AccountMenu({ me, onProfile, act }: { me: Me; onProfile: () => void; act: (task: () => Promise<unknown>, ok: string) => Promise<void> }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	const realEmail = !me.user.email.endsWith('@recube.invalid');
	const linkedRecube = me.identities.includes('recube');
	return (
		<div ref={ref} className='home-account'>
			<button type='button' className='home-account-btn' aria-label='Ton compte' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<Avatar name={me.user.name} url={me.user.avatarUrl} size={30} />
				<span className='home-account-name ellipsis'>{me.user.name}</span>
				<Icon name='chevron' size={14} />
			</button>
			{open && (
				<Floating anchor={ref} placement='bottom-end' className='popover' role='menu' style={{ width: 290 }}>
					<div className='home-menu-head'>
						<Avatar name={me.user.name} url={me.user.avatarUrl} size={40} />
						<span style={{ minWidth: 0 }}>
							<strong className='ellipsis' style={{ display: 'block' }}>
								{me.user.name}
							</strong>
							{realEmail && <span className='muted ellipsis' style={{ display: 'block', fontSize: 13 }}>{me.user.email}</span>}
						</span>
					</div>
					<div className='menu-sep' />
					<button
						type='button'
						role='menuitem'
						className='menu-item'
						onClick={() => {
							setOpen(false);
							onProfile();
						}}
					>
						<Icon name='user' size={16} /> Modifier le profil
					</button>
					{!me.guest &&
						(linkedRecube ? (
							<div className='home-menu-line'>
								<Icon name='check' size={16} />
								<span className='grow'>Compte Recube lié</span>
								{me.hasPassword && (
									<button
										type='button'
										className='link'
										onClick={() => {
											setOpen(false);
											void act(() => api('DELETE', '/me/identities/recube'), 'Compte Recube délié.');
										}}
									>
										Délier
									</button>
								)}
							</div>
						) : (
							<button
								type='button'
								role='menuitem'
								className='menu-item'
								onClick={() => {
									rememberReturn();
									window.location.href = '/api/auth/recube/start?link=1';
								}}
							>
								<Icon name='link' size={16} /> Lier mon compte Recube
							</button>
						))}
					<div className='menu-sep' />
					<button
						type='button'
						role='menuitem'
						className='menu-item menu-item-danger'
						onClick={async () => {
							await api('POST', '/auth/logout');
							window.location.href = '/';
						}}
					>
						<Icon name='logout' size={16} /> Se déconnecter
					</button>
				</Floating>
			)}
		</div>
	);
}

function CreateSpaceDialog({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => Promise<unknown> }) {
	return (
		<Dialog open={open} onClose={onClose} title='Créer un espace'>
			<CreateSpaceForm onClose={onClose} onChanged={onChanged} />
		</Dialog>
	);
}

function CreateSpaceForm({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<unknown> }) {
	const [name, setName] = useState('');
	const [accent, setAccent] = useState<string>(ACCENTS[0]);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const create = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			const created = await api<{ id: string }>('POST', '/workspaces', { name, accent });
			await onChanged();
			navigate(`/w/${created.id}`);
		} catch (err) {
			setError(errorText(err));
			setBusy(false);
		}
	};

	return (
		<form className='stack' onSubmit={create}>
			<div className='home-preview'>
				<SpaceLogo name={name.trim() || 'E'} accent={accent} size={44} />
				<span style={{ minWidth: 0 }}>
					<strong className='ellipsis' style={{ display: 'block' }}>
						{name.trim() || 'Nouvel espace'}
					</strong>
					<span className='muted' style={{ fontSize: 13 }}>
						Tu en seras propriétaire.
					</span>
				</span>
			</div>
			<label className='field'>
				Nom
				<input value={name} onChange={(e) => setName(e.target.value)} placeholder='Atelier Nord' required maxLength={64} autoFocus />
			</label>
			<div className='field'>
				Couleur
				<div className='swatches'>
					{ACCENTS.map((color) => (
						<button key={color} type='button' className='swatch' style={{ background: color }} aria-label={`Couleur ${color}`} aria-pressed={accent === color} onClick={() => setAccent(color)} />
					))}
				</div>
			</div>
			{error && <p className='notice notice-error'>{error}</p>}
			<div className='home-dialog-actions'>
				<button type='button' className='btn' onClick={onClose}>
					Annuler
				</button>
				<button className='btn btn-primary' style={{ background: accent }} disabled={busy}>
					Créer l’espace
				</button>
			</div>
		</form>
	);
}

type ProfileProps = { open: boolean; onClose: () => void; me: Me; onChanged: () => Promise<unknown>; onNotice: (n: Notice) => void };

function ProfileDialog({ open, onClose, ...rest }: ProfileProps) {
	return (
		<Dialog open={open} onClose={onClose} title='Profil'>
			<ProfileForm onClose={onClose} {...rest} />
		</Dialog>
	);
}

function ProfileForm({ onClose, me, onChanged, onNotice }: Omit<ProfileProps, 'open'>) {
	const [avatarUrl, setAvatarUrl] = useState(me.user.avatarUrl);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const run = async (task: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await task();
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<form
			className='stack'
			onSubmit={(e) => {
				e.preventDefault();
				const name = new FormData(e.currentTarget).get('name');
				void run(async () => {
					await api('PATCH', '/me', { name });
					await onChanged();
					onNotice({ tone: 'ok', text: 'Profil mis à jour.' });
					onClose();
				});
			}}
		>
			<div className='home-avatar-row'>
				<Avatar name={me.user.name} url={avatarUrl} size={64} />
				<label className={`btn${busy ? ' home-busy' : ''}`}>
					Changer la photo
					<input
						type='file'
						accept={AVATAR_TYPES.join(',')}
						hidden
						disabled={busy}
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) {
								void run(async () => {
									setAvatarUrl((await upload<User>('/me/avatar', file)).avatarUrl);
									await onChanged();
								});
							}
						}}
					/>
				</label>
				{avatarUrl?.startsWith('/api/avatars/') && (
					<button
						type='button'
						className='btn'
						disabled={busy}
						onClick={() =>
							void run(async () => {
								await api('DELETE', '/me/avatar');
								setAvatarUrl(null);
								await onChanged();
							})
						}
					>
						Retirer
					</button>
				)}
			</div>
			<span className='muted' style={{ fontSize: 13 }}>
				PNG, JPEG, GIF ou WebP, 2 Mo max.
			</span>
			<label className='field'>
				Nom affiché
				<input name='name' defaultValue={me.user.name} required maxLength={64} />
			</label>
			{error && <p className='notice notice-error'>{error}</p>}
			<div className='home-dialog-actions'>
				<button type='button' className='btn' onClick={onClose}>
					Fermer
				</button>
				<button className='btn btn-primary' disabled={busy}>
					Enregistrer
				</button>
			</div>
		</form>
	);
}
