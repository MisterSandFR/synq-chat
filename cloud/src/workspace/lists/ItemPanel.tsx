import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import {
	CARD_LIMITS,
	CARD_REMINDERS,
	COVER_GRADIENTS,
	LIST_COLUMN_TYPES,
	STATUS_COLORS,
	coverFill,
	type ActivityChange,
	type CardLink,
	type Checklist,
	type ListAttachment,
	type ListColumn,
	type ListDetail,
	type ListItem,
	type ListItemDetail,
	type ListLabel,
	type ListSummary,
} from '../../../shared/lists';
import type { Member } from '../../../shared/types';
import { api, ApiError, upload } from '../../api';
import { navigate } from '../../router';
import { Avatar, Dialog, Icon } from '../../ui';
import { EmojiPicker } from '../chat/EmojiPicker';
import { Cell, TYPE_ICON } from './cells';
import { defaultOptions, MenuButton, newId, type Patch } from './table';
import { coverUrl, DuePill, type CardFocus } from './views';
import './cards.css';

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
	focus: CardFocus | null;
	onPatch: (item: ListItem, patch: Patch) => void;
	onLabels: (labels: ListLabel[]) => Promise<void>;
	onColumns: (columns: ListColumn[]) => Promise<void>;
	onDelete: (item: ListItem) => void;
	onFull: () => void;
	onClose: () => void;
	onFocused: () => void;
	onReload: () => void;
	onOpen: (id: string) => void;
};

