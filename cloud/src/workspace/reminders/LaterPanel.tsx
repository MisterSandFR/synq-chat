import { useState } from 'react';

import type { LaterItem } from '../../../shared/reminders';
import { api } from '../../api';
import { Icon } from '../../ui';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import { excerpt, type Lookup } from '../richText';
import { dueLabel, type LaterTarget } from './ReminderUi';
import { patchReminder, reloadLater, removeReminder, setReminder, useLater } from './store';
import '../rc/rc.css';
import './reminders.css';

type Props = {
	workspaceId: string;
	lookup: Lookup;
	onOpen: (channelId: string, id: number) => void;
	onEdit: (target: LaterTarget) => void;
	onClose: () => void;
};

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// En cours : échéances d'abord (plus proche en tête), puis enregistrés récents.
const openOrder = (a: LaterItem, b: LaterItem) => (a.reminder?.dueAt ?? Infinity) - (b.reminder?.dueAt ?? Infinity) || (b.savedAt ?? 0) - (a.savedAt ?? 0);

export function LaterPanel({ workspaceId, lookup, onOpen, onEdit, onClose }: Props) {
	const items = useLater();
	const [tab, setTab] = useState<'open' | 'done'>('open');
	const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
	const now = Date.now();
	const shown = items
		.filter((item) => (tab === 'done') === Boolean(item.reminder?.doneAt))
		.sort(tab === 'open' ? openOrder : (a, b) => (b.reminder?.doneAt ?? 0) - (a.reminder?.doneAt ?? 0));
	const done = (item: LaterItem, value: boolean) =>
		void (item.reminder ? patchReminder(workspaceId, item.reminder.id, { done: value }) : setReminder(workspaceId, { messageId: item.messageId, dueAt: null, done: value })).catch(() => undefined);
	const remove = (item: LaterItem) =>
		void (item.reminder ? removeReminder(workspaceId, item.reminder.id) : api('PUT', `/w/${workspaceId}/messages/${item.messageId}/saved`, { saved: false }).then(() => reloadLater(workspaceId))).catch(() => undefined);
	const actions = (item: LaterItem): ContextMenuItem[] => [
		{ label: item.reminder?.dueAt ? 'Modifier le rappel' : 'Ajouter un rappel', icon: 'clock', disabled: item.unavailable, onSelect: () => onEdit({ messageId: item.messageId ?? undefined, reminderId: item.reminder?.id, dueAt: item.reminder?.dueAt }) },
		...(item.reminder?.dueAt && item.messageId !== null ? [{ label: 'Retirer le rappel', icon: 'close' as const, onSelect: () => void patchReminder(workspaceId, item.reminder!.id, { dueAt: null }).catch(() => undefined) }] : []),
		...(item.message ? [{ label: 'Ouvrir le message', icon: 'arrow' as const, onSelect: () => onOpen(item.message!.channelId, item.message!.id) }] : []),
		'sep',
		{ label: 'Supprimer', icon: 'trash', danger: true, onSelect: () => remove(item) },
	];

	return (
		<aside className='side-panel' aria-label='Plus tard'>
			<header className='side-panel-head'>
				<h2>Plus tard</h2>
				<button type='button' className='icon-btn' aria-label='Fermer Plus tard' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<div className='later-tabs'>
				<div className='segmented' role='tablist' aria-label='Filtrer'>
					<button type='button' role='tab' aria-selected={tab === 'open'} onClick={() => setTab('open')}>
						En cours
					</button>
					<button type='button' role='tab' aria-selected={tab === 'done'} onClick={() => setTab('done')}>
						Terminés
					</button>
				</div>
			</div>
			<div className='side-panel-body'>
				{shown.length === 0 ? (
					<p className='muted rc-empty'>
						{tab === 'open'
							? 'Rien pour plus tard. Enregistre un message avec le signet, demande « Me le rappeler » ou tape /rappel dans le composer.'
							: 'Aucun élément terminé.'}
					</p>
				) : (
					<ul className='list'>
						{shown.map((item) => {
							const { message, reminder } = item;
							const channel = message ? lookup.channels.find((c) => c.id === message.channelId) : undefined;
							const late = reminder?.dueAt != null && !reminder.doneAt && reminder.dueAt <= now;
							const note = item.messageId === null;
							return (
								<li key={item.key} className={`saved-item later-item${late ? ' is-late' : ''}`}>
									<button type='button' className='saved-open' disabled={!message} onClick={() => message && onOpen(message.channelId, message.id)}>
										<span className='saved-meta'>
											<strong>{note ? 'Note personnelle' : message ? (lookup.members.get(message.userId)?.name ?? 'Ancien membre') : 'Message indisponible'}</strong>
											<span className='muted ellipsis'>
												{message ? `${channel ? `${channel.kind === 'text' ? '#' : ''}${channel.name} · ` : ''}${when.format(message.createdAt)}` : ''}
											</span>
										</span>
										<span className={`saved-text${item.unavailable ? ' muted' : ''}`}>
											{note ? reminder?.text : message ? excerpt(message.body, lookup, 160) || 'Fichier joint' : 'Ce message a été supprimé ou n’est plus visible.'}
										</span>
										{reminder?.dueAt != null && (
											<span className='later-due'>
												<Icon name='clock' size={12} />
												{late ? 'En retard · ' : reminder.doneAt ? 'Prévu ' : ''}
												{dueLabel(reminder.dueAt)}
											</span>
										)}
									</button>
									<div className='later-actions'>
										<button
											type='button'
											className='icon-btn icon-btn-sm'
											aria-label={tab === 'open' ? 'Marquer terminé' : 'Remettre en cours'}
											title={tab === 'open' ? 'Marquer terminé' : 'Remettre en cours'}
											onClick={() => done(item, tab === 'open')}
										>
											<Icon name={tab === 'open' ? 'check' : 'repeat'} size={14} />
										</button>
										<button
											type='button'
											className='icon-btn icon-btn-sm'
											aria-label='Plus d’actions'
											title='Plus d’actions'
											onClick={(e) => {
												const rect = e.currentTarget.getBoundingClientRect();
												setMenu({ x: rect.right - 200, y: rect.bottom + 4, items: actions(item) });
											}}
										>
											<Icon name='more' size={14} />
										</button>
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</div>
			{menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
		</aside>
	);
}
