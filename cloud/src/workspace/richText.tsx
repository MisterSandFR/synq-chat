import type { ReactNode } from 'react';

import { absenceStatus, dayFromDate, type AbsenceNow } from '../../shared/absences';
import { emojiByName } from '../../shared/emoji';
import type { Channel, Member } from '../../shared/types';
import { INLINE_RE, parseBlocks, stripMarkdown } from './chat/markdown';
import './chat/chat.css';
import { CustomEmojiImg, type EmojiMap } from './emojis/customEmojis';

export type Lookup = {
	members: Map<string, Member>;
	channels: Channel[];
	myId: string;
	openChannel: (id: string) => void;
	emojis?: EmojiMap;
	absences?: Map<string, AbsenceNow>;
};

// Uniquement des éléments React : jamais de HTML brut.
function inline(text: string, lookup: Lookup, key: string): ReactNode[] {
	const out: ReactNode[] = [];
	let last = 0;
	for (const match of text.matchAll(INLINE_RE)) {
		const index = match.index ?? 0;
		if (index > last) {
			out.push(text.slice(last, index));
		}
		const k = `${key}.${index}`;
		const [raw, userId, channelId, code, label, href, url, bold, strike, star, under, shortcode] = match;
		const emphasis = star ?? under;
		const custom = shortcode ? lookup.emojis?.get(shortcode) : undefined;
		const emoji = shortcode && !custom ? emojiByName.get(shortcode) : undefined;
		if (userId) {
			const member = lookup.members.get(userId);
			const away = lookup.absences?.get(userId);
			out.push(
				<span key={k} className={`chip${userId === lookup.myId ? ' chip-me' : ''}${away ? ' chip-away' : ''}`} title={away ? absenceStatus(away, dayFromDate(new Date())) : undefined}>
					@{member?.name ?? 'inconnu'}
				</span>,
			);
		} else if (channelId) {
			const channel = lookup.channels.find((c) => c.id === channelId);
			out.push(
				channel ? (
					<button key={k} type='button' className='chip' onClick={() => lookup.openChannel(channel.id)}>
						#{channel.name}
					</button>
				) : (
					<span key={k} className='chip'>
						#salon-supprimé
					</span>
				),
			);
		} else if (code) {
			out.push(<code key={k}>{code}</code>);
		} else if (label && href) {
			out.push(
				<a key={k} href={href} target='_blank' rel='noopener noreferrer' title={href}>
					{inline(label, lookup, k)}
				</a>,
			);
		} else if (url) {
			out.push(
				<a key={k} href={url} target='_blank' rel='noopener noreferrer'>
					{url}
				</a>,
			);
		} else if (bold) {
			out.push(<strong key={k}>{inline(bold, lookup, k)}</strong>);
		} else if (strike) {
			out.push(<del key={k}>{inline(strike, lookup, k)}</del>);
		} else if (emphasis) {
			out.push(<em key={k}>{inline(emphasis, lookup, k)}</em>);
		} else if (custom) {
			out.push(<CustomEmojiImg key={k} emoji={custom} />);
		} else if (emoji) {
			out.push(
				<span key={k} className='emoji' title={`:${emoji.name}:`}>
					{emoji.char}
				</span>,
			);
		} else {
			out.push(raw);
		}
		last = index + raw.length;
	}
	if (last < text.length) {
		out.push(text.slice(last));
	}
	return out;
}

export function RichText({ text, lookup }: { text: string; lookup: Lookup }) {
	const blocks = parseBlocks(text);
	const only = blocks[0];
	if (blocks.length === 1 && only?.kind === 'p') {
		return <>{inline(only.text, lookup, 'r')}</>;
	}
	return (
		<>
			{blocks.map((block, i) => {
				const key = `b${i}`;
				switch (block.kind) {
					case 'code':
						return (
							<pre key={key} className='md-pre'>
								<code>{block.text}</code>
							</pre>
						);
					case 'quote':
						return (
							<blockquote key={key} className='md-quote'>
								{inline(block.text, lookup, key)}
							</blockquote>
						);
					case 'list': {
						const items = block.items.map((item, j) => <li key={j}>{inline(item, lookup, `${key}.${j}`)}</li>);
						return block.ordered ? (
							<ol key={key} className='md-list' start={block.start}>
								{items}
							</ol>
						) : (
							<ul key={key} className='md-list'>
								{items}
							</ul>
						);
					}
					default:
						return (
							<div key={key} className='md-p'>
								{inline(block.text, lookup, key)}
							</div>
						);
				}
			})}
		</>
	);
}

export function toDisplay(body: string, lookup: Pick<Lookup, 'members' | 'channels'>): string {
	return body
		.replace(/<@([0-9a-f-]{36})>/g, (_, id: string) => `@${lookup.members.get(id)?.name ?? 'inconnu'}`)
		.replace(/<#([0-9a-f-]{36})>/g, (_, id: string) => `#${lookup.channels.find((c) => c.id === id)?.name ?? 'salon-supprimé'}`);
}

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Noms les plus longs d'abord : « @Marie Claire » avant « @Marie ».
export function toTokens(text: string, lookup: Pick<Lookup, 'members' | 'channels'>): string {
	let out = text;
	const members = [...lookup.members.values()].sort((a, b) => b.name.length - a.name.length);
	for (const member of members) {
		out = out.replace(new RegExp(`@${escapeRe(member.name)}(?![\\p{L}\\p{N}_])`, 'gu'), `<@${member.id}>`);
	}
	const channels = lookup.channels.filter((c) => c.kind === 'text').sort((a, b) => b.name.length - a.name.length);
	for (const channel of channels) {
		out = out.replace(new RegExp(`#${escapeRe(channel.name)}(?![\\p{L}\\p{N}_-])`, 'gu'), `<#${channel.id}>`);
	}
	return out;
}

export function excerpt(body: string, lookup: Pick<Lookup, 'members' | 'channels'>, max = 120): string {
	const flat = stripMarkdown(toDisplay(body, lookup)).replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function Snippet({ text, lookup }: { text: string; lookup: Pick<Lookup, 'members' | 'channels'> }) {
	const parts = toDisplay(text, lookup).split(/\[\[|\]\]/);
	return <>{parts.map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}
