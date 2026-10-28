import { useRef, useState } from 'react';

import { Floating } from '../floating';
import { Icon, useDismiss, type IconName } from '../ui';
import './channel-header.css';

export type HeaderTab = { key: string; label: string; icon: IconName; active?: boolean; badge?: number; onSelect: () => void };

// Onglets façon Slack : un libellé par action, au lieu d'une rangée d'icônes muettes.
export function ChannelTabs({ tabs }: { tabs: HeaderTab[] }) {
	return (
		<nav className='channel-tabs' aria-label='Vues du salon'>
			{tabs.map((tab) => (
				<button key={tab.key} type='button' className='channel-tab' aria-pressed={tab.active ?? false} onClick={tab.onSelect}>
					<Icon name={tab.icon} size={15} />
					{tab.label}
					{(tab.badge ?? 0) > 0 && <span className='channel-tab-badge'>{tab.badge! > 99 ? '99+' : tab.badge}</span>}
				</button>
			))}
		</nav>
	);
}

export type HeaderAction = { key: string; label: string; icon: IconName; onSelect: () => void } | 'separator';

export function HeaderMenu({ actions }: { actions: HeaderAction[] }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	// Séparateurs en tête, en fin ou doublés : retirés quand une action est masquée.
	const shown = actions.filter((a, i, all) => a !== 'separator' || (i > 0 && i < all.length - 1 && all[i - 1] !== 'separator'));
	if (!shown.some((a) => a !== 'separator')) {
		return null;
	}
	return (
		<div ref={ref} className='header-menu'>
			<button type='button' className='icon-btn' aria-label='Plus d’actions' title='Plus d’actions' aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<Icon name='more' />
			</button>
			{open && (
				<Floating anchor={ref} placement='bottom-end' className='popover' role='menu' style={{ minWidth: 230 }}>
					{shown.map((action, i) =>
						action === 'separator' ? (
							<div key={`sep-${i}`} className='menu-sep' />
						) : (
							<button
								key={action.key}
								type='button'
								role='menuitem'
								className='menu-item'
								onClick={() => {
									setOpen(false);
									action.onSelect();
								}}
							>
								<Icon name={action.icon} size={16} />
								{action.label}
							</button>
						),
					)}
				</Floating>
			)}
		</div>
	);
}
