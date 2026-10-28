import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';

import { STATUS_COLORS, type Checklist, type ListAttachment, type ListDetail, type ListItem, type ListItemDetail, type ListLabel } from '../../../shared/lists';
import type { Member } from '../../../shared/types';
import { api, ApiError, upload } from '../../api';
import { Avatar, Icon } from '../../ui';
import { Cell, TYPE_ICON } from './cells';
import { MenuButton, newId, type Patch } from './table';
import { coverUrl, DuePill } from './views';

const ItemDoc = lazy(() => import('./ItemDoc'));

type Props = {
	base: string;
	workspaceId: string;
	list: ListDetail;
	item: ListItem;
	members: Map<string, Member>;
	myId: string;
	version: number;
	full: boolean;
	onPatch: (item: ListItem, patch: Patch) => void;
	onLabels: (labels: ListLabel[]) => Promise<void>;
	onDelete: (item: ListItem) => void;
	onFull: () => void;
	onClose: () => void;
};

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Action impossible pour le moment.');
const size = (n: number) => (n < 1024 ? `${n} o` : n < 1048576 ? `${Math.round(n / 1024)} Ko` : `${(n / 1048576).toFixed(1)} Mo`);

export function ItemPanel({ base, workspaceId, list, item, members, myId, version, full, onPatch, onLabels, onDelete, onFull, onClose }: Props) {
	const [detail, setDetail] = useState<ListItemDetail | null>(null);
	const [comment, setComment] = useState('');
	const [sending, setSending] = useState(false);
	const [error, setError] = useState('');
	const [labelName, setLabelName] = useState('');
	const fileInput = useRef<HTMLInputElement>(null);
	const editable = list.canEdit;
	const path = `${base}/items/${item.id}`;
	const people = [...members.values()];

	const refresh = () =>
		api<ListItemDetail>('GET', path)
			.then(setDetail)
			.catch(() => undefined);
	useEffect(() => {
		void refresh();
	}, [path, version]);

	const call = async (method: 'POST' | 'PATCH' | 'DELETE', sub: string, body?: unknown) => {
		try {
			await api(method, `${path}${sub}`, body);
			await refresh();
		} catch (e) {
			setError(message(e));
		}
	};

	const send = async () => {
		if (!comment.trim() || sending) {
			return;
		}
		setSending(true);
		try {
			const added = await api<ListItemDetail['comments'][number]>('POST', `${path}/comments`, { body: comment });
			setDetail((d) => (d ? { ...d, comments: [...d.comments, added] } : d));
			setComment('');
		} finally {
			setSending(false);
		}
	};

	const attach = async (files: FileList | null) => {
		for (const file of [...(files ?? [])]) {
			try {
				await upload<ListAttachment>(`${path}/files`, file);
			} catch (e) {
				setError(message(e));
			}
		}
		await refresh();
	};

	const toggleLabel = (id: string) => onPatch(item, { labels: item.labels.includes(id) ? item.labels.filter((l) => l !== id) : [...item.labels, id] });
	const createLabel = async () => {
		const name = labelName.trim();
		if (!name) {
			return;
		}
		const label = { id: newId(), name, color: STATUS_COLORS[list.labels.length % STATUS_COLORS.length]! };
		setLabelName('');
		await onLabels([...list.labels, label]);
		onPatch(item, { labels: [...item.labels, label.id] });
	};

	const cover = coverUrl(workspaceId, list.id, item.cover);
	const images = detail?.files.filter((f) => f.type.startsWith('image/')) ?? [];

	return (
		<aside className={`lst-panel bs-panel${full ? ' bs-panel-full' : ''}`} aria-label='Détail de l’élément'>
			<header className='lst-panel-head'>
				<span className='muted ellipsis'>{list.title}</span>
				<span className='grow' />
				{editable && (
					<MenuButton label={<Icon name='image' />} className='icon-btn'>
						{(close) => (
							<div className='bs-cover-menu'>
								<p className='lst-menu-title'>Couverture</p>
								<div className='bs-swatches'>
									{STATUS_COLORS.map((color) => (
										<button
											key={color}
											type='button'
											className='bs-swatch-btn'
											style={{ background: color }}
											aria-label={`Couleur ${color}`}
											aria-pressed={item.cover === color}
											onClick={() => {
												onPatch(item, { cover: color });
												close();
											}}
										/>
									))}
								</div>
								{images.map((f) => (
									<button
										key={f.id}
										type='button'
										role='menuitem'
										className='menu-item'
										onClick={() => {
											onPatch(item, { cover: `file:${f.id}` });
											close();
										}}
									>
										<Icon name='image' size={14} /> <span className='ellipsis'>{f.name}</span>
									</button>
								))}
								{item.cover && (
									<button
										type='button'
										role='menuitem'
										className='menu-item'
										onClick={() => {
											onPatch(item, { cover: null });
											close();
										}}
									>
										<Icon name='close' size={14} /> Retirer la couverture
									</button>
								)}
							</div>
						)}
					</MenuButton>
				)}
				<button type='button' className='icon-btn' aria-label={full ? 'Réduire en panneau' : 'Ouvrir en pleine page'} title={full ? 'Réduire en panneau' : 'Ouvrir en pleine page'} onClick={onFull}>
					<Icon name={full ? 'chevron-right' : 'expand'} />
				</button>
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
				{cover ? <img className='bs-panel-cover' src={cover} alt='' /> : item.cover ? <span className='bs-panel-cover' style={{ background: item.cover }} /> : null}
				<div className='bs-title-row'>
					<button type='button' className={`bs-done${item.done ? ' is-on' : ''}`} disabled={!editable} aria-pressed={item.done} aria-label='Terminé' title='Terminé' onClick={() => onPatch(item, { done: !item.done })}>
						<Icon name='check' size={14} />
					</button>
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
				</div>
				{error && (
					<p className='notice notice-error' role='alert'>
						{error}
					</p>
				)}
				<dl className='lst-fields'>
					<div className='lst-field'>
						<dt>
							<Icon name='bookmark' size={14} />
							<span className='ellipsis'>Étiquettes</span>
						</dt>
						<dd className='bs-label-cell'>
							{item.labels.map((id) => {
								const l = list.labels.find((x) => x.id === id);
								return l ? (
									<span key={id} className='bs-label' style={{ '--label': l.color } as CSSProperties}>
										{l.name}
									</span>
								) : null;
							})}
							{editable && (
								<MenuButton label={<Icon name='plus' size={14} />} className='icon-btn icon-btn-sm'>
									{() => (
										<>
											{list.labels.map((l) => (
												<button key={l.id} type='button' role='menuitemcheckbox' aria-checked={item.labels.includes(l.id)} className='menu-item' onClick={() => toggleLabel(l.id)}>
													<span className='bs-swatch' style={{ background: l.color }} />
													<span className='grow'>{l.name}</span>
													{item.labels.includes(l.id) && <Icon name='check' size={14} />}
												</button>
											))}
											<form
												className='lst-menu-form'
												onSubmit={(e) => {
													e.preventDefault();
													void createLabel();
												}}
											>
												<input value={labelName} maxLength={30} placeholder='Nouvelle étiquette' aria-label='Nouvelle étiquette' onChange={(e) => setLabelName(e.target.value)} />
												<button type='submit' className='btn'>
													Créer
												</button>
											</form>
										</>
									)}
								</MenuButton>
							)}
						</dd>
					</div>
					<div className='lst-field'>
						<dt>
							<Icon name='calendar' size={14} />
							<span className='ellipsis'>Dates</span>
						</dt>
						<dd className='bs-dates'>
							<input type='date' className='bs-date' aria-label='Début' value={item.startDate ?? ''} max={item.dueDate ?? undefined} disabled={!editable} onChange={(e) => onPatch(item, { startDate: e.target.value || null })} />
							<span className='muted'>→</span>
							<input type='date' className='bs-date' aria-label='Échéance' value={item.dueDate ?? ''} min={item.startDate ?? undefined} disabled={!editable} onChange={(e) => onPatch(item, { dueDate: e.target.value || null })} />
							<DuePill item={item} />
						</dd>
					</div>
					{list.columns.map((column) => (
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

				{detail?.checklists.map((cl) => <ChecklistBlock key={cl.id} checklist={cl} editable={editable} people={people} myId={myId} call={call} />)}
				{editable && (
					<button type='button' className='btn btn-ghost bs-add-checklist' onClick={() => void call('POST', '/checklists', { title: 'Checklist' })}>
						<Icon name='check' size={14} /> Ajouter une checklist
					</button>
				)}

				<h3 className='lst-section-label'>Document</h3>
				<Suspense fallback={<div className='spinner' aria-busy />}>
					<ItemDoc key={item.id} base={base} workspaceId={workspaceId} item={item} members={members} myId={myId} editable={editable} onError={setError} />
				</Suspense>

				{item.description && (
					<>
						<label className='lst-section-label' htmlFor={`desc-${item.id}`}>
							Description
						</label>
						<textarea
							id={`desc-${item.id}`}
							key={`d${item.id}${item.description}`}
							className='lst-desc'
							rows={3}
							defaultValue={item.description}
							disabled={!editable}
							onBlur={(e) => e.target.value !== item.description && onPatch(item, { description: e.target.value })}
						/>
					</>
				)}

				<h3 className='lst-section-label bs-section-row'>
					Pièces jointes
					{editable && (
						<button type='button' className='btn btn-ghost' onClick={() => fileInput.current?.click()}>
							<Icon name='paperclip' size={14} /> Joindre
						</button>
					)}
				</h3>
				<input ref={fileInput} type='file' multiple hidden onChange={(e) => void attach(e.target.files).then(() => (e.target.value = ''))} />
				<ul className='bs-files'>
					{detail?.files.map((f) => (
						<li key={f.id}>
							{f.type.startsWith('image/') ? <img src={f.url} alt='' className='bs-file-thumb' loading='lazy' /> : <span className='bs-file-thumb'><Icon name='file' size={16} /></span>}
							<a href={f.url} className='ellipsis grow' target='_blank' rel='noreferrer'>
								{f.name}
							</a>
							<span className='muted'>{size(f.size)}</span>
							{editable && f.type.startsWith('image/') && item.cover !== `file:${f.id}` && (
								<button type='button' className='btn btn-ghost' onClick={() => onPatch(item, { cover: `file:${f.id}` })}>
									Couverture
								</button>
							)}
							{editable && (
								<button type='button' className='icon-btn icon-btn-sm' aria-label={`Retirer ${f.name}`} onClick={() => void call('DELETE', `/files/${f.id}`)}>
									<Icon name='trash' size={14} />
								</button>
							)}
						</li>
					))}
					{detail && detail.files.length === 0 && <li className='muted lst-none'>Aucune pièce jointe.</li>}
				</ul>

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
				<h3 className='lst-section-label'>Activité</h3>
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

function ChecklistBlock({ checklist, editable, people, myId, call }: { checklist: Checklist; editable: boolean; people: Member[]; myId: string; call: (method: 'POST' | 'PATCH' | 'DELETE', sub: string, body?: unknown) => Promise<void> }) {
	const [text, setText] = useState('');
	const done = checklist.items.filter((c) => c.done).length;
	const ratio = checklist.items.length ? done / checklist.items.length : 0;
	return (
		<section className='bs-checklist'>
			<header className='bs-checklist-head'>
				<Icon name='check' size={15} />
				<input
					key={checklist.title}
					className='bs-checklist-title'
					defaultValue={checklist.title}
					aria-label='Titre de la checklist'
					disabled={!editable}
					onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== checklist.title && void call('PATCH', `/checklists/${checklist.id}`, { title: e.target.value })}
					onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
				/>
				<span className='muted'>
					{done}/{checklist.items.length}
				</span>
				{editable && (
					<button type='button' className='icon-btn icon-btn-sm' aria-label='Supprimer la checklist' onClick={() => void call('DELETE', `/checklists/${checklist.id}`)}>
						<Icon name='trash' size={14} />
					</button>
				)}
			</header>
			<span className={`bs-progress${ratio === 1 ? ' is-complete' : ''}`} role='progressbar' aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
				<span style={{ width: `${ratio * 100}%` }} />
			</span>
			<ul className='bs-checks'>
				{checklist.items.map((c) => (
					<li key={c.id} className={c.done ? 'is-done' : undefined}>
						<input type='checkbox' checked={c.done} disabled={!editable} aria-label={c.text} onChange={() => void call('PATCH', `/checks/${c.id}`, { done: !c.done })} />
						<input
							key={c.text}
							className='bs-check-text'
							defaultValue={c.text}
							disabled={!editable}
							aria-label='Texte'
							onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== c.text && void call('PATCH', `/checks/${c.id}`, { text: e.target.value })}
							onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
						/>
						<select className='bs-check-who' value={c.assignee ?? ''} disabled={!editable} aria-label='Assigné à' onChange={(e) => void call('PATCH', `/checks/${c.id}`, { assignee: e.target.value || null })}>
							<option value=''>Personne</option>
							{people.map((m) => (
								<option key={m.id} value={m.id}>
									{m.id === myId ? `${m.name} (moi)` : m.name}
								</option>
							))}
						</select>
						<input type='date' className='bs-date bs-check-due' value={c.due ?? ''} disabled={!editable} aria-label='Échéance' onChange={(e) => void call('PATCH', `/checks/${c.id}`, { due: e.target.value || null })} />
						{editable && (
							<button type='button' className='icon-btn icon-btn-sm' aria-label={`Retirer ${c.text}`} onClick={() => void call('DELETE', `/checks/${c.id}`)}>
								<Icon name='close' size={12} />
							</button>
						)}
					</li>
				))}
			</ul>
			{editable && (
				<form
					className='bs-check-add'
					onSubmit={(e) => {
						e.preventDefault();
						if (text.trim()) {
							void call('POST', `/checklists/${checklist.id}/checks`, { text });
							setText('');
						}
					}}
				>
					<input value={text} maxLength={300} placeholder='Ajouter un élément' aria-label='Ajouter un élément' onChange={(e) => setText(e.target.value)} />
				</form>
			)}
		</section>
	);
}