type Call = (method: 'POST' | 'PATCH' | 'DELETE' | 'PUT', sub: string, body?: unknown) => Promise<unknown>;

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Action impossible pour le moment.');
const size = (n: number) => (n < 1024 ? `${n} o` : n < 1048576 ? `${Math.round(n / 1024)} Ko` : `${(n / 1048576).toFixed(1)} Mo`);
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function ItemPanel({ base, workspaceId, list, item, members, myId, version, full, focus, onPatch, onLabels, onColumns, onDelete, onFull, onClose, onFocused, onReload, onOpen }: Props) {
	const [detail, setDetail] = useState<ListItemDetail | null>(null);
	const [error, setError] = useState('');
	const [labelName, setLabelName] = useState('');
	const [labelColor, setLabelColor] = useState<string>(STATUS_COLORS[1]);
	const [picker, setPicker] = useState<{ rect: DOMRect; pick: (char: string) => void } | null>(null);
	const [moving, setMoving] = useState(false);
	const [crop, setCrop] = useState<number | null>(null);
	const [dropping, setDropping] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const bannerInput = useRef<HTMLInputElement>(null);
	const dueInput = useRef<HTMLInputElement>(null);
	const labelsBox = useRef<HTMLDivElement>(null);
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

	const call: Call = async (method, sub, body) => {
		try {
			const out = await api(method, `${path}${sub}`, body);
			await refresh();
			return out;
		} catch (e) {
			setError(message(e));
			return null;
		}
	};

	const toggleMember = (id: string) => onPatch(item, { members: item.members.includes(id) ? item.members.filter((m) => m !== id) : [...item.members, id] });
	const run = (target: CardFocus) => {
		if (target === 'dates') {
			dueInput.current?.focus();
		} else if (target === 'labels') {
			labelsBox.current?.querySelector('button')?.click();
		} else if (editable) {
			void call('POST', '/checklists', { title: 'Checklist' });
		}
	};

	useEffect(() => {
		if (focus) {
			run(focus);
			onFocused();
		}
	}, [focus]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey || picker || moving || document.querySelector('.popover, dialog[open]')) {
				return;
			}
			if (e.key === 'Escape') {
				if (typing(e.target)) {
					(e.target as HTMLElement).blur();
				} else {
					onClose();
				}
				return;
			}
			if (typing(e.target)) {
				return;
			}
			const key = e.key.toLowerCase();
			if (key === 'd' || key === 'l' || key === 'c') {
				e.preventDefault();
				run(key === 'd' ? 'dates' : key === 'l' ? 'labels' : 'checklist');
			} else if (key === ' ' && editable) {
				e.preventDefault();
				toggleMember(myId);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [item, editable, picker, moving]);

	const attach = async (files: File[]) => {
		for (const file of files) {
			try {
				await upload<ListAttachment>(`${path}/files`, file);
			} catch (e) {
				setError(message(e));
			}
		}
		await refresh();
	};

	const setBanner = async (file: File) => {
		if (!/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)) {
			setError('La bannière doit être une image PNG, JPEG, GIF, WebP ou AVIF.');
			return;
		}
		if (file.size > CARD_LIMITS.bannerSize) {
			setError('Image trop lourde pour une bannière (10 Mo max).');
			return;
		}
		try {
			const up = await upload<ListAttachment>(`${path}/files`, file);
			onPatch(item, { cover: `file:${up.id}` });
			await refresh();
		} catch (e) {
			setError(message(e));
		}
	};

	const imageOf = (data: DataTransfer | null) => [...(data?.files ?? [])].find((f) => f.type.startsWith('image/'));

	const toggleLabel = (id: string) => onPatch(item, { labels: item.labels.includes(id) ? item.labels.filter((l) => l !== id) : [...item.labels, id] });
	const createLabel = async () => {
		const name = labelName.trim();
		if (!name) {
			return;
		}
		const label = { id: newId(), name, color: labelColor };
		setLabelName('');
		await onLabels([...list.labels, label]);
		onPatch(item, { labels: [...item.labels, label.id] });
	};

	const addProperty = (type: (typeof LIST_COLUMN_TYPES)[number]) =>
		void onColumns([...list.columns, { id: newId(), name: type.label, type: type.id, ...(type.id === 'status' && { options: defaultOptions() }) }]);

	const duplicate = async (body: { template?: boolean } = {}) => {
		try {
			const created = await api<ListItem>('POST', `${path}/duplicate`, body);
			onReload();
			onOpen(created.id);
		} catch (e) {
			setError(message(e));
		}
	};

	const archive = async () => {
		try {
			await api('PATCH', path, { archived: true });
			onReload();
			onClose();
		} catch (e) {
			setError(message(e));
		}
	};

	const cover = coverUrl(workspaceId, list.id, item.cover);
	const fill = coverFill(item.cover);
	const images = detail?.files.filter((f) => /^image\/(png|jpeg|gif|webp|avif)$/.test(f.type)) ?? [];

	// Recadrage : glisser l'image verticalement, comme une couverture Notion.
	const startCrop = (event: ReactPointerEvent<HTMLImageElement>) => {
		if (crop === null) {
			return;
		}
		event.preventDefault();
		const height = event.currentTarget.getBoundingClientRect().height || 1;
		const y0 = event.clientY;
		const from = crop;
		const move = (e: PointerEvent) => setCrop(Math.round(Math.min(100, Math.max(0, from - ((e.clientY - y0) / height) * 100))));
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	};

	const coverMenu = (close: () => void) => (
		<div className='k1-cover-menu'>
			<p className='lst-menu-title'>Affichage</p>
			<div className='k1-seg' role='radiogroup' aria-label='Affichage de la bannière'>
				{(
					[
						['top', 'En haut'],
						['full', 'Pleine carte'],
					] as const
				).map(([mode, label]) => (
					<button key={mode} type='button' role='radio' aria-checked={item.coverMode === mode} onClick={() => onPatch(item, { coverMode: mode })}>
						<span className={`k1-seg-glyph is-${mode}`} aria-hidden />
						{label}
					</button>
				))}
			</div>
			<p className='lst-menu-title'>Couleurs</p>
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
			<p className='lst-menu-title'>Dégradés</p>
			<div className='bs-swatches'>
				{COVER_GRADIENTS.map((g) => (
					<button
						key={g.id}
						type='button'
						className='bs-swatch-btn'
						style={{ background: g.css }}
						aria-label={`Dégradé ${g.label}`}
						title={g.label}
						aria-pressed={item.cover === `grad:${g.id}`}
						onClick={() => {
							onPatch(item, { cover: `grad:${g.id}` });
							close();
						}}
					/>
				))}
			</div>
			<p className='lst-menu-title'>Image</p>
			{images.length > 0 && (
				<div className='k1-cover-thumbs'>
					{images.map((f) => (
						<button
							key={f.id}
							type='button'
							aria-label={f.name}
							title={f.name}
							aria-pressed={item.cover === `file:${f.id}`}
							onClick={() => {
								onPatch(item, { cover: `file:${f.id}` });
								close();
							}}
						>
							<img src={f.url} alt='' loading='lazy' />
						</button>
					))}
				</div>
			)}
			<div className='k1-cover-upload'>
				<button
					type='button'
					className='btn'
					onClick={() => {
						bannerInput.current?.click();
						close();
					}}
				>
					<Icon name='upload' size={14} /> Envoyer une image
				</button>
				<p className='muted'>Ou glisse une image sur la bannière, ou colle-la dans la carte. Recadrage 16:9, 10 Mo max.</p>
			</div>
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
					<Icon name='close' size={14} /> Retirer la bannière
				</button>
			)}
		</div>
	);

	return (
		<aside
			className={`lst-panel bs-panel k1-panel${full ? ' bs-panel-full' : ''}`}
			aria-label='Détail de la carte'
			onPaste={(e) => {
				const image = editable && !typing(e.target) ? imageOf(e.clipboardData) : undefined;
				if (image) {
					e.preventDefault();
					void (item.cover ? attach([image]) : setBanner(image));
				}
			}}
		>
			<header className='lst-panel-head'>
				<span className='muted ellipsis'>{list.title}</span>
				<span className='grow' />
				<button
					type='button'
					className='icon-btn'
					aria-pressed={detail?.following ?? false}
					aria-label={detail?.following ? 'Ne plus suivre' : 'Suivre la carte'}
					title={detail?.following ? 'Tu suis cette carte' : 'Suivre : être notifié des commentaires et changements'}
					onClick={() => void call('PUT', '/follow', { on: !detail?.following })}
				>
					<Icon name='bell' />
				</button>
				{editable && (
					<MenuButton label={<Icon name='image' />} className='icon-btn'>
						{coverMenu}
					</MenuButton>
				)}
				<MenuButton label={<Icon name='more' />} className='icon-btn'>
					{(close) => {
						const act = (fn: () => void) => () => {
							close();
							fn();
						};
						return (
							<>
								{editable && (
									<>
										<button type='button' role='menuitem' className='menu-item' onClick={act(() => void duplicate())}>
											<Icon name='copy' size={14} /> Dupliquer
										</button>
										{item.template && (
											<button type='button' role='menuitem' className='menu-item' onClick={act(() => void duplicate({ template: false }))}>
												<Icon name='plus' size={14} /> Créer une carte depuis ce modèle
											</button>
										)}
										<button type='button' role='menuitem' className='menu-item' onClick={act(() => onPatch(item, { template: !item.template }))}>
											<Icon name='bookmark' size={14} /> {item.template ? 'Retirer des modèles' : 'Enregistrer comme modèle'}
										</button>
										<button type='button' role='menuitem' className='menu-item' onClick={act(() => setMoving(true))}>
											<Icon name='forward' size={14} /> Déplacer vers une autre base
										</button>
									</>
								)}
								<button type='button' role='menuitem' className='menu-item' onClick={act(() => void navigator.clipboard?.writeText(`${location.origin}/w/${workspaceId}/listes/${list.id}?element=${item.id}`))}>
									<Icon name='link' size={14} /> Copier le lien
								</button>
								{editable && item.icon && (
									<button type='button' role='menuitem' className='menu-item' onClick={act(() => onPatch(item, { icon: '' }))}>
										<Icon name='close' size={14} /> Retirer l’icône
									</button>
								)}
								{editable && (
									<>
										<div className='menu-sep' />
										<button type='button' role='menuitem' className='menu-item' onClick={act(() => void archive())}>
											<Icon name='folder' size={14} /> Archiver
										</button>
										<button type='button' role='menuitem' className='menu-item menu-item-danger' onClick={act(() => onDelete(item))}>
											<Icon name='trash' size={14} /> Supprimer
										</button>
									</>
								)}
							</>
						);
					}}
				</MenuButton>
				<button type='button' className='icon-btn' aria-label={full ? 'Réduire en panneau' : 'Ouvrir en pleine page'} title={full ? 'Réduire en panneau' : 'Ouvrir en pleine page'} onClick={onFull}>
					<Icon name={full ? 'chevron-right' : 'expand'} />
				</button>
				<button type='button' className='icon-btn' aria-label='Fermer' title='Fermer (Échap)' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<input ref={bannerInput} type='file' accept='image/png,image/jpeg,image/gif,image/webp,image/avif' hidden onChange={(e) => e.target.files?.[0] && void setBanner(e.target.files[0]).then(() => (e.target.value = ''))} />
			<div
				className={`lst-panel-body k1-body${dropping ? ' is-dropping' : ''}`}
				onDragOver={(e) => {
					if (editable && e.dataTransfer.types.includes('Files')) {
						e.preventDefault();
						setDropping(true);
					}
				}}
				onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
				onDrop={(e) => {
					if (e.dataTransfer.files.length) {
						e.preventDefault();
						setDropping(false);
						void attach([...e.dataTransfer.files]);
					}
				}}
			>
				{(cover || fill) && (
					<div
						className={`k1-banner${crop !== null ? ' is-cropping' : ''}`}
						onDrop={(e) => {
							const image = editable ? imageOf(e.dataTransfer) : undefined;
							if (image) {
								e.preventDefault();
								e.stopPropagation();
								setDropping(false);
								void setBanner(image);
							}
						}}
					>
						{cover ? <img src={cover} alt='' draggable={false} style={{ objectPosition: `50% ${crop ?? item.coverY}%` }} onPointerDown={startCrop} /> : <span className='k1-banner-fill' style={{ background: fill ?? undefined }} />}
						{editable && (
							<span className='k1-banner-actions'>
								{crop !== null ? (
									<>
										<span className='k1-banner-hint'>Glisse l’image pour la recadrer</span>
										<button
											type='button'
											className='btn btn-primary'
											onClick={() => {
												onPatch(item, { coverY: crop });
												setCrop(null);
											}}
										>
											Enregistrer
										</button>
										<button type='button' className='btn' onClick={() => setCrop(null)}>
											Annuler
										</button>
									</>
								) : (
									<>
										<MenuButton label='Changer' className='btn k1-banner-btn'>
											{coverMenu}
										</MenuButton>
										{cover && (
											<button type='button' className='btn k1-banner-btn' onClick={() => setCrop(item.coverY)}>
												Recadrer
											</button>
										)}
									</>
								)}
							</span>
						)}
					</div>
				)}
				<div className='k1-head'>
					<button
						type='button'
						className={`k1-icon-btn${item.icon ? ' has-icon' : ''}`}
						disabled={!editable}
						aria-label={item.icon ? 'Changer l’icône' : 'Ajouter une icône'}
						title={item.icon ? 'Changer l’icône' : 'Ajouter une icône'}
						onClick={(e) => setPicker({ rect: e.currentTarget.getBoundingClientRect(), pick: (char) => onPatch(item, { icon: char }) })}
					>
						{item.icon || <Icon name='smile-plus' size={18} />}
					</button>
					<textarea
						key={`t${item.id}${item.title}`}
						className='lst-panel-title k1-title'
						rows={1}
						defaultValue={item.title}
						placeholder='Sans titre'
						disabled={!editable}
						aria-label='Titre'
						onBlur={(e) => e.target.value.trim() !== item.title && onPatch(item, { title: e.target.value })}
						onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
					/>
					<button type='button' className={`k1-done${item.done ? ' is-on' : ''}`} disabled={!editable} aria-pressed={item.done} onClick={() => onPatch(item, { done: !item.done })}>
						<Icon name='check' size={14} /> {item.done ? 'Terminée' : 'Marquer terminée'}
					</button>
				</div>
				{item.template && (
					<p className='notice k1-notice'>
						<Icon name='bookmark' size={14} /> Modèle de carte : il sert de point de départ aux nouvelles cartes.
						{editable && (
							<button type='button' className='btn' onClick={() => void duplicate({ template: false })}>
								Créer une carte
							</button>
						)}
					</p>
				)}
				{error && (
					<p className='notice notice-error' role='alert'>
						{error}
						<button type='button' className='icon-btn icon-btn-sm' aria-label='Fermer' onClick={() => setError('')}>
							<Icon name='close' size={14} />
						</button>
					</p>
				)}
				<dl className='lst-fields k1-fields'>
					<div className='lst-field'>
						<dt>
							<Icon name='bookmark' size={14} />
							<span className='ellipsis'>Étiquettes</span>
						</dt>
						<dd className='bs-label-cell' ref={labelsBox}>
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
												className='k1-label-form'
												onSubmit={(e) => {
													e.preventDefault();
													void createLabel();
												}}
											>
												<input value={labelName} maxLength={30} placeholder='Nouvelle étiquette' aria-label='Nouvelle étiquette' onChange={(e) => setLabelName(e.target.value)} />
												<span className='k1-label-colors' role='radiogroup' aria-label='Couleur'>
													{STATUS_COLORS.map((color) => (
														<button key={color} type='button' role='radio' aria-checked={labelColor === color} aria-label={`Couleur ${color}`} style={{ background: color }} onClick={() => setLabelColor(color)} />
													))}
												</span>
												<button type='submit' className='btn' disabled={!labelName.trim()}>
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
							<Icon name='users' size={14} />
							<span className='ellipsis'>Membres</span>
						</dt>
						<dd className='k1-members'>
							{item.members.map((id) => (
								<span key={id} className='k1-member' title={members.get(id)?.name ?? 'Ancien membre'}>
									<Avatar name={members.get(id)?.name ?? '?'} url={members.get(id)?.avatarUrl} size={24} />
								</span>
							))}
							{editable && (
								<MenuButton label={<Icon name='user-plus' size={14} />} className='icon-btn icon-btn-sm'>
									{() => (
										<div className='k1-member-menu'>
											{people.map((m) => (
												<button key={m.id} type='button' role='menuitemcheckbox' aria-checked={item.members.includes(m.id)} className='menu-item' onClick={() => toggleMember(m.id)}>
													<Avatar name={m.name} url={m.avatarUrl} size={20} />
													<span className='grow ellipsis'>{m.id === myId ? `${m.name} (moi)` : m.name}</span>
													{item.members.includes(m.id) && <Icon name='check' size={14} />}
												</button>
											))}
										</div>
									)}
								</MenuButton>
							)}
							{item.members.length === 0 && !editable && <span className='muted'>Personne</span>}
						</dd>
					</div>
					<div className='lst-field'>
						<dt>
							<Icon name='calendar' size={14} />
							<span className='ellipsis'>Dates</span>
						</dt>
						<dd className='bs-dates k1-dates'>
							<span className='k1-when'>
								<input type='date' className='bs-date' aria-label='Début' value={item.startDate ?? ''} max={item.dueDate ?? undefined} disabled={!editable} onChange={(e) => onPatch(item, { startDate: e.target.value || null })} />
								{item.startDate && <input type='time' className='bs-date k1-time' aria-label='Heure de début' value={item.startTime ?? ''} disabled={!editable} onChange={(e) => onPatch(item, { startTime: e.target.value || null })} />}
							</span>
							<span className='muted'>→</span>
							<span className='k1-when'>
								<input ref={dueInput} type='date' className='bs-date' aria-label='Échéance' value={item.dueDate ?? ''} min={item.startDate ?? undefined} disabled={!editable} onChange={(e) => onPatch(item, { dueDate: e.target.value || null })} />
								{item.dueDate && <input type='time' className='bs-date k1-time' aria-label='Heure d’échéance' value={item.dueTime ?? ''} disabled={!editable} onChange={(e) => onPatch(item, { dueTime: e.target.value || null })} />}
							</span>
							<DuePill item={item} />
						</dd>
					</div>
					<div className='lst-field'>
						<dt>
							<Icon name='bell' size={14} />
							<span className='ellipsis'>Rappel</span>
						</dt>
						<dd>
							<select className='k1-select' value={item.reminder ?? ''} disabled={!editable || !item.dueDate} aria-label='Rappel' title={item.dueDate ? undefined : 'Choisis d’abord une échéance'} onChange={(e) => onPatch(item, { reminder: (e.target.value || null) as Patch['reminder'] })}>
								<option value=''>{item.dueDate ? 'Aucun rappel' : 'Sans échéance'}</option>
								{CARD_REMINDERS.map((r) => (
									<option key={r.id} value={r.id}>
										{r.label}
									</option>
								))}
							</select>
						</dd>
					</div>
					<div className='lst-field'>
						<dt>
							<Icon name='clock' size={14} />
							<span className='ellipsis'>Estimation</span>
						</dt>
						<dd className='k1-estimate'>
							<input
								key={`e${item.estimate}`}
								type='number'
								min={0}
								step='0.5'
								className='k1-number'
								defaultValue={item.estimate ?? ''}
								placeholder='—'
								aria-label='Estimation'
								disabled={!editable}
								onBlur={(e) => {
									const value = e.target.value === '' ? null : Number(e.target.value);
									if (value !== item.estimate && (value === null || Number.isFinite(value))) {
										onPatch(item, { estimate: value });
									}
								}}
							/>
							<select className='k1-select' value={item.estimateUnit} disabled={!editable} aria-label='Unité' onChange={(e) => onPatch(item, { estimateUnit: e.target.value as 'pts' | 'h' })}>
								<option value='pts'>points</option>
								<option value='h'>heures</option>
							</select>
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
				{editable && (
					<MenuButton label='Ajouter une propriété' icon='plus' className='btn btn-ghost k1-add-prop'>
						{(close) => (
							<>
								<p className='lst-menu-title'>Type de propriété</p>
								{LIST_COLUMN_TYPES.map((t) => (
									<button
										key={t.id}
										type='button'
										role='menuitem'
										className='menu-item'
										onClick={() => {
											close();
											addProperty(t);
										}}
									>
										<Icon name={TYPE_ICON[t.id]} size={14} /> {t.label}
									</button>
								))}
							</>
						)}
					</MenuButton>
				)}

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

				{detail?.checklists.map((cl) => <ChecklistBlock key={cl.id} checklist={cl} editable={editable} people={people} myId={myId} call={call} onConverted={onReload} />)}
				{editable && (
					<button type='button' className='btn btn-ghost bs-add-checklist' onClick={() => void call('POST', '/checklists', { title: 'Checklist' })}>
						<Icon name='check' size={14} /> Ajouter une checklist
					</button>
				)}

				<h3 className='lst-section-label'>Document</h3>
				<Suspense fallback={<div className='spinner' aria-busy />}>
					<ItemDoc key={item.id} base={base} workspaceId={workspaceId} item={item} members={members} myId={myId} editable={editable} onError={setError} />
				</Suspense>

				<h3 className='lst-section-label bs-section-row'>
					Liens
					{editable && (
						<MenuButton label='Lier' icon='link' className='btn btn-ghost'>
							{(close) => (
								<LinkPicker
									path={path}
									onPick={async (target) => {
										close();
										await call('POST', '/links', { kind: target.kind, id: target.id });
									}}
								/>
							)}
						</MenuButton>
					)}
				</h3>
				<ul className='k1-links'>
					{detail?.links.map((l) => (
						<li key={`${l.kind}${l.id}`}>
							<button
								type='button'
								className='k1-link'
								onClick={() => (l.kind === 'page' ? navigate(`/w/${workspaceId}/pages/${l.id}`) : l.listId === list.id ? onOpen(l.id) : navigate(`/w/${workspaceId}/listes/${l.listId}?element=${l.id}`))}
							>
								<span className='k1-link-icon'>{l.icon || <Icon name={l.kind === 'page' ? 'file' : 'copy'} size={14} />}</span>
								<span className={`ellipsis${l.done ? ' k1-struck' : ''}`}>{l.title || 'Sans titre'}</span>
								<span className='muted ellipsis'>{l.kind === 'page' ? 'Page' : l.listTitle}</span>
							</button>
							{editable && (
								<button type='button' className='icon-btn icon-btn-sm' aria-label={`Retirer le lien vers ${l.title}`} onClick={() => void call('DELETE', `/links/${l.kind}/${l.id}`)}>
									<Icon name='close' size={12} />
								</button>
							)}
						</li>
					))}
					{detail && detail.links.length === 0 && <li className='muted lst-none'>Aucune carte ni page liée.</li>}
				</ul>

				<h3 className='lst-section-label bs-section-row'>
					Pièces jointes
					{editable && (
						<button type='button' className='btn btn-ghost' onClick={() => fileInput.current?.click()}>
							<Icon name='paperclip' size={14} /> Joindre
						</button>
					)}
				</h3>
				<input ref={fileInput} type='file' multiple hidden onChange={(e) => void attach([...(e.target.files ?? [])]).then(() => (e.target.value = ''))} />
				<ul className='k1-files'>
					{detail?.files.map((f) => {
						const image = /^image\/(png|jpeg|gif|webp|avif)$/.test(f.type);
						return (
							<li key={f.id} className='k1-file'>
								<a href={f.url} className='k1-file-thumb' target='_blank' rel='noreferrer' aria-label={`Ouvrir ${f.name}`}>
									{image ? <img src={f.url} alt='' loading='lazy' /> : <Icon name='file' size={22} />}
									{item.cover === `file:${f.id}` && <span className='k1-file-flag'>Bannière</span>}
								</a>
								<span className='k1-file-meta'>
									<a href={f.url} className='ellipsis' target='_blank' rel='noreferrer'>
										{f.name}
									</a>
									<span className='muted'>
										{size(f.size)} · {when.format(f.createdAt)}
									</span>
								</span>
								{editable && (
									<span className='k1-file-actions'>
										{image && item.cover !== `file:${f.id}` && f.size <= CARD_LIMITS.bannerSize && (
											<button type='button' className='btn btn-ghost' onClick={() => onPatch(item, { cover: `file:${f.id}` })}>
												En bannière
											</button>
										)}
										<button type='button' className='icon-btn icon-btn-sm' aria-label={`Retirer ${f.name}`} onClick={() => void call('DELETE', `/files/${f.id}`)}>
											<Icon name='trash' size={14} />
										</button>
									</span>
								)}
							</li>
						);
					})}
					{detail && detail.files.length === 0 && <li className='muted lst-none k1-drop-hint'>Glisse des fichiers ici pour les joindre.</li>}
				</ul>

				<h3 className='lst-section-label'>Commentaires</h3>
				<ul className='lst-comments'>
					{detail?.comments.map((c) => {
						const author = members.get(c.userId);
						return (
							<li key={c.id}>
								<Avatar name={author?.name ?? '?'} url={author?.avatarUrl} size={28} />
								<div className='grow'>
									<p className='lst-comment-meta'>
										<strong>{author?.name ?? 'Ancien membre'}</strong> <span className='muted'>{when.format(c.createdAt)}</span>
									</p>
									<p className='lst-comment-body'>
										<CommentBody body={c.body} names={people.map((m) => m.name)} />
									</p>
									<span className='k1-reactions'>
										{c.reactions.map((r) => (
											<button
												key={r.emoji}
												type='button'
												className='k1-reaction'
												aria-pressed={r.users.includes(myId)}
												disabled={!editable}
												title={r.users.map((id) => members.get(id)?.name ?? 'Ancien membre').join(', ')}
												onClick={() => void call('POST', `/comments/${c.id}/reactions`, { emoji: r.emoji })}
											>
												{r.emoji} <span>{r.users.length}</span>
											</button>
										))}
										{editable && (
											<button
												type='button'
												className='icon-btn icon-btn-sm k1-react-add'
												aria-label='Ajouter une réaction'
												onClick={(e) => setPicker({ rect: e.currentTarget.getBoundingClientRect(), pick: (emoji) => void call('POST', `/comments/${c.id}/reactions`, { emoji }) })}
											>
												<Icon name='smile-plus' size={14} />
											</button>
										)}
									</span>
								</div>
							</li>
						);
					})}
					{detail && detail.comments.length === 0 && <li className='muted lst-none'>Pas encore de commentaire.</li>}
				</ul>
				{editable && <CommentBox members={people} onSend={async (body, mentions) => void (await call('POST', '/comments', { body, mentions }))} />}

				<h3 className='lst-section-label'>Activité</h3>
				<ul className='lst-history k1-history'>
					{detail?.activity.map((a) => (
						<li key={a.id}>
							<span>
								<strong>{members.get(a.userId)?.name ?? 'Ancien membre'}</strong> {a.action} <span className='muted'>· {when.format(a.createdAt)}</span>
							</span>
							{a.changes.length > 0 && (
								<ul className='k1-changes'>
									{a.changes.map((ch, i) => (
										<li key={i}>
											<span className='muted'>{ch.field}</span>
											{(ch.from !== null || ch.to !== null) && (
												<>
													<ChangeValue change={ch} value={ch.from} members={members} />
													<span className='muted' aria-label='devient'>
														→
													</span>
													<ChangeValue change={ch} value={ch.to} members={members} />
												</>
											)}
										</li>
									))}
								</ul>
							)}
						</li>
					))}
				</ul>
				<p className='muted k1-keys'>
					Raccourcis : <kbd>D</kbd> dates, <kbd>L</kbd> étiquettes, <kbd>C</kbd> checklist, <kbd>Espace</kbd> m’attribuer, <kbd>Échap</kbd> fermer.
				</p>
			</div>
			{picker && (
				<EmojiPicker
					anchor={picker.rect}
					onPick={(char) => {
						picker.pick(char);
						setPicker(null);
					}}
					onClose={() => setPicker(null)}
				/>
			)}
			{moving && <MoveDialog workspaceId={workspaceId} path={path} list={list} item={item} onClose={() => setMoving(false)} />}
		</aside>
	);
}

