import { writePref } from '../../router';
import { Icon } from '../../ui';
import { whenText } from './format';
import { useDrafts } from './store';
import './drafts.css';

export const DRAFTS_TAB_PREF = 'drafts_tab';

// Repère crayon d'un salon dont le composer a un brouillon.
export function DraftMark({ channelId }: { channelId: string }) {
	const { drafts } = useDrafts();
	return drafts.some((d) => d.channelId === channelId && d.threadRoot === 0) ? (
		<span className='draft-mark' title='Brouillon' aria-label='Brouillon'>
			<Icon name='pencil' size={13} strokeWidth={2} />
		</span>
	) : null;
}

export function DraftsNavLink({ active, onOpen }: { active: boolean; onOpen: () => void }) {
	const { drafts, scheduled } = useDrafts();
	const count = drafts.length + scheduled.length;
	return (
		<button type='button' className='channel dm-nav-btn' aria-current={active ? 'page' : undefined} onClick={onOpen}>
			<span className='channel-icon'>
				<Icon name='compose' size={16} />
			</span>
			<span className='channel-name'>Brouillons et envois</span>
			{count > 0 && <span className='draft-count'>{count}</span>}
		</button>
	);
}

export function ScheduledBanner({ channelId, onOpen }: { channelId: string; onOpen: () => void }) {
	const { scheduled } = useDrafts();
	const mine = scheduled.filter((s) => s.channelId === channelId && s.threadRoot === 0);
	const pending = mine.filter((s) => s.status === 'pending');
	const failed = mine.length - pending.length;
	if (!mine.length) {
		return null;
	}
	const next = pending[0];
	const text = failed
		? `${failed} message${failed > 1 ? 's programmés n’ont' : ' programmé n’a'} pas pu partir`
		: pending.length === 1
			? `1 message programmé pour ${whenText(next!.sendAt)}`
			: `${pending.length} messages programmés, le prochain ${whenText(next!.sendAt)}`;
	return (
		<div className={`scheduled-banner${failed ? ' is-failed' : ''}`} role='status'>
			<Icon name='clock' size={15} />
			<span className='grow ellipsis'>{text}</span>
			<button
				type='button'
				className='btn btn-ghost'
				onClick={() => {
					writePref(DRAFTS_TAB_PREF, 'scheduled');
					onOpen();
				}}
			>
				Modifier
			</button>
		</div>
	);
}
