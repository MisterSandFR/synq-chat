import { useCallback, useEffect, useMemo, useState } from 'react';

import { absenceNow, absenceSentence, absenceStatus, dayFromDate, kindInfo, shiftDay, type Absence, type AbsenceListing, type AbsenceNow } from '../../../shared/absences';
import { api } from '../../api';
import { useUserEvents } from '../../userEvents';
import type { Lookup } from '../richText';
import './absences.css';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Absences du jour des membres de l'espace, relues à chaque changement de calendrier.
export function useAbsenceStatus(workspaceId: string): Map<string, AbsenceNow> {
	const [list, setList] = useState<Absence[]>([]);
	const today = dayFromDate(new Date());
	const load = useCallback(() => {
		api<AbsenceListing>('GET', `/absences?from=${today}&to=${shiftDay(today, 1)}&workspace=${workspaceId}`)
			.then((listing) => setList(listing.absences))
			.catch(() => setList([]));
	}, [workspaceId, today]);
	useEffect(load, [load]);
	useUserEvents((event) => {
		if (event.t === 'calendar' || event.t === 'resync') {
			load();
		}
	});
	return useMemo(() => {
		const out = new Map<string, AbsenceNow>();
		for (const userId of new Set(list.map((a) => a.userId))) {
			const now = absenceNow(list, userId, today);
			if (now) {
				out.set(userId, now);
			}
		}
		return out;
	}, [list, today]);
}

export const absenceTitle = (now: AbsenceNow) => absenceStatus(now, dayFromDate(new Date()));

export function AbsenceLine({ now, className = '' }: { now: AbsenceNow; className?: string }) {
	const text = absenceTitle(now);
	return (
		<span className={`absence-line ${className}`} title={text}>
			<span aria-hidden>{kindInfo(now.kind).emoji}</span>
			<span className='ellipsis'>{text}</span>
		</span>
	);
}

// Note non bloquante : une personne mentionnée est absente.
export function AbsenceNote({ text, lookup }: { text: string; lookup: Lookup }) {
	const absences = lookup.absences;
	const hits = useMemo(() => {
		if (!absences?.size || !text.includes('@')) {
			return [];
		}
		return [...lookup.members.values()].filter((m) => m.id !== lookup.myId && absences.has(m.id) && new RegExp(`@${escape(m.name)}(?![\\p{L}\\p{N}_])`, 'u').test(text));
	}, [text, lookup, absences]);
	const first = hits[0];
	if (!first || !absences) {
		return null;
	}
	const now = absences.get(first.id)!;
	return (
		<p className='absence-note' role='status'>
			<span aria-hidden>{kindInfo(now.kind).emoji}</span>
			<span className='ellipsis'>
				{absenceSentence(first.name, now, dayFromDate(new Date()))}
				{hits.length > 1 && ` Et ${hits.length - 1} autre${hits.length > 2 ? 's' : ''} absent${hits.length > 2 ? 's' : ''}.`}
			</span>
		</p>
	);
}
