import { useEffect, useState } from 'react';

import { CUSTOM_REACTION_RE, type CustomEmoji } from '../../../shared/emojis';
import { api } from '../../api';
import './emojis.css';

export const EMOJIS_EVENT = 'synq:emojis';

export type EmojiMap = ReadonlyMap<string, CustomEmoji>;

export const emojisChanged = (workspaceId: string) => window.dispatchEvent(new CustomEvent(EMOJIS_EVENT, { detail: workspaceId }));

export function useCustomEmojis(workspaceId: string): EmojiMap {
	const [map, setMap] = useState<EmojiMap>(() => new Map());
	useEffect(() => {
		let stale = false;
		const load = () =>
			api<CustomEmoji[]>('GET', `/w/${workspaceId}/emojis`)
				.then((list) => !stale && setMap(new Map(list.map((e) => [e.name, e]))))
				.catch(() => undefined);
		void load();
		const onChange = (event: Event) => (event as CustomEvent<string>).detail === workspaceId && void load();
		window.addEventListener(EMOJIS_EVENT, onChange);
		return () => {
			stale = true;
			window.removeEventListener(EMOJIS_EVENT, onChange);
		};
	}, [workspaceId]);
	return map;
}

// Valeur `:nom:` d'une réaction ou d'un récent ; emoji supprimé = undefined.
export const customOf = (value: string, map: EmojiMap | undefined) => {
	const name = CUSTOM_REACTION_RE.exec(value)?.[1];
	return name ? map?.get(name) : undefined;
};

// Début du nom d'abord, puis contenu.
export function searchCustom(map: EmojiMap | undefined, query: string, limit = 48): CustomEmoji[] {
	const q = query.trim().toLowerCase();
	if (!q || !map) {
		return [];
	}
	return [...map.values()]
		.filter((e) => e.name.includes(q))
		.sort((a, b) => Number(!a.name.startsWith(q)) - Number(!b.name.startsWith(q)) || a.name.localeCompare(b.name))
		.slice(0, limit);
}

export function CustomEmojiImg({ emoji, className = '' }: { emoji: CustomEmoji; className?: string }) {
	return <img className={`emoji-custom ${className}`.trim()} src={emoji.url} alt={`:${emoji.name}:`} title={`:${emoji.name}:`} draggable={false} loading='lazy' />;
}
