import { useEffect, useMemo, useRef, useState } from 'react';

import type { Channel, SearchHit } from '../../shared/types';
import { api } from '../api';
import { Icon } from '../ui';
import { Snippet, type Lookup } from './richText';

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

type Props = {
	open: boolean;
	onClose: () => void;
	workspaceId: string;
	channels: Channel[];
	lookup: Lookup;
	onOpenChannel: (id: string) => void;
	onOpenMessage: (channelId: string, messageId: number) => void;
};

type Entry = { kind: 'channel'; channel: Channel } | { kind: 'hit'; hit: SearchHit };

export function SearchPalette({ open, onClose, workspaceId, channels, lookup, onOpenChannel, onOpenMessage }: Props) {
	const ref = useRef<HTMLDialogElement>(null);
	const [query, setQuery] = useState('');
	const [hits, setHits] = useState<SearchHit[]>([]);
	const [loading, setLoading] = useState(false);
	const [selected, setSelected] = useState(0);

	useEffect(() => {
		const dialog = ref.current;
		if (open && dialog && !dialog.open) {
			dialog.showModal();
			setQuery('');
			setHits([]);
			setSelected(0);
		} else if (!open && dialog?.open) {
			dialog.close();
		}
	}, [open]);

	useEffect(() => {
		const q = query.trim();
		if (q.length < 2) {
			setHits([]);
			return;
		}
		setLoading(true);
		const timer = setTimeout(() => {
			api<SearchHit[]>('GET', `/w/${workspaceId}/search?q=${encodeURIComponent(q)}`)
				.then(setHits)
				.catch(() => setHits([]))
				.finally(() => setLoading(false));
		}, 220);
		return () => clearTimeout(timer);
	}, [query, workspaceId]);

	const entries: Entry[] = useMemo(() => {
		const q = query.trim().toLowerCase();
		const matching = channels.filter((c) => !q || c.name.toLowerCase().includes(q)).slice(0, q ? 6 : 8);
		return [...matching.map((channel) => ({ kind: 'channel' as const, channel })), ...hits.map((hit) => ({ kind: 'hit' as const, hit }))];
	}, [channels, hits, query]);

	const choose = (entry: Entry | undefined) => {
		if (!entry) {
			return;
		}
		onClose();
		if (entry.kind === 'channel') {
			onOpenChannel(entry.channel.id);
		} else {
			onOpenMessage(entry.hit.message.channelId, entry.hit.message.id);
		}
	};

	const channelCount = entries.filter((e) => e.kind === 'channel').length;

	return (
		<dialog ref={ref} className='palette' aria-label='Recherche' onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
			<div className='palette-input'>
				<Icon name='search' />
				<input
					autoFocus
					value={query}
					placeholder='Chercher un salon ou un message'
					aria-label='Rechercher'
					onChange={(e) => {
						setQuery(e.target.value);
						setSelected(0);
					}}
					onKeyDown={(e) => {
						if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
							e.preventDefault();
							setSelected((s) => Math.max(0, Math.min(entries.length - 1, s + (e.key === 'ArrowDown' ? 1 : -1))));
						} else if (e.key === 'Enter') {
							e.preventDefault();
							choose(entries[selected]);
						}
					}}
				/>
				<kbd>Échap</kbd>
			</div>
			<div className='palette-results' role='listbox'>
				{channelCount > 0 && <div className='palette-group'>Salons</div>}
				{entries.map((entry, i) =>
					entry.kind === 'channel' ? (
						<button key={entry.channel.id} type='button' role='option' aria-selected={i === selected} className='menu-item' onMouseEnter={() => setSelected(i)} onClick={() => choose(entry)}>
							<Icon name={entry.channel.kind === 'voice' ? 'speaker' : entry.channel.readOnly ? 'megaphone' : 'hash'} size={16} />
							<span className='grow ellipsis'>{entry.channel.name}</span>
						</button>
					) : (
						<div key={entry.hit.message.id}>
							{i === channelCount && <div className='palette-group'>Messages</div>}
							<button type='button' role='option' aria-selected={i === selected} className='menu-item palette-hit' onMouseEnter={() => setSelected(i)} onClick={() => choose(entry)}>
								<span className='grow' style={{ minWidth: 0 }}>
									<span className='row' style={{ gap: 6, fontSize: 13 }}>
										<strong style={{ fontWeight: 600 }}>{lookup.members.get(entry.hit.message.userId)?.name ?? 'Ancien membre'}</strong>
										<span className='muted'>
											#{channels.find((c) => c.id === entry.hit.message.channelId)?.name ?? '?'}, {when.format(entry.hit.message.createdAt)}
										</span>
									</span>
									<span style={{ display: 'block', fontSize: 14 }}>
										<Snippet text={entry.hit.snippet} lookup={lookup} />
									</span>
								</span>
							</button>
						</div>
					),
				)}
				{query.trim().length >= 2 && !loading && hits.length === 0 && <p className='drive-empty'>Aucun message ne correspond.</p>}
				{loading && <div className='spinner' style={{ minHeight: 48 }} aria-busy />}
			</div>
		</dialog>
	);
}