function ChangeValue({ change, value, members }: { change: ActivityChange; value: string | null; members: Map<string, Member> }) {
	if (value === null) {
		return <span className='k1-change-val is-empty'>vide</span>;
	}
	const text = change.kind === 'people' ? value.split(',').map((id) => members.get(id)?.name ?? 'Ancien membre').join(', ') : value;
	return <span className='k1-change-val'>{text}</span>;
}

function CommentBody({ body, names }: { body: string; names: string[] }) {
	const sorted = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length);
	if (!sorted.length) {
		return <>{body}</>;
	}
	const parts = body.split(new RegExp(`(@(?:${sorted.map(escapeRe).join('|')}))`, 'g'));
	return <>{parts.map((part, i) => (i % 2 ? <span key={i} className='k1-mention'>{part}</span> : part))}</>;
}

const MENTION_RE = /(^|\s)@([\p{L}\p{N}_-]{0,30})$/u;

function CommentBox({ members, onSend }: { members: Member[]; onSend: (body: string, mentions: string[]) => Promise<void> }) {
	const [text, setText] = useState('');
	const [query, setQuery] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	const matches = query === null ? [] : members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
	const pick = (m: Member) => {
		const el = ref.current!;
		const caret = el.selectionStart;
		const before = text.slice(0, caret).replace(/@[\p{L}\p{N}_-]*$/u, `@${m.name} `);
		setText(before + text.slice(caret));
		setQuery(null);
		requestAnimationFrame(() => {
			el.focus();
			el.setSelectionRange(before.length, before.length);
		});
	};
	const send = async () => {
		if (!text.trim() || sending) {
			return;
		}
		setSending(true);
		try {
			await onSend(
				text,
				members.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id),
			);
			setText('');
		} finally {
			setSending(false);
		}
	};
	return (
		<div className='lst-comment-box k1-comment-box'>
			<textarea
				ref={ref}
				rows={2}
				value={text}
				placeholder='Écrire un commentaire, @ pour mentionner'
				aria-label='Commentaire'
				onChange={(e) => {
					setText(e.target.value);
					const m = MENTION_RE.exec(e.target.value.slice(0, e.target.selectionStart));
					setQuery(m ? m[2]! : null);
				}}
				onKeyDown={(e) => {
					if (matches.length && (e.key === 'Enter' || e.key === 'Tab')) {
						e.preventDefault();
						pick(matches[0]!);
					} else if (e.key === 'Escape' && query !== null) {
						e.stopPropagation();
						setQuery(null);
					} else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
						void send();
					}
				}}
			/>
			{matches.length > 0 && (
				<ul className='k1-mentions' role='listbox' aria-label='Mentionner'>
					{matches.map((m) => (
						<li key={m.id}>
							<button
								type='button'
								role='option'
								aria-selected={false}
								onMouseDown={(e) => {
									e.preventDefault();
									pick(m);
								}}
							>
								<Avatar name={m.name} url={m.avatarUrl} size={20} /> {m.name}
							</button>
						</li>
					))}
				</ul>
			)}
			<button type='button' className='btn btn-primary' disabled={!text.trim() || sending} onClick={() => void send()}>
				Commenter
			</button>
		</div>
	);
}

