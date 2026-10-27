import type { MailboxInfo, MailThread } from '../../shared/mail';
import { Avatar, Icon } from '../ui';
import { longDate, relativeDate } from './format';

export type MailTab = 'open' | 'snoozed' | 'done' | 'mine';

const TABS: Array<[MailTab, string]> = [
	['open', 'Ouverts'],
	['snoozed', 'En attente'],
	['done', 'Traités'],
	['mine', 'Assignés à moi'],
];

type Props = {
	title: string;
	tab: MailTab;
	threads: MailThread[] | null;
	boxes: Map<string, MailboxInfo>;
	selected: string | null;
	error: string | null;
	empty: string;
	canCompose: boolean;
	isUnread: (thread: MailThread) => boolean;
	onTab: (tab: MailTab) => void;
	onSelect: (id: string) => void;
	onCompose: () => void;
};

// Épinglés d'abord, tri serveur conservé à l'intérieur de chaque groupe.
const ordered = (threads: MailThread[]) => [...threads.filter((thread) => thread.pinned), ...threads.filter((thread) => !thread.pinned)];

export function ThreadList({ title, tab, threads, boxes, selected, error, empty, canCompose, isUnread, onTab, onSelect, onCompose }: Props) {
	return (
		<section className='mail-list'>
			<div className='mail-list-head'>
				<div className='mail-list-title'>
					<h2>{title}</h2>
					<button className='btn btn-primary mail-new' disabled={!canCompose} onClick={onCompose} title='Nouveau message'>
						<Icon name='compose' size={16} />
						<span>Nouveau message</span>
					</button>
				</div>
				<div className='mail-tabs' role='tablist'>
					{TABS.map(([key, label]) => (
						<button key={key} role='tab' aria-selected={tab === key} onClick={() => onTab(key)}>
							{label}
						</button>
					))}
				</div>
			</div>
			{error && <p className='notice notice-error'>{error}</p>}
			{threads === null ? (
				<div className='spinner' aria-busy />
			) : threads.length === 0 ? (
				<p className='mail-empty'>{empty}</p>
			) : (
				ordered(threads).map((thread) => {
					const unread = isUnread(thread);
					return (
						<button key={thread.id} className={`mail-thread${unread ? ' is-unread' : ''}`} aria-selected={selected === thread.id} onClick={() => onSelect(thread.id)}>
							<Avatar name={thread.from || '?'} size={34} />
							<span className='mail-thread-main'>
								<span className='mail-thread-top'>
									<strong>{thread.from || 'Expéditeur inconnu'}</strong>
									{thread.messageCount > 1 && <span className='mail-thread-count'>{thread.messageCount}</span>}
									{thread.pinned && (
										<span className='mail-thread-pin' title='Épinglé'>
											<Icon name='pin' size={13} />
										</span>
									)}
									<time title={longDate(thread.lastAt)}>{relativeDate(thread.lastAt)}</time>
								</span>
								<span className='mail-thread-subject'>{thread.subject || '(sans objet)'}</span>
								<span className='mail-thread-snippet'>{thread.snippet}</span>
								<span className='mail-thread-meta'>
									<span>{boxes.get(thread.mailboxId)?.name}</span>
									{thread.snoozedUntil && thread.snoozedUntil > Date.now() && (
										<span className='mail-thread-snooze'>
											<Icon name='clock' size={12} />
											{longDate(thread.snoozedUntil)}
										</span>
									)}
									{thread.assigneeName && <span className='tag'>{thread.assigneeName}</span>}
								</span>
							</span>
							{unread && <span className='mail-thread-dot' aria-label='Non lu' />}
						</button>
					);
				})
			)}
		</section>
	);
}
