import { useRef, useState, type DragEvent } from 'react';

import { CUSTOM_EMOJI_LIMITS, CUSTOM_EMOJI_TYPES, emojiNameFrom, type CustomEmoji } from '../../../shared/emojis';
import type { WorkspaceDetail } from '../../../shared/types';
import { ApiError, api, errorText } from '../../api';
import { Icon } from '../../ui';
import { CustomEmojiImg, emojisChanged, useCustomEmojis } from './customEmojis';
import './emojis.css';

// GIF intact pour garder l'animation ; les autres réduits côté client.
async function shrink(file: File): Promise<Blob> {
	if (file.type === 'image/gif') {
		return file;
	}
	const bitmap = await createImageBitmap(file).catch(() => null);
	if (!bitmap) {
		throw new Error(`${file.name} : image illisible`);
	}
	const scale = Math.min(1, CUSTOM_EMOJI_LIMITS.dimension / Math.max(bitmap.width, bitmap.height));
	if (scale === 1) {
		return file;
	}
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(bitmap.width * scale));
	canvas.height = Math.max(1, Math.round(bitmap.height * scale));
	canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, 0.92));
	return blob ?? file;
}

async function sendEmoji(workspaceId: string, name: string, blob: Blob): Promise<CustomEmoji> {
	const res = await fetch(`/api/w/${workspaceId}/emojis`, { method: 'POST', headers: { 'Content-Type': blob.type, 'X-Emoji-Name': name }, body: blob });
	const data = (await res.json().catch(() => null)) as (CustomEmoji & { error?: string }) | null;
	if (!res.ok || !data) {
		throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`);
	}
	return data;
}

function freeName(base: string, taken: Set<string>): string {
	let name = base;
	for (let i = 2; taken.has(name); i++) {
		name = `${base.slice(0, 32 - String(i).length - 1)}_${i}`;
	}
	return name;
}

export function EmojisTab({ info }: { info: WorkspaceDetail }) {
	const emojis = useCustomEmojis(info.id);
	const input = useRef<HTMLInputElement>(null);
	const [pending, setPending] = useState<string[]>([]);
	const [errors, setErrors] = useState<string[]>([]);
	const [over, setOver] = useState(false);
	const [renaming, setRenaming] = useState<string | null>(null);
	const list = [...emojis.values()];
	const authorOf = (id: string) => info.members.find((m) => m.id === id)?.name ?? 'Ancien membre';
	const full = list.length + pending.length >= CUSTOM_EMOJI_LIMITS.count;

	const send = async (files: File[]) => {
		const taken = new Set([...emojis.keys(), ...pending]);
		const failed: string[] = [];
		const room = CUSTOM_EMOJI_LIMITS.count - list.length - pending.length;
		if (files.length > room) {
			failed.push(`${files.length - Math.max(room, 0)} image(s) ignorée(s) : ${CUSTOM_EMOJI_LIMITS.count} emojis par espace au maximum`);
		}
		const batch = files.slice(0, Math.max(room, 0)).map((file) => {
			const name = freeName(emojiNameFrom(file.name), taken);
			taken.add(name);
			return { file, name };
		});
		setErrors([]);
		setPending((p) => [...p, ...batch.map((b) => b.name)]);
		for (const { file, name } of batch) {
			try {
				if (!CUSTOM_EMOJI_TYPES.includes(file.type)) {
					throw new Error(`${file.name} : image PNG, GIF, WebP ou JPEG attendue`);
				}
				const blob = await shrink(file);
				if (blob.size > CUSTOM_EMOJI_LIMITS.size) {
					throw new Error(`${file.name} : 256 Ko maximum`);
				}
				await sendEmoji(info.id, name, blob);
			} catch (err) {
				failed.push(err instanceof ApiError ? `${file.name} : ${errorText(err)}` : errorText(err));
			} finally {
				setPending((p) => p.filter((n) => n !== name));
			}
		}
		setErrors(failed);
		emojisChanged(info.id);
	};

	const rename = async (emoji: CustomEmoji, next: string) => {
		setRenaming(null);
		const name = next.trim().toLowerCase();
		if (!name || name === emoji.name) {
			return;
		}
		try {
			await api('PATCH', `/w/${info.id}/emojis/${emoji.name}`, { name });
			setErrors([]);
		} catch (err) {
			setErrors([errorText(err)]);
		}
		emojisChanged(info.id);
	};

	const remove = async (emoji: CustomEmoji) => {
		if (!window.confirm(`Supprimer :${emoji.name}: ? Les messages et réactions qui l’utilisent afficheront le texte.`)) {
			return;
		}
		try {
			await api('DELETE', `/w/${info.id}/emojis/${emoji.name}`);
		} catch (err) {
			setErrors([errorText(err)]);
		}
		emojisChanged(info.id);
	};

	const onDrop = (event: DragEvent) => {
		event.preventDefault();
		setOver(false);
		const files = [...event.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
		if (files.length && !full) {
			void send(files);
		}
	};

	return (
		<div
			className='stack'
			onDragOver={(e) => {
				if (e.dataTransfer.types.includes('Files')) {
					e.preventDefault();
					setOver(true);
				}
			}}
			onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(false)}
			onDrop={onDrop}
		>
			<div className='emoji-admin-head'>
				<p className='muted grow' style={{ fontSize: 14 }}>
					Tout le monde peut les utiliser avec <code>:nom:</code> dans les messages et les réactions.
				</p>
				<span className='emoji-admin-count' aria-label={`${list.length} emojis sur ${CUSTOM_EMOJI_LIMITS.count}`}>
					{list.length} / {CUSTOM_EMOJI_LIMITS.count}
				</span>
				<button type='button' className='btn btn-primary' disabled={full} onClick={() => input.current?.click()}>
					<Icon name='upload' size={16} /> Ajouter
				</button>
				<input
					ref={input}
					type='file'
					hidden
					multiple
					accept={CUSTOM_EMOJI_TYPES.join(',')}
					onChange={(e) => {
						const files = [...(e.target.files ?? [])];
						e.target.value = '';
						if (files.length) {
							void send(files);
						}
					}}
				/>
			</div>
			<div className='emoji-drop' data-over={over}>
				<Icon name='image' size={20} />
				<span>
					<strong>Glisse des images ici</strong> ou choisis des fichiers
				</span>
				<span>PNG, GIF animé, WebP ou JPEG, 256 Ko maximum. Le nom vient du fichier, modifiable ensuite.</span>
			</div>
			{errors.map((message) => (
				<p key={message} className='notice notice-error'>
					{message}
				</p>
			))}
			{list.length === 0 && pending.length === 0 ? (
				<p className='muted' style={{ fontSize: 14 }}>
					Aucun emoji pour l’instant.
				</p>
			) : (
				<ul className='emoji-admin-grid' aria-label='Emojis de l’espace'>
					{pending.map((name) => (
						<li key={`p:${name}`} className='emoji-admin-card emoji-admin-pending' aria-busy>
							<span className='spinner' />
							<span className='emoji-admin-meta'>
								<span className='emoji-admin-name ellipsis'>:{name}:</span>
								<span className='emoji-admin-author'>Envoi…</span>
							</span>
						</li>
					))}
					{list.map((emoji) => (
						<li key={emoji.name} className='emoji-admin-card'>
							<CustomEmojiImg emoji={emoji} />
							<span className='emoji-admin-meta'>
								{renaming === emoji.name ? (
									<input
										autoFocus
										className='emoji-admin-name-input'
										aria-label={`Nouveau nom pour :${emoji.name}:`}
										defaultValue={emoji.name}
										maxLength={32}
										pattern='[a-z0-9_]{2,32}'
										onFocus={(e) => e.currentTarget.select()}
										onBlur={(e) => void rename(emoji, e.currentTarget.value)}
										onKeyDown={(e) => {
											if (e.key === 'Enter') {
												e.preventDefault();
												e.currentTarget.blur();
											} else if (e.key === 'Escape') {
												e.preventDefault();
												e.stopPropagation();
												setRenaming(null);
											}
										}}
									/>
								) : (
									<button type='button' className='emoji-admin-name ellipsis' title='Renommer' onClick={() => setRenaming(emoji.name)}>
										:{emoji.name}:
									</button>
								)}
								<span className='emoji-admin-author ellipsis'>{authorOf(emoji.createdBy)}</span>
							</span>
							<button type='button' className='icon-btn icon-btn-sm' aria-label={`Supprimer :${emoji.name}:`} onClick={() => void remove(emoji)}>
								<Icon name='trash' size={16} />
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
