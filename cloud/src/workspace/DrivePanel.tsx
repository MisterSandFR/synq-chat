import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';

import { Floating } from '../floating';
import { P, has } from '../../shared/permissions';
import { LIMITS, type Channel, type DriveFile, type DriveFolder, type DriveListing, type Member } from '../../shared/types';
import { api, errorText, fileUrl, upload } from '../api';
import { Icon, fileIcon, formatSize, useDismiss } from '../ui';

const date = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

type Props = {
	workspaceId: string;
	channel: Channel;
	version: number;
	members: Map<string, Member>;
	myId: string;
	perms: number;
	onClose: () => void;
};

export function DrivePanel({ workspaceId, channel, version, members, myId, perms, onClose }: Props) {
	const [folderId, setFolderId] = useState<string | null>(null);
	const [listing, setListing] = useState<DriveListing | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [uploads, setUploads] = useState<Array<{ name: string; ratio: number }>>([]);
	const [dragging, setDragging] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const canWrite = has(perms, P.DRIVE_UPLOAD);
	const canManage = has(perms, P.DRIVE_MANAGE);

	useEffect(() => setFolderId(null), [channel.id]);

	const load = useCallback(async () => {
		try {
			setListing(await api<DriveListing>('GET', `/w/${workspaceId}/channels/${channel.id}/drive${folderId ? `?folder=${folderId}` : ''}`));
			setError(null);
		} catch (err) {
			setError(errorText(err));
			if (folderId) {
				setFolderId(null);
			}
		}
	}, [workspaceId, channel.id, folderId]);

	useEffect(() => {
		void load();
	}, [load, version]);

	const run = async (task: () => Promise<unknown>) => {
		try {
			await task();
			await load();
		} catch (err) {
			setError(errorText(err));
		}
	};

	const sendFiles = async (files: File[]) => {
		const target = folderId;
		for (const file of files) {
			if (file.size > LIMITS.fileSize) {
				setError(`${file.name} dépasse 50 Mo.`);
				continue;
			}
			setUploads((list) => [...list, { name: file.name, ratio: 0 }]);
			try {
				await upload<DriveFile>(`/w/${workspaceId}/channels/${channel.id}/drive/files${target ? `?folder=${target}` : ''}`, file, (ratio) =>
					setUploads((list) => list.map((u) => (u.name === file.name ? { ...u, ratio } : u))),
				);
			} catch (err) {
				setError(errorText(err));
			} finally {
				setUploads((list) => list.filter((u) => u.name !== file.name));
			}
		}
		await load();
	};

	const onDrop = (event: DragEvent) => {
		event.preventDefault();
		setDragging(false);
		if (canWrite && event.dataTransfer.files.length) {
			void sendFiles([...event.dataTransfer.files]);
		}
	};

	const newFolder = () => {
		const name = window.prompt('Nom du dossier');
		if (name?.trim()) {
			void run(() => api('POST', `/w/${workspaceId}/channels/${channel.id}/drive/folders`, { name, parentId: folderId }));
		}
	};

	const parentOf = listing?.path.at(-2)?.id ?? null;

	return (
		<aside className='side-panel' aria-label={`Fichiers de ${channel.name}`}>
			<header className='side-panel-head'>
				<h2>Fichiers</h2>
				{canWrite && (
					<>
						<button type='button' className='icon-btn' aria-label='Nouveau dossier' title='Nouveau dossier' onClick={newFolder}>
							<Icon name='folder-plus' />
						</button>
						<button type='button' className='icon-btn' aria-label='Importer des fichiers' title='Importer des fichiers' onClick={() => fileInput.current?.click()}>
							<Icon name='upload' />
						</button>
						<input
							ref={fileInput}
							type='file'
							multiple
							hidden
							onChange={(e) => {
								const files = [...(e.target.files ?? [])];
								e.target.value = '';
								void sendFiles(files);
							}}
						/>
					</>
				)}
				<button type='button' className='icon-btn' aria-label='Fermer les fichiers' onClick={onClose}>
					<Icon name='close' />
				</button>
			</header>
			<div
				className={`side-panel-body${dragging ? ' drive-drop' : ''}`}
				onDragOver={(e) => {
					if (canWrite && e.dataTransfer.types.includes('Files')) {
						e.preventDefault();
						setDragging(true);
					}
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
			>
				<nav className='drive-crumbs' aria-label='Dossier courant'>
					<button type='button' className='crumb' aria-current={folderId === null ? 'page' : undefined} onClick={() => setFolderId(null)}>
						{channel.kind === 'voice' ? channel.name : `#${channel.name}`}
					</button>
					{listing?.path.map((folder) => (
						<span key={folder.id} className='row' style={{ gap: 2 }}>
							<Icon name='chevron-right' size={14} />
							<button type='button' className='crumb' aria-current={folder.id === folderId ? 'page' : undefined} onClick={() => setFolderId(folder.id)}>
								{folder.name}
							</button>
						</span>
					))}
				</nav>
				{error && (
					<p className='notice notice-error' role='alert' style={{ marginBottom: 8 }}>
						{error}
					</p>
				)}
				{uploads.map((u) => (
					<p key={u.name} className='drive-upload-progress'>
						Envoi de {u.name} : {Math.round(u.ratio * 100)} %
					</p>
				))}
				{!listing ? (
					<div className='spinner' aria-busy />
				) : listing.folders.length === 0 && listing.files.length === 0 ? (
					<p className='drive-empty'>{canWrite ? 'Aucun fichier. Glisse des fichiers ici ou importe-les.' : 'Aucun fichier.'}</p>
				) : (
					<ul className='list'>
						{listing.folders.map((folder) => (
							<FolderRow
								key={folder.id}
								folder={folder}
								canEdit={canManage || folder.createdBy === myId}
								onOpen={() => setFolderId(folder.id)}
								onRename={(name) => run(() => api('PATCH', `/w/${workspaceId}/drive/folders/${folder.id}`, { name }))}
								onDelete={() => run(() => api('DELETE', `/w/${workspaceId}/drive/folders/${folder.id}`))}
							/>
						))}
						{listing.files.map((file) => (
							<FileRow
								key={file.id}
								workspaceId={workspaceId}
								file={file}
								uploader={members.get(file.uploadedBy)?.name ?? 'Ancien membre'}
								canEdit={canManage || file.uploadedBy === myId}
								canMoveUp={folderId !== null}
								onRename={(name) => run(() => api('PATCH', `/w/${workspaceId}/drive/files/${file.id}`, { name }))}
								onMoveUp={() => run(() => api('PATCH', `/w/${workspaceId}/drive/files/${file.id}`, { folderId: parentOf }))}
								onDelete={() => run(() => api('DELETE', `/w/${workspaceId}/drive/files/${file.id}`))}
							/>
						))}
					</ul>
				)}
			</div>
		</aside>
	);
}

function ItemMenu({ label, items }: { label: string; items: Array<{ label: string; danger?: boolean; onSelect: () => void }> }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));
	return (
		<div ref={ref} style={{ position: 'relative' }}>
			<button type='button' className='icon-btn icon-btn-sm' aria-label={label} aria-haspopup='menu' aria-expanded={open} onClick={() => setOpen(!open)}>
				<Icon name='more' size={16} />
			</button>
			{open && (
				<Floating anchor={ref} placement='bottom-end' className='popover' role='menu' style={{ minWidth: 190 }}>
					{items.map((item) => (
						<button
							key={item.label}
							type='button'
							role='menuitem'
							className={`menu-item${item.danger ? ' menu-item-danger' : ''}`}
							onClick={() => {
								setOpen(false);
								item.onSelect();
							}}
						>
							{item.label}
						</button>
					))}
				</Floating>
			)}
		</div>
	);
}