function LinkPicker({ path, onPick }: { path: string; onPick: (target: CardLink) => void }) {
	const [query, setQuery] = useState('');
	const [results, setResults] = useState<CardLink[] | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		const timer = setTimeout(() => {
			api<CardLink[]>('GET', `${path}/link-targets?q=${encodeURIComponent(query)}`, undefined, controller.signal)
				.then(setResults)
				.catch(() => undefined);
		}, 180);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [query]);
	return (
		<div className='k1-link-picker'>
			<input autoFocus value={query} placeholder='Chercher une carte ou une page' aria-label='Chercher une carte ou une page' onChange={(e) => setQuery(e.target.value)} />
			{results?.map((r) => (
				<button key={`${r.kind}${r.id}`} type='button' role='menuitem' className='menu-item' onClick={() => onPick(r)}>
					<span className='k1-link-icon'>{r.icon || <Icon name={r.kind === 'page' ? 'file' : 'copy'} size={14} />}</span>
					<span className='grow ellipsis'>{r.title || 'Sans titre'}</span>
					<span className='muted ellipsis'>{r.kind === 'page' ? 'Page' : r.listTitle}</span>
				</button>
			))}
			{results && results.length === 0 && <p className='muted k1-link-none'>Aucun résultat.</p>}
		</div>
	);
}

