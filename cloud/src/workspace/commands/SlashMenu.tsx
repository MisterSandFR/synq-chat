import type { SlashCommand } from '../../../shared/commands';
import { Icon } from '../../ui';
import type { EphemeralNote } from './useSlash';
import './commands.css';

export function SlashMenu({ matches, index, onPick }: { matches: SlashCommand[]; index: number; onPick: (command: SlashCommand) => void }) {
	if (!matches.length) {
		return null;
	}
	return (
		<div className='popover suggest slash-menu' role='listbox' aria-label='Commandes'>
			{matches.map((command, i) => (
				<button
					key={command.name}
					type='button'
					role='option'
					aria-selected={i === index}
					className='menu-item slash-item'
					onMouseDown={(e) => {
						e.preventDefault();
						onPick(command);
					}}
				>
					<span className='slash-name'>/{command.name}</span>
					{command.usage && <span className='slash-usage'>{command.usage}</span>}
					<span className='slash-desc ellipsis'>{command.description}</span>
				</button>
			))}
		</div>
	);
}

export function SlashHint({ command }: { command: SlashCommand }) {
	return (
		<div className='composer-context slash-hint'>
			<Icon name='slash' size={14} />
			<span className='slash-name'>/{command.name}</span>
			{command.usage && <span className='slash-usage'>{command.usage}</span>}
			<span className='grow ellipsis'>{command.description}</span>
		</div>
	);
}

export function EphemeralNotes({ notes, onDismiss }: { notes: EphemeralNote[]; onDismiss: (id: number) => void }) {
	if (!notes.length) {
		return null;
	}
	return (
		<div className='ephemeral-stack' aria-live='polite'>
			{notes.map((note) => (
				<div key={note.id} className='ephemeral'>
					<div className='ephemeral-head'>
						<Icon name='eye-off' size={14} />
						<span className='slash-name'>/{note.command}</span>
						<span className='grow'>Visible par toi seul</span>
						<button type='button' className='icon-btn icon-btn-sm' aria-label='Masquer' onClick={() => onDismiss(note.id)}>
							<Icon name='close' size={14} />
						</button>
					</div>
					<p className='ephemeral-text'>{note.text}</p>
				</div>
			))}
		</div>
	);
}
