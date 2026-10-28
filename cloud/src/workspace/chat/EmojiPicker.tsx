import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { EMOJIS, EMOJI_CATEGORIES, emojiByChar, searchEmojis, type Emoji } from '../../../shared/emoji';
import { CUSTOM_REACTION_RE, type CustomEmoji } from '../../../shared/emojis';
import { Icon, useDismiss } from '../../ui';
import { CustomEmojiImg, customOf, searchCustom, type EmojiMap } from '../emojis/customEmojis';
import './chat.css';

const RECENT_KEY = 'synq_emoji_recent';
const RECENT_MAX = 24;
const MARGIN = 8;
const RECENT = 'Récents';
const SPACE = 'Cet espace';

type Item = Emoji | CustomEmoji;

const isCustom = (item: Item): item is CustomEmoji => !('char' in item);
const valueOf = (item: Item) => (isCustom(item) ? `:${item.name}:` : item.char);

export function recentEmojis(): string[] {
	try {
		const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
		return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string' && (emojiByChar.has(c) || CUSTOM_REACTION_RE.test(c))).slice(0, RECENT_MAX) : [];
	} catch {
		return [];
	}
}

export function rememberEmoji(char: string): void {
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify([char, ...recentEmojis().filter((c) => c !== char)].slice(0, RECENT_MAX)));
	} catch {
		// Stockage indisponible : pas de récents.
	}
}

const SECTIONS = EMOJI_CATEGORIES.map((category) => ({ category, emojis: EMOJIS.filter((e) => e.category === category) }));

// `custom` : emojis de l'espace, choisis sous la forme `:nom:`.
type Props = { anchor: DOMRect; onPick: (char: string) => void; onClose: () => void; custom?: EmojiMap };

export function EmojiPicker({ anchor, onPick, onClose, custom }: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const [query, setQuery] = useState('');
	const [hover, setHover] = useState<Item | null>(null);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	const recents = useMemo(() => recentEmojis().flatMap((c): Item[] => {
			const item = emojiByChar.get(c) ?? customOf(c, custom);
			return item ? [item] : [];
		}), [custom]);
	const results = useMemo((): Item[] => [...searchCustom(custom, query, 40), ...searchEmojis(query, 80)], [query, custom]);
	const space: Item[] = useMemo(() => [...(custom?.values() ?? [])], [custom]);
	const sections: Array<{ category: string; emojis: Item[] }> = [
		...(space.length ? [{ category: SPACE, emojis: space }] : []),
		...(recents.length ? [{ category: RECENT, emojis: recents }] : []),
		...SECTIONS,
	];
	useDismiss(ref, true, onClose);

	// Sous l'ancre si la place le permet, sinon au-dessus.
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const { width, height } = el.getBoundingClientRect();
		const below = anchor.bottom + 6;
		const top = below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, anchor.top - height - 6);
		const left = Math.max(MARGIN, Math.min(anchor.right - width, window.innerWidth - width - MARGIN));
		setPos({ left, top });
	}, [anchor]);

	const pick = (emoji: Item) => {
		rememberEmoji(valueOf(emoji));
		onPick(valueOf(emoji));
	};

	const grid = (list: Item[]) => (
		<div className='emoji-grid'>
			{list.map((emoji) => (
				<button
					key={valueOf(emoji)}
					type='button'
					className='emoji-cell'
					title={`:${emoji.name}:`}
					aria-label={emoji.name.replace(/_/g, ' ')}
					onMouseEnter={() => setHover(emoji)}
					onFocus={() => setHover(emoji)}
					onClick={() => pick(emoji)}
				>
					{isCustom(emoji) ? <CustomEmojiImg emoji={emoji} /> : emoji.char}
				</button>
			))}
		</div>
	);

	return (
		<div ref={ref} className='popover emoji-picker' role='dialog' aria-label='Choisir un emoji' style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}>
			<div className='emoji-search'>
				<Icon name='search' size={16} />
				<input
					autoFocus
					type='search'
					placeholder='Rechercher un emoji'
					aria-label='Rechercher un emoji'
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && results[0]) {
							e.preventDefault();
							pick(results[0]);
						}
					}}
				/>
			</div>
			{!query && (
				<nav className='emoji-tabs' aria-label='Catégories'>
					{sections.map(({ category, emojis }) => (
						<button
							key={category}
							type='button'
							className='emoji-tab'
							title={category}
							aria-label={category}
							onClick={() => body.current?.querySelector(`[data-category="${category}"]`)?.scrollIntoView({ block: 'start' })}
						>
							{category === RECENT ? <Icon name='clock' size={16} /> : emojis[0] && isCustom(emojis[0]) ? <CustomEmojiImg emoji={emojis[0]} /> : emojis[0]?.char}
						</button>
					))}
				</nav>
			)}
			<div className='emoji-body' ref={body}>
				{query ? (
					results.length ? (
						grid(results)
					) : (
						<p className='emoji-empty'>Aucun emoji pour « {query} »</p>
					)
				) : (
					sections.map(({ category, emojis }) => (
						<section key={category} data-category={category}>
							<h3 className='emoji-heading'>{category}</h3>
							{grid(emojis)}
						</section>
					))
				)}
			</div>
			<footer className='emoji-foot'>
				{hover ? (
					<>
						<span className='emoji-foot-glyph'>{isCustom(hover) ? <CustomEmojiImg emoji={hover} /> : hover.char}</span>
						<span className='ellipsis'>:{hover.name}:</span>
					</>
				) : (
					<span className='muted'>Choisis un emoji</span>
				)}
			</footer>
		</div>
	);
}
