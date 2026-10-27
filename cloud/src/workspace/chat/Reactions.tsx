import type { Reaction } from '../../../shared/chat';
import { emojiByChar } from '../../../shared/emoji';
import { Icon } from '../../ui';
import type { Lookup } from '../richText';
import './chat.css';

const SHOWN = 8;

export function reactionLabel(reaction: Reaction, lookup: Pick<Lookup, 'members' | 'myId'>): string {
	const name = emojiByChar.get(reaction.emoji)?.name;
	const what = name ? `:${name}:` : reaction.emoji;
	const me = reaction.users.includes(lookup.myId);
	const others = reaction.users.filter((id) => id !== lookup.myId).map((id) => lookup.members.get(id)?.name ?? 'Ancien membre');
	const rest = others.length - SHOWN;
	const parts = [...others.slice(0, SHOWN), ...(rest > 0 ? [`${rest} autre${rest > 1 ? 's' : ''}`] : []), ...(me ? ['toi'] : [])];
	if (parts.length === 1 && me) {
		return `Tu as réagi avec ${what}`;
	}
	const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} et ${parts.at(-1)}`;
	const verb = me ? 'avez' : reaction.users.length === 1 ? 'a' : 'ont';
	return `${list} ${verb} réagi avec ${what}`;
}

type Props = {
	reactions: Reaction[];
	lookup: Lookup;
	canReact: boolean;
	pickerOpen: boolean;
	onToggle: (emoji: string) => void;
	onAdd: (anchor: DOMRect) => void;
};

export function Reactions({ reactions, lookup, canReact, pickerOpen, onToggle, onAdd }: Props) {
	return (
		<div className='reactions'>
			{reactions.map((reaction) => {
				const mine = reaction.users.includes(lookup.myId);
				const label = reactionLabel(reaction, lookup);
				return (
					<button
						key={reaction.emoji}
						type='button'
						className={`reaction${mine ? ' reaction-mine' : ''}`}
						aria-pressed={mine}
						aria-label={label}
						title={label}
						disabled={!mine && !canReact}
						onClick={() => onToggle(reaction.emoji)}
					>
						<span className='reaction-emoji'>{reaction.emoji}</span>
						<span>{reaction.users.length}</span>
					</button>
				);
			})}
			{canReact && (
				<button
					type='button'
					className='reaction reaction-add'
					aria-label='Ajouter une réaction'
					title='Ajouter une réaction'
					onPointerDown={(e) => pickerOpen && e.stopPropagation()}
					onClick={(e) => onAdd(e.currentTarget.getBoundingClientRect())}
				>
					<Icon name='smile-plus' size={16} />
				</button>
			)}
		</div>
	);
}
