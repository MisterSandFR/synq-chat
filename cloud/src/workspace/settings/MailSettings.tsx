import { useEffect, useState } from 'react';

import { memberKey } from '../../../shared/categories';
import type { MailSharers, WorkspaceMailbox } from '../../../shared/mail';
import { P, has } from '../../../shared/permissions';
import type { WorkspaceDetail } from '../../../shared/types';
import { api, errorText } from '../../api';
import { reachText } from '../../mail/ShareGrades';
import { Avatar, Icon } from '../../ui';
import { GradeDot, PeoplePicker, gradeLabel, holderCount, plural } from '../grade-access/PeoplePicker';

const MEMBER_PREFIX = memberKey('');

export function MailTab({ info }: { info: WorkspaceDetail }) {
	const [subjects, setSubjects] = useState<string[]>([]);
	const [boxes, setBoxes] = useState<WorkspaceMailbox[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		void Promise.all([api<MailSharers>('GET', `/w/${info.id}/mail-sharers`), api<WorkspaceMailbox[]>('GET', `/w/${info.id}/mail-boxes`)])
			.then(([sharers, list]) => {
				if (live) {
					setSubjects(sharers.subjects);
					setBoxes(list);
				}
			})
			.catch((e: unknown) => live && setError(errorText(e)));
		return () => {
			live = false;
		};
	}, [info.id]);

	const run = async (action: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await action();
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	};
	const save = (next: string[]) => run(async () => setSubjects((await api<MailSharers>('PUT', `/w/${info.id}/mail-sharers`, { subjects: next })).subjects));
	const unshare = (box: WorkspaceMailbox) => {
		if (confirm(`Retirer le partage de « ${box.name} » ? Les membres de l’espace n’y auront plus accès.`)) {
			void run(async () => {
				await api('DELETE', `/w/${info.id}/mail-boxes/${box.id}`);
				setBoxes((current) => current?.filter((item) => item.id !== box.id) ?? null);
			});
		}
	};

	const gradeIds = info.grades.filter((grade) => subjects.includes(grade.id)).map((grade) => grade.id);
	const memberIds = subjects.filter((subject) => subject.startsWith(MEMBER_PREFIX)).map((subject) => subject.slice(MEMBER_PREFIX.length));

	return (
		<div className='settings-sections'>
			<section className='settings-block mail-sharers'>
				<div className='mail-sharers-head'>
					<h3 className='settings-block-title'>Qui peut partager une boîte ici</h3>
					<p className='field-hint'>Le propriétaire et les administrateurs peuvent toujours partager, les invités jamais. Retirer quelqu’un laisse ses partages en place.</p>
				</div>
				<PeoplePicker
					grades={info.grades.filter((grade) => !has(grade.permissions, P.ADMINISTRATOR))}
					members={info.members.filter((member) => !member.guest && !member.owner)}
					everyone={info.members}
					pickedGrades={gradeIds}
					pickedMembers={memberIds}
					onGrade={(id) => void save([...subjects, id])}
					onMember={(id) => void save([...subjects, memberKey(id)])}
				/>
				<ul className='ga-list'>
					{gradeIds.map((id) => {
						const grade = info.grades.find((g) => g.id === id);
						return (
							<li key={id}>
								<span className='ga-icon'>
									<GradeDot grade={grade} />
								</span>
								<span className='ga-name'>
									<span className='ellipsis'>{gradeLabel(grade)}</span>
									<span className='ga-via'>Grade · {plural(holderCount(info.members, id))}</span>
								</span>
								<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => void save(subjects.filter((s) => s !== id))}>
									Retirer
								</button>
							</li>
						);
					})}
					{memberIds.map((id) => {
						const member = info.members.find((m) => m.id === id);
						return (
							<li key={id}>
								<Avatar name={member?.name ?? '?'} url={member?.avatarUrl} size={28} />
								<span className='ga-name'>
									<span className='ellipsis'>{member?.name ?? 'Ancien membre'}</span>
									<span className='ga-via'>Membre</span>
								</span>
								<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => void save(subjects.filter((s) => s !== memberKey(id)))}>
									Retirer
								</button>
							</li>
						);
					})}
					{subjects.length === 0 && <li className='muted'>Personne d’autre que le propriétaire et les administrateurs.</li>}
				</ul>
			</section>
			<section className='settings-block'>
				<h3 className='settings-block-title'>Boîtes partagées</h3>
				<ul className='ga-list'>
					{boxes?.map((box) => (
						<li key={box.id}>
							<span className='ga-icon'>
								<Icon name='mail' size={16} />
							</span>
							<span className='ga-name'>
								<span className='ellipsis'>{box.name}</span>
								<span className='ga-via ellipsis'>
									{box.address} · {box.ownerName} · {reachText(box.reach)}
								</span>
							</span>
							<button type='button' className='btn btn-ghost' disabled={busy} onClick={() => unshare(box)}>
								Retirer le partage
							</button>
						</li>
					))}
					{boxes?.length === 0 && <li className='muted'>Aucune boîte partagée dans cet espace.</li>}
					{!boxes && !error && <li className='muted'>Chargement…</li>}
				</ul>
			</section>
			{error && <p className='notice notice-error'>{error}</p>}
		</div>
	);
}