function MoveDialog({ workspaceId, path, list, item, onClose }: { workspaceId: string; path: string; list: ListDetail; item: ListItem; onClose: () => void }) {
	const [bases, setBases] = useState<ListSummary[] | null>(null);
	const [target, setTarget] = useState('');
	const [error, setError] = useState('');
	useEffect(() => {
		api<ListSummary[]>('GET', `/w/${workspaceId}/lists`)
			.then((all) => setBases(all.filter((b) => b.id !== list.id)))
			.catch((e) => setError(message(e)));
	}, []);
	const submit = async () => {
		try {
			await api('POST', `${path}/move`, { listId: target });
			onClose();
			navigate(`/w/${workspaceId}/listes/${target}?element=${item.id}`);
		} catch (e) {
			setError(message(e));
		}
	};
	return (
		<Dialog open onClose={onClose} title='Déplacer la carte'>
			<div className='stack'>
				<p className='muted'>Commentaires, checklists, pièces jointes et document suivent la carte. Les valeurs sans colonne équivalente dans la base choisie ne suivent pas.</p>
				<label className='field'>
					<span>Base de destination</span>
					<select value={target} onChange={(e) => setTarget(e.target.value)} disabled={!bases}>
						<option value=''>{bases ? (bases.length ? 'Choisir une base' : 'Aucune autre base') : 'Chargement…'}</option>
						{bases?.map((b) => (
							<option key={b.id} value={b.id}>
								{b.title}
							</option>
						))}
					</select>
				</label>
				{error && (
					<p className='notice notice-error' role='alert'>
						{error}
					</p>
				)}
				<div className='lst-actions'>
					<button type='button' className='btn btn-ghost' onClick={onClose}>
						Annuler
					</button>
					<button type='button' className='btn btn-primary' disabled={!target} onClick={() => void submit()}>
						Déplacer
					</button>
				</div>
			</div>
		</Dialog>
	);
}