function FolderRow({ folder, canEdit, onOpen, onRename, onDelete }: { folder: DriveFolder; canEdit: boolean; onOpen: () => void; onRename: (name: string) => void; onDelete: () => void }) {
	return (
		<li className='drive-item'>
			<button type='button' className='drive-item-main' onClick={onOpen}>
				<span className='file-icon'>
					<Icon name='folder' />
				</span>
				<span className='file-meta'>
					<span>{folder.name}</span>
					<span>Dossier</span>
				</span>
			</button>
			{canEdit && (
				<ItemMenu
					label={`Actions pour ${folder.name}`}
					items={[
						{
							label: 'Renommer',
							onSelect: () => {
								const name = window.prompt('Nouveau nom', folder.name);
								if (name?.trim()) {
									onRename(name);
								}
							},
						},
						{ label: 'Supprimer le dossier', danger: true, onSelect: () => window.confirm(`Supprimer « ${folder.name} » et tout son contenu ?`) && onDelete() },
					]}
				/>
			)}
		</li>
	);
}

type FileRowProps = {
	workspaceId: string;
	file: DriveFile;
	uploader: string;
	canEdit: boolean;
	canMoveUp: boolean;
	onRename: (name: string) => void;
	onMoveUp: () => void;
	onDelete: () => void;
};

function FileRow({ workspaceId, file, uploader, canEdit, canMoveUp, onRename, onMoveUp, onDelete }: FileRowProps) {
	const url = fileUrl(workspaceId, file.key);
	const viewable = /^(image|video|audio)\//.test(file.type);
	return (
		<li className='drive-item'>
			<a className='drive-item-main' href={url} {...(viewable ? { target: '_blank', rel: 'noopener noreferrer' } : { download: file.name })}>
				<span className='file-icon'>
					<Icon name={fileIcon(file.type)} />
				</span>
				<span className='file-meta'>
					<span title={file.name}>{file.name}</span>
					<span>
						{formatSize(file.size)}, {uploader}, {date.format(file.createdAt)}
					</span>
				</span>
			</a>
			<ItemMenu
				label={`Actions pour ${file.name}`}
				items={[
					{ label: 'Télécharger', onSelect: () => window.open(url, '_blank', 'noopener') },
					...(canEdit
						? [
								{
									label: 'Renommer',
									onSelect: () => {
										const name = window.prompt('Nouveau nom', file.name);
										if (name?.trim()) {
											onRename(name);
										}
									},
								},
								...(canMoveUp ? [{ label: 'Remonter d’un dossier', onSelect: onMoveUp }] : []),
								{
									label: 'Supprimer',
									danger: true,
									onSelect: () =>
										window.confirm(file.messageId ? `Supprimer « ${file.name} » ? Il disparaîtra aussi du message où il a été partagé.` : `Supprimer « ${file.name} » ?`) && onDelete(),
								},
							]
						: []),
				]}
			/>
		</li>
	);
}
