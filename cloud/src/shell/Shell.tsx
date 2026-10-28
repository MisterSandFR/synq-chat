import { useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';

import { Floating } from '../floating';
import type { Me } from '../../shared/types';
import { api } from '../api';
import { navigate } from '../router';
import { useTheme, type Theme } from '../theme';
import { Avatar, Icon, SpaceLogo, useDismiss, type IconName } from '../ui';
import './shell.css';

export type RailItem = { key: string; label: string; icon: IconName; href: string; active: boolean; badge?: number };

type Props = { me: Me; workspaceId: string | null; items: RailItem[]; children: ReactNode };

const THEMES: Record<Theme, { next: Theme; label: string; icon: IconName }> = {
	system: { next: 'dark', label: 'système', icon: 'contrast' },
	dark: { next: 'light', label: 'sombre', icon: 'moon' },
	light: { next: 'system', label: 'clair', icon: 'sun' },
};

// Barre en bas sur mobile : le menu du profil s'ouvre vers le haut.
const narrow = () => window.matchMedia('(max-width: 860px)').matches;

const go = (href: string) => (event: MouseEvent) => {
	if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
		event.preventDefault();
		navigate(href);
	}
};

export function Shell({ me, workspaceId, items, children }: Props) {
	const workspace = me.workspaces.find((w) => w.id === workspaceId);
	const [theme, setTheme] = useTheme();
	return (
		<div className='shell themed' style={{ '--accent': workspace?.accent ?? '#6A4BFF' } as CSSProperties}>
			<nav className='rail' aria-label='Applications'>
				<SpaceMenu me={me} workspaceId={workspaceId} />
				<div className='rail-items'>
					{items.map((item) => (
						<a key={item.key} href={item.href} className='rail-item' aria-current={item.active ? 'page' : undefined} onClick={go(item.href)}>
							<span className='rail-tile'>
								<Icon name={item.icon} size={20} />
								{Boolean(item.badge) && <span className='rail-badge'>{item.badge! > 99 ? '99+' : item.badge}</span>}
							</span>
							<span className='rail-label'>{item.label}</span>
						</a>
					))}
				</div>
				<span className='grow' />
				<CreateMenu workspaceId={workspaceId} guest={Boolean(me.guest)} />
				<button
					type='button'
					className='rail-round rail-desktop'
					aria-label={`Thème ${THEMES[theme].label}, passer au thème ${THEMES[THEMES[theme].next].label}`}
					title={`Thème ${THEMES[theme].label}`}
					onClick={() => setTheme(THEMES[theme].next)}
				>
					<Icon name={THEMES[theme].icon} />
				</button>
				<ProfileMenu me={me} />
			</nav>
			<div className='shell-main'>{children}</div>
		</div>
	);
}

// Menu « Créer » : entrées d'espace (liste, canevas) puis espaces.
function SpaceMenu({ me, workspaceId }: { me: Me; workspaceId: string | null }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	const current = me.workspaces.find((w) => w.id === workspaceId);
	return (
		<div ref={ref} className='rail-anchor rail-desktop'>
			<button
				type='button'
				className='rail-space'
				style={current ? { background: current.logoUrl ? 'var(--surface)' : current.accent } : undefined}
				aria-label={current ? `Espace ${current.name}, changer d’espace` : 'Choisir un espace'}
				title={current?.name ?? 'Espaces'}
				aria-haspopup='menu'
				aria-expanded={open}
				onClick={() => setOpen(!open)}
			>
				{current ? current.logoUrl ? <img className='rail-space-img' src={current.logoUrl} alt='' /> : current.name.charAt(0).toUpperCase() : <Icon name='home' />}
			</button>
			{open && (
				<Floating anchor={ref} placement='right-start' offset={18} className='popover rail-pop' role='menu' style={{ width: 280 }}>
					{me.workspaces.map((w) => (
						<button
							key={w.id}
							type='button'
							role='menuitem'
							className='menu-item'
							onClick={() => {
								setOpen(false);
								navigate(`/w/${w.id}`);
							}}
						>
							<SpaceLogo name={w.name} accent={w.accent} url={w.logoUrl} size={26} />
							<span className='grow ellipsis'>{w.name}</span>
							{w.id === workspaceId && <Icon name='check' size={16} />}
						</button>
					))}
					<div className='menu-sep' />
					<button
						type='button'
						role='menuitem'
						className='menu-item'
						onClick={() => {
							setOpen(false);
							navigate('/espaces');
						}}
					>
						<Icon name='plus' size={16} /> Créer ou rejoindre un espace
					</button>
				</Floating>
			)}
		</div>
	);
}

