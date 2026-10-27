import type { MailboxInfo, MailDraft, MailThread } from '../../shared/mail';
import { Avatar, Icon } from '../ui';
import { addressLabel, longDate, relativeDate } from './format';
import { Highlight, stripMarks } from './Highlight';

export type MailTab = 'open' | 'snoozed' | 'done' | 'mine' | 'drafts';

const TABS: Array<[MailTab, string]> = [
	['open', 'Ouverts'],
	['snoozed', 'En attente'],
	['done', 'Traités'],
	['mine', 'Assignés à moi'],
	['drafts', 'Brouillons'],
];

type Props = {
	title: string;
	tab: MailTab;
	threads: MailThread[] | null;
	drafts: MailDraft[] | null;
	boxes: Map<string, MailboxInfo>;
	selected: string | null;
	error: string | null;
	empty: string;
	canCompose: boolean;
	query: string;
	terms: string[];
	searching: boolean;
	onQuery: (query: string) => void;
	onTab: (tab: MailTab) => void;
	onSelect: (id: string) => void;
	onCompose: () => void;
	onDraft: (draft: MailDraft) => void;
	onUnschedule: (draft: MailDraft) => void;
};

// Épinglés d'abord, tri serveur conservé à l'intérieur de chaque groupe.
export const ordered = (threads: MailThread[]) => [...threads.filter((thread) => thread.pinned), ...threads.filter((thread) => !thread.pinned)];

export function ThreadList(props: Props) {
	const { title, tab, threads, drafts, boxes, selected, error, empty, canCompose, query, terms, searching, onQuery, onTab, onSelect, onCompose } = props;
	const showDrafts = tab === 'drafts' && !searching;
	return (
		<section className='mail-list'>
			<div className='mail-list-head'>
				<div className='mail-list-title'>
					<h2>{searching ? 'Résultats' : title}</h2>
					<button className='btn btn-primary mail-new' disabled={!canCompose} onClick={onCompose} title='Nouveau message'>
						<Icon name='compose' size={16} />
						<span>Nouveau message</span>
					</button>
				</div>
				<label className='mail-search'>
					<Icon name='search' size={15} />
					<input
						type='search'
						value={query}
						onChange={(e) => onQuery(e.target.value)}
						onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), onQuery(''))}
						placeholder='Rechercher dans les mails'
						aria-label='Rechercher dans les mails'
						maxLength={200}
					/>
				</label>
				{!searching && (
					<div className='mail-tabs' role='tablist'>
						{TABS.map(([key, label]) => (
							<button key={key} role='tab' aria-selected={tab === key} onClick={() => onTab(key)}>
								{label}
							</button>
						))}
					</div>
				)}
			</div>
			{error && <p className='notice notice-error'>{error}</p>}
			{showDrafts ? <DraftRows {...props} /> : threads === null ? <div className='spinner' aria-busy /> : threads.length === 0 ? (
				<p className='mail-empty'>{searching ? 'Aucun résultat.' : empty}</p>
			) : (
				(searching ? threads : ordered(threads)).map((thread) => {
					const excerpt = thread.match || thread.snippet;
					return (
						<button key={thread.id} className={`mail-thread${thread.unread ? ' is-unread' : ''}`} aria-selected={selected === thread.id} onClick={() => onSelect(thread.id)}>
							<Avatar name={thread.from || '?'} size={34} />
							<span className='mail-thread-main'>
								<span className='mail-thread-top'>
									<strong>
										<Highlight text={thread.from || 'Expéditeur inconnu'} terms={terms} />
									</strong>
									{thread.messageCount > 1 && <span className='mail-thread-count'>{thread.messageCount}</span>}
									{thread.pinned && (
										<span className='mail-thread-pin' title='Épinglé'>
											<Icon name='pin' size={13} />
										</span>
									)}
									<time title={longDate(thread.lastAt)}>{relativeDate(thread.lastAt)}</time>
								</span>
								<span className='mail-thread-subject'>
									<Highlight text={thread.subject || '(sans objet)'} terms={terms} />
								</span>
								<span className='mail-thread-snippet' title={stripMarks(excerpt)}>
									<Highlight text={excerpt} terms={terms} />
								</span>
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
							{thread.unread && <span className='mail-thread-dot' aria-label='Non lu' />}
						</button>
					);
				})
			)}
		</section>
	);
}

function DraftRows({ drafts, boxes, onDraft, onUnschedule }: Props) {
	if (drafts === null) {
		return <div className='spinner' aria-busy />;
	}
	if (drafts.length === 0) {
		return <p className='mail-empty'>Aucun brouillon.</p>;
	}
	return (
		<>
			{drafts.map((draft) => (
				<div key={draft.id} className='mail-thread mail-draft-row'>
					<button className='mail-draft-open' onClick={() => onDraft(draft)} title='Reprendre le brouillon'>
						<span className='mail-draft-icon'>
							<Icon name={draft.forwardOf ? 'forward' : draft.threadId ? 'reply' : 'compose'} size={16} />
						</span>
						<span className='mail-thread-main'>
							<span className='mail-thread-top'>
								<strong>{draft.to.map(addressLabel).join(', ') || 'Sans destinataire'}</strong>
								<time title={longDate(draft.updatedAt)}>{relativeDate(draft.updatedAt)}</time>
							</span>
							<span className='mail-thread-subject'>{draft.subject || '(sans objet)'}</span>
							<span className='mail-thread-snippet'>{draft.text.replace(/\s+/g, ' ').trim() || 'Message vide'}</span>
							<span className='mail-thread-meta'>
								<span>{boxes.get(draft.mailboxId)?.name}</span>
								{draft.sendAt && (
									<span className='mail-thread-snooze'>
										<Icon name='clock' size={12} />
										Envoi prévu {longDate(draft.sendAt)}
									</span>
								)}
								{draft.sendError && <span className='mail-draft-error'>Échec : {draft.sendError}</span>}
							</span>
						</span>
					</button>
					{draft.sendAt && (
						<button className='btn btn-ghost mail-draft-cancel' onClick={() => onUnschedule(draft)}>
							Annuler l’envoi
						</button>
					)}
				</div>
			))}
		</>
	);
}