export function ArchiveDialog({ base, list, onClose, onRestored }: { base: string; list: ListDetail; onClose: () => void; onRestored: () => void }) {
	const [items, setItems] = useState<ListItem[] | null>(null);
	const [error, setError] = useState('');
	const load = () =>
		api<ListItem[]>('GET', `${base}/archived`)
			.then(setItems)
			.catch((e) => setError(message(e)));
	useEffect(() => {
		void load();
	}, [base]);
	const act = async (method: 'PATCH' | 'DELETE', item: ListItem) => {
		try {
			await api(method, `${base}/items/${item.id}`, method === 'PATCH' ? { archived: false } : undefined);
			await load();
			onRestored();
		} catch (e) {
			setError(message(e));
		}
	};
	return (
		<Dialog open onClose={onClose} title='Cartes archivées'>
			<div className='stack'>
				{error && (
					<p className='notice notice-error' role='alert'>
						{error}
					</p>
				)}
				{!items && <div className='spinner' aria-busy />}
				{items?.length === 0 && <p className='muted'>Aucune carte archivée. Archiver une carte la retire des vues sans la supprimer.</p>}
				<ul className='k1-archive'>
					{items?.map((item) => (
						<li key={item.id}>
							<span className='k1-link-icon'>{item.icon || <Icon name='copy' size={14} />}</span>
							<span className='grow ellipsis'>{item.title || 'Sans titre'}</span>
							<span className='muted hide-mobile'>{item.archivedAt ? when.format(item.archivedAt) : ''}</span>
							{list.canEdit && (
								<>
									<button type='button' className='btn' onClick={() => void act('PATCH', item)}>
										Restaurer
									</button>
									<button type='button' className='icon-btn icon-btn-sm' aria-label={`Supprimer ${item.title}`} onClick={() => void act('DELETE', item)}>
										<Icon name='trash' size={14} />
									</button>
								</>
							)}
						</li>
					))}
				</ul>
			</div>
		</Dialog>
	);
}

