import { useEffect, useState } from 'react';

import type { ListColumn, ListItem, ListItemDetail, ListValue } from '../../../shared/lists';
import type { Member } from '../../../shared/types';
import { api } from '../../api';
import { Avatar, Icon } from '../../ui';
import { Cell, TYPE_ICON } from './cells';

type Props = {
	base: string;
	item: ListItem;
	columns: ListColumn[];
	members: Map<string, Member>;
	editable: boolean;
	version: number;
	onPatch: (item: ListItem, patch: { title?: string; description?: string; values?: Record<string, ListValue | null> }) => void;
	onDelete: (item: ListItem) => void;
	onClose: () => void;
};

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function ItemPanel({ base, item, columns, members, editable, version, onPatch, onDelete, onClose }: Props) {
	const [detail, setDetail] = useState<ListItemDetail | null>(null);
	const [comment, setComment] = useState('');
	const [sending, setSending] = useState(false);

	useEffect(() => {
		let live = true;
		void api<ListItemDetail>('GET', `${base}/items/${item.id}`)
			.then((next) => live && setDetail(next))
			.catch(() => undefined);
		return () => {
			live = false;
		};
	}, [base, item.id, version]);

	const send = async () => {
		if (!comment.trim() || sending) {
			return;
		}
		setSending(true);
		try {
			const added = await api<ListItemDetail['comments'][number]>('POST', `${base}/items/${item.id}/comments`, { body: comment });
			setDetail((d) => (d ? { ...d, comments: [...d.comments, added] } : d));
			setComment('');
		} finally {
			setSending(false);
		}
	};

	return (
		<aside className='lst-panel' aria-label='Détail de l’élément'>
			<header className='lst-panel-head'>
				<span className='muted'>Élément</span>
				<span className='grow' />
				{editable && (
					<button type='button' className='icon-btn' aria-label='Supprimer l’élément' title='Supprimer l’élément' onClick={() => onDelete(item)}>
						<Icon name='trash' />
					</button>
				)}
				<button type='button' className='icon-btn' aria-label='Fermer' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<div className='lst-panel-body'>
				<textarea
					key={`t${item.id}${item.title}`}
					className='lst-panel-title'
					rows={1}
					defaultValue={item.title}
					placeholder='Sans titre'
					disabled={!editable}
					aria-label='Titre'
					onBlur={(e) => e.target.value.trim() !== item.title && onPatch(item, { title: e.target.value })}
				/>
				<dl className='lst-fields'>
					{columns.map((column) => (
						<div key={column.id} className='lst-field'>
							<dt>
								<Icon name={TYPE_ICON[column.type]} size={14} />
								<span className='ellipsis'>{column.name}</span>
							</dt>
							<dd>
								<Cell column={column} item={item} members={members} editable={editable} onChange={(value) => onPatch(item, { values: { [column.id]: value } })} />
							</dd>
						</div>
					))}
				</dl>
				<label className='lst-section-label' htmlFor={`desc-${item.id}`}>
					Description
				</label>
				<textarea
					id={`desc-${item.id}`}
					key={`d${item.id}${item.description}`}
					className='lst-desc'
					rows={4}
					defaultValue={item.description}
					placeholder={editable ? 'Ajouter des détails' : ''}
					disabled={!editable}
					onBlur={(e) => e.target.value !== item.description && onPatch(item, { description: e.target.value })}
				/>
				<h3 className='lst-section-label'>Commentaires</h3>
				<ul className='lst-comments'>
					{detail?.comments.map((c) => {
						const author = members.get(c.userId);
						return (
							<li key={c.id}>
								<Avatar name={author?.name ?? '?'} url={author?.avatarUrl} size={28} />
								<div>
									<p className='lst-comment-meta'>
										<strong>{author?.name ?? 'Ancien membre'}</strong> <span className='muted'>{when.format(c.createdAt)}</span>
									</p>
									<p className='lst-comment-body'>{c.body}</p>
								</div>
							</li>
						);
					})}
					{detail && detail.comments.length === 0 && <li className='muted lst-none'>Pas encore de commentaire.</li>}
				</ul>
				{editable && (
					<div className='lst-comment-box'>
						<textarea
							rows={2}
							value={comment}
							placeholder='Écrire un commentaire'
							aria-label='Commentaire'
							onChange={(e) => setComment(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
									void send();
								}
							}}
						/>
						<button type='button' className='btn btn-primary' disabled={!comment.trim() || sending} onClick={() => void send()}>
							Commenter
						</button>
					</div>
				)}
				<h3 className='lst-section-label'>Historique</h3>
				<ul className='lst-history'>
					{detail?.activity.map((a) => (
						<li key={a.id}>
							<strong>{members.get(a.userId)?.name ?? 'Ancien membre'}</strong> {a.action} <span className='muted'>· {when.format(a.createdAt)}</span>
						</li>
					))}
				</ul>
			</div>
		</aside>
	);
}
