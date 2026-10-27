import { useCallback, useEffect, useState } from 'react';

import { AUDIT_KINDS, AUDIT_LABELS, type AuditEntry, type AuditKind, type AuditPage } from '../../../shared/audit';
import type { WorkspaceDetail } from '../../../shared/types';
import { api, errorText } from '../../api';
import { Avatar } from '../../ui';
import './settings.css';

const when = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function AuditTab({ info, channelName }: { info: WorkspaceDetail; channelName: (id: string) => string | null }) {
	const [kind, setKind] = useState<AuditKind | ''>('');
	const [items, setItems] = useState<AuditEntry[]>([]);
	const [next, setNext] = useState<number | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const load = useCallback(
		async (before: number | null) => {
			setLoading(true);
			try {
				const query = new URLSearchParams();
				if (kind) {
					query.set('kind', kind);
				}
				if (before) {
					query.set('before', String(before));
				}
				const page = await api<AuditPage>('GET', `/w/${info.id}/audit?${query}`);
				setItems((list) => (before ? [...list, ...page.items] : page.items));
				setNext(page.next);
				setError(null);
			} catch (err) {
				setError(errorText(err));
			} finally {
				setLoading(false);
			}
		},
		[info.id, kind],
	);

	useEffect(() => {
		void load(null);
	}, [load]);

	const members = new Map(info.members.map((m) => [m.id, m]));
	const grades = new Map(info.grades.map((g) => [g.id, g.name]));
	// Nom courant si l'élément existe encore, sinon celui noté au moment de l'action.
	const target = (entry: AuditEntry) => {
		const id = entry.targetId;
		const current = id ? (members.get(id)?.name ?? grades.get(id) ?? channelName(id)) : null;
		return current ?? entry.targetName;
	};

	return (
		<div className='stack' style={{ gap: 14 }}>
			<label className='field' style={{ maxWidth: 260 }}>
				Type d’action
				<select value={kind} onChange={(e) => setKind(e.target.value as AuditKind | '')}>
					<option value=''>Toutes</option>
					{AUDIT_KINDS.map((k) => (
						<option key={k.id} value={k.id}>
							{k.label}
						</option>
					))}
				</select>
			</label>
			{error && <p className='notice notice-error'>{error}</p>}
			{!loading && items.length === 0 && !error && <p className='muted'>Aucune action d’administration pour l’instant.</p>}
			<ul className='list audit-list'>
				{items.map((entry) => {
					const actor = members.get(entry.actorId);
					const name = target(entry);
					return (
						<li key={entry.id} className='audit-row'>
							<Avatar name={actor?.name ?? entry.actorName} url={actor?.avatarUrl} size={28} />
							<span className='grow'>
								<strong>{actor?.name ?? entry.actorName}</strong> {AUDIT_LABELS[entry.action] ?? entry.action}
								{name && <strong> {name}</strong>}
								{entry.detail && <span className='muted'> ({entry.detail})</span>}
							</span>
							<time className='muted' dateTime={new Date(entry.at).toISOString()} style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
								{when.format(entry.at)}
							</time>
						</li>
					);
				})}
			</ul>
			{next && (
				<button type='button' className='btn' style={{ alignSelf: 'center' }} disabled={loading} onClick={() => void load(next)}>
					Plus ancien
				</button>
			)}
		</div>
	);
}
