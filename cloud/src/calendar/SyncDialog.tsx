import { useEffect, useState } from 'react';

import type { CalendarFeed } from '../../shared/calendar';
import type { WorkspaceSummary } from '../../shared/types';
import { api, ApiError, errorText } from '../api';
import { Dialog, Icon } from '../ui';
import { fmtShort, userTimeZone } from './dates';

type Status = { tone: 'ok' | 'error'; text: string } | null;

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function SyncDialog({ open, onClose, workspaces, onImported }: { open: boolean; onClose: () => void; workspaces: WorkspaceSummary[]; onImported: () => void }) {
	const [feed, setFeed] = useState<CalendarFeed | null>(null);
	const [url, setUrl] = useState('');
	const [target, setTarget] = useState('');
	const [status, setStatus] = useState<Status>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setUrl('');
			setStatus(null);
			api<CalendarFeed>('GET', '/calendar/feed')
				.then(setFeed)
				.catch((e) => setStatus({ tone: 'error', text: errorText(e) }));
		}
	}, [open]);

	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setStatus(null);
		try {
			await action();
		} catch (e) {
			setStatus({ tone: 'error', text: errorText(e) });
		} finally {
			setBusy(false);
		}
	};

	const rotate = () =>
		run(async () => {
			const created = await api<{ url: string }>('POST', '/calendar/feed');
			setUrl(created.url);
			setFeed({ active: true, createdAt: Date.now() });
		});

	const revoke = () =>
		run(async () => {
			await api('DELETE', '/calendar/feed');
			setUrl('');
			setFeed({ active: false, createdAt: null });
			setStatus({ tone: 'ok', text: 'Lien révoqué.' });
		});

	const importFile = (file: File) =>
		run(async () => {
			const query = `tz=${encodeURIComponent(userTimeZone())}${target ? `&workspace=${target}` : ''}`;
			const res = await fetch(`/api/calendar/import?${query}`, { method: 'POST', headers: { 'Content-Type': 'text/calendar' }, body: await file.text() });
			const data = (await res.json().catch(() => null)) as { imported?: number; skipped?: number; error?: string } | null;
			if (!res.ok || !data) {
				throw new ApiError(res.status, data?.error ?? `Erreur ${res.status}`);
			}
			const skipped = data.skipped ? `, ${plural(data.skipped, 'ignoré', 'ignorés')}` : '';
			setStatus({ tone: 'ok', text: `${plural(data.imported ?? 0, 'événement importé', 'événements importés')}${skipped}.` });
			onImported();
		});

	return (
		<Dialog open={open} onClose={onClose} title='Abonnement et import'>
			<section className='cal-sync'>
				<h3 className='cal-label'>S’abonner depuis un autre agenda</h3>
				<p className='field-hint'>Lien privé au format ICS pour Google Agenda, Apple Calendrier ou Outlook. Toute personne qui a ce lien voit tes événements.</p>
				{url && (
					<>
						<div className='inline-form'>
							<input readOnly value={url} aria-label='Lien d’abonnement' onFocus={(e) => e.target.select()} />
							<button type='button' className='btn' onClick={() => void navigator.clipboard?.writeText(url)}>
								Copier
							</button>
						</div>
						<p className='field-hint'>Copie-le maintenant : il ne sera plus affiché.</p>
					</>
				)}
				{!url && feed?.active && feed.createdAt && <p className='field-hint'>Lien actif depuis le {fmtShort(new Date(feed.createdAt))}.</p>}
				<div className='cal-actions cal-actions-start'>
					<button type='button' className='btn' disabled={busy || !feed} onClick={rotate}>
						<Icon name='link' size={16} />
						{feed?.active ? 'Générer un nouveau lien' : 'Créer le lien'}
					</button>
					{feed?.active && (
						<button type='button' className='btn btn-danger' disabled={busy} onClick={revoke}>
							Révoquer
						</button>
					)}
				</div>
			</section>
			<section className='cal-sync'>
				<h3 className='cal-label'>Importer un fichier ICS</h3>
				<label className='field'>
					Destination
					<select value={target} onChange={(e) => setTarget(e.target.value)}>
						<option value=''>Personnel</option>
						{workspaces.map((w) => (
							<option key={w.id} value={w.id}>
								{w.name}
							</option>
						))}
					</select>
				</label>
				<label className='btn cal-file' aria-disabled={busy}>
					<Icon name='upload' size={16} />
					Choisir un fichier .ics
					<input
						type='file'
						accept='.ics,text/calendar'
						hidden
						disabled={busy}
						onChange={(e) => {
							const file = e.target.files?.[0];
							e.target.value = '';
							if (file) {
								void importFile(file);
							}
						}}
					/>
				</label>
			</section>
			{status && <p className={`notice notice-${status.tone}`}>{status.text}</p>}
		</Dialog>
	);
}