function ChecklistBlock({ checklist, editable, people, myId, call, onConverted }: { checklist: Checklist; editable: boolean; people: Member[]; myId: string; call: Call; onConverted: () => void }) {
	const [text, setText] = useState('');
	const [drag, setDrag] = useState<string | null>(null);
	const done = checklist.items.filter((c) => c.done).length;
	const ratio = checklist.items.length ? done / checklist.items.length : 0;
	const drop = (before: string) => {
		const items = checklist.items.filter((c) => c.id !== drag);
		const index = items.findIndex((c) => c.id === before);
		const moved = drag;
		setDrag(null);
		if (!moved || index < 0) {
			return;
		}
		const prev = items[index - 1];
		const next = items[index]!;
		void call('PATCH', `/checks/${moved}`, { position: prev ? (prev.position + next.position) / 2 : next.position - 1 });
	};
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
					<li
						key={c.id}
						className={`${c.done ? 'is-done' : ''}${drag === c.id ? ' is-dragging' : ''}`}
						onDragOver={(e) => drag && e.preventDefault()}
						onDrop={(e) => {
							e.preventDefault();
							e.stopPropagation();
							drop(c.id);
						}}
					>
						{editable && (
							<span
								className='k1-grip'
								draggable
								aria-label='Glisser pour réordonner'
								title='Glisser pour réordonner'
								onDragStart={(e) => {
									e.dataTransfer.effectAllowed = 'move';
									e.dataTransfer.setData('text/plain', c.id);
									setDrag(c.id);
								}}
								onDragEnd={() => setDrag(null)}
							>
								<Icon name='menu' size={12} />
							</span>
						)}
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
							<>
								<button type='button' className='icon-btn icon-btn-sm' aria-label={`Convertir « ${c.text} » en carte`} title='Convertir en carte' onClick={() => void call('POST', `/checks/${c.id}/convert`).then(onConverted)}>
									<Icon name='forward' size={12} />
								</button>
								<button type='button' className='icon-btn icon-btn-sm' aria-label={`Retirer ${c.text}`} onClick={() => void call('DELETE', `/checks/${c.id}`)}>
									<Icon name='close' size={12} />
								</button>
							</>
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
