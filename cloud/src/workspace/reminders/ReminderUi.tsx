import { useRef, useState, type RefObject } from 'react';

import { parseReminder, quickReminders, reminderIdOf, snoozeChoices } from '../../../shared/reminders';
import type { Message } from '../../../shared/types';
import { errorText } from '../../api';
import { Floating } from '../../floating';
import { Dialog, Icon, useDismiss } from '../../ui';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import { laterBadge, patchReminder, removeReminder, setReminder, useLater } from './store';
import './reminders.css';

export { useLaterLoader } from './store';

// Message à rappeler, ou rappel existant à modifier.
export type LaterTarget = { messageId?: number; reminderId?: number; dueAt?: number | null };

const clock = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export function dueLabel(at: number, now = Date.now()): string {
	const start = new Date(now).setHours(0, 0, 0, 0);
	const target = new Date(at).setHours(0, 0, 0, 0);
	const prefix = target === start ? 'aujourd’hui' : target === start + 86_400_000 ? 'demain' : day.format(at);
	return `${prefix} à ${clock.format(at)}`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const toLocalInput = (at: number) => {
	const d = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
	return d.toISOString().slice(0, 16);
};

function ChoicesMenu({ anchor, onPick, onCustom, onRemove, onClose }: { anchor: RefObject<HTMLElement | null>; onPick: (at: number) => void; onCustom: () => void; onRemove?: () => void; onClose: () => void }) {
	const box = useRef<HTMLDivElement>(null);
	useDismiss(box, true, onClose);
	const now = new Date();
	return (
		<Floating anchor={anchor} placement='bottom-end' className='popover reminder-menu' role='menu' aria-label='Me le rappeler'>
			<div ref={box}>
				<p className='reminder-menu-head'>Me le rappeler</p>
				{quickReminders(now).map((choice) => (
					<button key={choice.key} type='button' role='menuitem' className='menu-item reminder-choice' onClick={() => onPick(choice.at)}>
						<span>{choice.label}</span>
						<span className='muted'>{choice.key.endsWith('m') || choice.key.endsWith('h') ? clock.format(choice.at) : capital(day.format(choice.at)).split(' ')[0]}</span>
					</button>
				))}
				<div className='reminder-sep' />
				<button type='button' role='menuitem' className='menu-item' onClick={onCustom}>
					<Icon name='calendar' size={16} /> Date et heure…
				</button>
				{onRemove && (
					<button type='button' role='menuitem' className='menu-item' onClick={onRemove}>
						<Icon name='close' size={16} /> Retirer le rappel
					</button>
				)}
			</div>
		</Floating>
	);
}

export function ReminderButton({ workspaceId, message, onCustom }: { workspaceId: string; message: Message; onCustom: () => void }) {
	const [open, setOpen] = useState(false);
	const anchor = useRef<HTMLButtonElement>(null);
	const reminder = useLater().find((item) => item.messageId === message.id)?.reminder;
	const active = reminder && reminder.dueAt !== null && !reminder.doneAt ? reminder : null;
	const close = () => setOpen(false);
	return (
		<>
			<button
				ref={anchor}
				type='button'
				className={`icon-btn icon-btn-sm${active ? ' is-saved' : ''}`}
				aria-label='Me le rappeler'
				aria-haspopup='menu'
				aria-expanded={open}
				title={active ? `Rappel ${dueLabel(active.dueAt!)}` : 'Me le rappeler'}
				onClick={() => setOpen(!open)}
			>
				<Icon name='clock' size={16} />
			</button>
			{open && (
				<ChoicesMenu
					anchor={anchor}
					onClose={close}
					onPick={(dueAt) => {
						close();
						void setReminder(workspaceId, { messageId: message.id, dueAt }).catch(() => undefined);
					}}
					onCustom={() => {
						close();
						onCustom();
					}}
					onRemove={
						active
							? () => {
									close();
									void patchReminder(workspaceId, active.id, { dueAt: null }).catch(() => undefined);
								}
							: undefined
					}
				/>
			)}
		</>
	);
}

export function ReminderDialog({ workspaceId, target, onClose }: { workspaceId: string; target: LaterTarget | null; onClose: () => void }) {
	return (
		<Dialog open={target !== null} onClose={onClose} title={target?.reminderId ? 'Modifier le rappel' : 'Me le rappeler'}>
			{target && <ReminderForm key={`${target.messageId}-${target.reminderId}`} workspaceId={workspaceId} target={target} onClose={onClose} />}
		</Dialog>
	);
}

function ReminderForm({ workspaceId, target, onClose }: { workspaceId: string; target: LaterTarget; onClose: () => void }) {
	const [value, setValue] = useState(() => toLocalInput(target.dueAt ?? quickReminders(new Date())[3]!.at));
	const [error, setError] = useState<string | null>(null);
	const save = async (dueAt: number) => {
		if (!Number.isFinite(dueAt) || dueAt <= Date.now()) {
			setError('Choisis une échéance à venir.');
			return;
		}
		try {
			await (target.reminderId ? patchReminder(workspaceId, target.reminderId, { dueAt }) : setReminder(workspaceId, { messageId: target.messageId ?? null, dueAt }));
			onClose();
		} catch (err) {
			setError(errorText(err));
		}
	};
	return (
		<form
			className='reminder-form'
			onSubmit={(e) => {
				e.preventDefault();
				void save(new Date(value).getTime());
			}}
		>
			<div className='reminder-quick'>
				{quickReminders(new Date()).map((choice) => (
					<button key={choice.key} type='button' className='btn' onClick={() => void save(choice.at)}>
						{choice.label}
					</button>
				))}
			</div>
			<label className='field'>
				<span>Date et heure</span>
				<input type='datetime-local' value={value} min={toLocalInput(Date.now())} onChange={(e) => setValue(e.target.value)} required />
			</label>
			{error && <p className='notice notice-error'>{error}</p>}
			<div className='dialog-actions'>
				<button type='button' className='btn btn-ghost' onClick={onClose}>
					Annuler
				</button>
				<button type='submit' className='btn btn-primary'>
					Enregistrer le rappel
				</button>
			</div>
		</form>
	);
}

export function LaterNavLink({ active, onOpen }: { active: boolean; onOpen: () => void }) {
	const badge = laterBadge(useLater());
	return (
		<button type='button' className='channel dm-nav-btn' aria-current={active ? 'page' : undefined} onClick={onOpen}>
			<span className='channel-icon'>
				<Icon name='bookmark' size={16} />
			</span>
			<span className='channel-name'>Plus tard</span>
			{badge > 0 && (
				<span className='later-badge' aria-label={`${badge} rappel${badge > 1 ? 's' : ''} échu${badge > 1 ? 's' : ''}`}>
					{badge}
				</span>
			)}
		</button>
	);
}

// Report depuis la notification : l'identifiant du rappel est porté par son lien.
export function SnoozeButton({ workspaceId, link }: { workspaceId: string; link: string | null }) {
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
	const [done, setDone] = useState<string | null>(null);
	const id = reminderIdOf(link);
	if (!id) {
		return null;
	}
	const items: ContextMenuItem[] = snoozeChoices(new Date()).map((choice) => ({
		label: choice.label,
		icon: 'clock',
		onSelect: () =>
			void patchReminder(workspaceId, id, { dueAt: choice.at })
				.then(() => setDone(dueLabel(choice.at)))
				.catch((err) => setDone(errorText(err))),
	}));
	return (
		<>
			<button
				type='button'
				className='icon-btn activity-read'
				aria-label='Reporter le rappel'
				title={done ? `Reporté : ${done}` : 'Reporter'}
				onClick={(e) => {
					const rect = e.currentTarget.getBoundingClientRect();
					setMenu({ x: rect.left, y: rect.bottom + 4 });
				}}
			>
				<Icon name={done ? 'check' : 'repeat'} size={16} />
			</button>
			{menu && <ContextMenu x={menu.x} y={menu.y} items={items} header={<p className='reminder-menu-head'>Reporter de</p>} onClose={() => setMenu(null)} />}
		</>
	);
}

export function ReminderHint({ text }: { text: string }) {
	const args = text.replace(/^\/rappel\s*/i, '');
	const parsed = args ? parseReminder(args) : null;
	let body: string;
	let tone = '';
	if (!parsed) {
		body = 'Précise quand : « demain 9h », « dans 2 h », « lundi », « le 12/11 à 15h »… puis le texte.';
	} else if (parsed.dueAt <= Date.now()) {
		body = `Échéance passée : ${dueLabel(parsed.dueAt)}.`;
		tone = ' is-late';
	} else {
		body = `${capital(dueLabel(parsed.dueAt))}${parsed.text ? ` : ${parsed.text}` : ' : ajoute le texte du rappel.'}`;
	}
	return (
		<div className={`composer-context reminder-hint${tone}`} role='status'>
			<Icon name='clock' size={14} />
			<span className='ellipsis'>{body}</span>
			<span className='muted'>Visible de toi seul</span>
		</div>
	);
}

// Renvoie l'erreur à afficher, ou null si la note est créée.
export async function submitReminderCommand(workspaceId: string, args: string): Promise<string | null> {
	const parsed = parseReminder(args);
	if (!parsed) {
		return 'Échéance non reconnue : essaie « demain 9h », « dans 2 h » ou « lundi ».';
	}
	if (parsed.dueAt <= Date.now()) {
		return 'Échéance passée.';
	}
	if (!parsed.text) {
		return 'Ajoute le texte du rappel après l’échéance.';
	}
	try {
		await setReminder(workspaceId, { text: parsed.text, dueAt: parsed.dueAt });
		return null;
	} catch (err) {
		return errorText(err);
	}
}

export { removeReminder };
