import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import { BUILTIN_COMMANDS, appName, parseCommand, type CommandReply, type SlashCommand } from '../../../shared/commands';
import type { Channel, Member } from '../../../shared/types';
import { api } from '../../api';

export type EphemeralNote = { id: number; command: string; text: string };

export const COMMANDS_EVENT = 'synq:commands';

// Valeur initiale seulement : la liste est relue à chaque montage du composer.
const cache = new Map<string, SlashCommand[]>();

export function useCommandList(workspaceId: string): SlashCommand[] {
	const [list, setList] = useState(() => cache.get(workspaceId) ?? []);
	useEffect(() => {
		let alive = true;
		const load = () =>
			void api<SlashCommand[]>('GET', `/w/${workspaceId}/commands`)
				.then((next) => {
					cache.set(workspaceId, next);
					if (alive) {
						setList(next);
					}
				})
				.catch(() => {});
		const onChange = (event: Event) => (event as CustomEvent<string>).detail === workspaceId && load();
		load();
		window.addEventListener(COMMANDS_EVENT, onChange);
		return () => {
			alive = false;
			window.removeEventListener(COMMANDS_EVENT, onChange);
		};
	}, [workspaceId]);
	return list;
}

// Auteur fictif des messages publiés par une commande.
export const appAuthor = (userId: string): Member | undefined => {
	const name = appName(userId);
	return name ? { id: userId, name, avatarUrl: null, owner: false, gradeIds: [] } : undefined;
};

const QUERY_RE = /^\/([a-z0-9_-]{0,32})$/i;

export function useSlash(workspaceId: string, channel: Channel, text: string, setText: (next: string) => void) {
	const custom = useCommandList(workspaceId);
	const all = useMemo(() => [...BUILTIN_COMMANDS, ...custom.filter((c) => !BUILTIN_COMMANDS.some((b) => b.name === c.name))], [custom]);
	const [selected, setSelected] = useState(0);
	const [dismissed, setDismissed] = useState<string | null>(null);
	const [notes, setNotes] = useState<EphemeralNote[]>([]);

	const query = QUERY_RE.exec(text)?.[1]?.toLowerCase() ?? null;
	const matches = query === null || dismissed === text ? [] : all.filter((c) => c.name.startsWith(query)).slice(0, 8);
	const index = Math.min(selected, Math.max(0, matches.length - 1));
	const parsed = query === null ? parseCommand(text) : null;
	const active = parsed ? (all.find((c) => c.name === parsed.name) ?? null) : null;

	useEffect(() => setSelected(0), [query]);

	const accept = (command: SlashCommand) => setText(`/${command.name} `);

	// Vrai si la touche a été consommée par le menu.
	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
		if (!matches.length) {
			return false;
		}
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			setSelected((index + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
			return true;
		}
		if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && matches[index]!.name !== query)) {
			e.preventDefault();
			accept(matches[index]!);
			return true;
		}
		if (e.key === 'Escape') {
			setDismissed(text);
			return true;
		}
		return false;
	};

	// Texte à envoyer comme message, 'done' si la commande est traitée, null si ce n'est pas une commande.
	const run = async (raw: string): Promise<string | 'done' | null> => {
		const command = parseCommand(raw.trimEnd());
		if (!command) {
			return null;
		}
		const { name, args } = command;
		if (name === 'me') {
			if (!args) {
				throw new Error('Précise l’action, par exemple /me arrive dans 5 minutes');
			}
			return `_${args}_`;
		}
		if (name === 'shrug') {
			return `${args} ¯\\_(ツ)_/¯`.trim();
		}
		if (name === 'sujet') {
			await api('PATCH', `/w/${workspaceId}/channels/${channel.id}`, { topic: args });
			return 'done';
		}
		const reply = await api<CommandReply>('POST', `/w/${workspaceId}/channels/${channel.id}/commands`, { name, text: args });
		if (reply.ephemeral && reply.text) {
			setNotes((current) => [...current.slice(-4), { id: Date.now(), command: name, text: reply.text }]);
		}
		return 'done';
	};

	const dismissNote = (id: number) => setNotes((current) => current.filter((n) => n.id !== id));

	return { matches, index, active, accept, onKeyDown, run, notes, dismissNote };
}