function ProfileMenu({ me }: { me: Me }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	const realEmail = !me.user.email.endsWith('@recube.invalid');
	return (
		<div ref={ref} className='rail-anchor'>
			<button type='button' className='rail-me' aria-label='Ton profil' title={me.user.name} aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<Avatar name={me.user.name} url={me.user.avatarUrl} size={34} square />
			</button>
			{open && (
				<Floating anchor={ref} placement={narrow() ? 'top-end' : 'right-end'} offset={narrow() ? 8 : 18} className='popover rail-pop' role='menu' style={{ width: 260 }}>
					<div className='rail-pop-head'>
						<Avatar name={me.user.name} url={me.user.avatarUrl} size={36} />
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
							navigate('/espaces');
						}}
					>
						<Icon name='settings' size={16} /> Profil et espaces
					</button>
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

// Menu « Créer » de la barre d'apps.
function CreateMenu({ workspaceId, guest }: { workspaceId: string | null; guest: boolean }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	const pick = (action: () => void) => () => {
		setOpen(false);
		action();
	};
	const newCanvas = async (id: string) => {
		const canvas = await api<{ id: string }>('POST', `/w/${id}/canvases`, { title: 'Sans titre' });
		navigate(`/w/${id}/canevas/${canvas.id}`);
	};
	return (
		<div ref={ref} className='rail-anchor rail-desktop'>
			<button type='button' className='rail-round' aria-label='Créer' title='Créer' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<Icon name='plus' />
			</button>
			{open && (
				<Floating anchor={ref} placement='right-end' offset={18} className='popover rail-pop' role='menu' style={{ width: 260 }}>
					{workspaceId && !guest && (
						<>
							<button type='button' role='menuitem' className='menu-item create-item' onClick={pick(() => void newCanvas(workspaceId).catch(() => undefined))}>
								<span className='create-tile create-tile-canvas'>
									<Icon name='file' size={18} />
								</span>
								<span className='create-text'>
									<strong>Canevas</strong>
									<span>Créer et partager du contenu</span>
								</span>
							</button>
							<button type='button' role='menuitem' className='menu-item create-item' onClick={pick(() => navigate(`/w/${workspaceId}/listes/nouvelle`))}>
								<span className='create-tile create-tile-list'>
									<Icon name='list' size={18} />
								</span>
								<span className='create-text'>
									<strong>Liste</strong>
									<span>Suivre et gérer les projets</span>
								</span>
							</button>
							<div className='menu-sep' />
							<button type='button' role='menuitem' className='menu-item' onClick={pick(() => navigate(`/w/${workspaceId}/canevas`))}>
								<Icon name='file' size={16} /> Tous les canevas
							</button>
							<button type='button' role='menuitem' className='menu-item' onClick={pick(() => navigate(`/w/${workspaceId}/listes`))}>
								<Icon name='list' size={16} /> Toutes les listes
							</button>
							<div className='menu-sep' />
						</>
					)}
					<button type='button' role='menuitem' className='menu-item' onClick={pick(() => navigate('/espaces'))}>
						<Icon name='plus' size={16} /> Créer ou rejoindre un espace
					</button>
				</Floating>
			)}
		</div>
	);
}
