import type { ReactNode } from 'react';

import type { Channel, Member } from '../../shared/types';

export type Lookup = {
	members: Map<string, Member>;
	channels: Channel[];
	myId: string;
	openChannel: (id: string) => void;
};

const TOKEN_RE = /<@([0-9a-f-]{36})>|<#([0-9a-f-]{36})>|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;

export function RichText({ text, lookup }: { text: string; lookup: Lookup }) {
	const out: ReactNode[] = [];
	let last = 0;
	for (const match of text.matchAll(TOKEN_RE)) {
		const index = match.index ?? 0;
		if (index > last) {
			out.push(text.slice(last, index));
		}
		const [raw, userId, channelId, url, code, bold] = match;
		if (userId) {
			const member = lookup.members.get(userId);
			out.push(
				<span key={index} className={`chip${userId === lookup.myId ? ' chip-me' : ''}`}>
					@{member?.name ?? 'inconnu'}
				</span>,
			);
		} else if (channelId) {
			const channel = lookup.channels.find((c) => c.id === channelId);
			out.push(
				channel ? (
					<button key={index} type='button' className='chip' onClick={() => lookup.openChannel(channel.id)}>
						#{channel.name}
					</button>
				) : (
					<span key={index} className='chip'>
						#salon-supprimé
					</span>
				),
			);
		} else if (url) {
			out.push(
				<a key={index} href={url} target='_blank' rel='noopener noreferrer'>
					{url}
				</a>,
			);
		} else if (code) {
			out.push(<code key={index}>{code}</code>);
		} else if (bold) {
			out.push(<strong key={index}>{bold}</strong>);
		} else {
			out.push(raw);
		}
		last = index + raw.length;
	}
	if (last < text.length) {
		out.push(text.slice(last));
	}
	return <>{out}</>;
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
	const flat = toDisplay(body, lookup).replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function Snippet({ text, lookup }: { text: string; lookup: Pick<Lookup, 'members' | 'channels'> }) {
	const parts = toDisplay(text, lookup).split(/\[\[|\]\]/);
	return <>{parts.map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}
