import { useEffect, useState } from 'react';

import type { ListDetail, ListRule, RuleAction, RuleTrigger } from '../../../shared/lists';
import type { Member } from '../../../shared/types';
import { api, ApiError } from '../../api';
import { Dialog, Icon } from '../../ui';

type Props = { base: string; list: ListDetail; members: Map<string, Member>; onClose: () => void };

const message = (error: unknown) => (error instanceof ApiError ? error.message : 'Action impossible pour le moment.');

export function Automations({ base, list, members, onClose }: Props) {
	const [rules, setRules] = useState<ListRule[] | null>(null);
	const [error, setError] = useState('');
	const statuses = list.columns.filter((c) => c.type === 'status');
	const persons = list.columns.filter((c) => c.type === 'person');
	const triggers = [...statuses.flatMap((c) => (c.options ?? []).map((o) => ({ key: `${c.id}:${o.id}`, label: `${c.name} devient « ${o.label} »` }))), { key: 'due_soon', label: 'L’échéance est demain' }];
	const [when, setWhen] = useState(triggers[0]?.key ?? 'due_soon');
	const [kind, setKind] = useState<RuleAction['kind']>('done');
	const [param, setParam] = useState('');
	const people = [...members.values()];

	useEffect(() => {
		void api<ListRule[]>('GET', `${base}/rules`)
			.then(setRules)
			.catch((e) => setError(message(e)));
	}, [base]);

	const optionLabel = (column: string, option: string) => {
		const c = list.columns.find((x) => x.id === column);
		return `${c?.name ?? 'Statut'} « ${c?.options?.find((o) => o.id === option)?.label ?? '?'} »`;
	};
	const describeTrigger = (t: RuleTrigger) => (t.kind === 'due_soon' ? 'Quand l’échéance est demain' : `Quand ${optionLabel(t.column, t.option)} est choisi`);
	const describeAction = (a: RuleAction) => {
		switch (a.kind) {
			case 'done':
				return 'cocher « terminé »';
			case 'assign':
				return `attribuer à ${members.get(a.user)?.name ?? 'un ancien membre'}`;
			case 'label':
				return `ajouter l’étiquette « ${list.labels.find((l) => l.id === a.label)?.name ?? '?'} »`;
			case 'notify':
				return a.user ? `notifier ${members.get(a.user)?.name ?? 'un ancien membre'}` : 'notifier les personnes de l’élément';
			case 'move':
				return `passer à ${optionLabel(a.column, a.option)}`;
		}
	};

	const kinds: Array<{ id: RuleAction['kind']; label: string }> =
		when === 'due_soon'
			? [{ id: 'notify', label: 'Notifier' }]
			: [
					{ id: 'done', label: 'Cocher « terminé »' },
					...(persons.length ? [{ id: 'assign' as const, label: 'Attribuer à' }] : []),
					...(list.labels.length ? [{ id: 'label' as const, label: 'Ajouter l’étiquette' }] : []),
					{ id: 'notify', label: 'Notifier' },
					{ id: 'move', label: 'Passer à' },
				];
	const action = kinds.some((k) => k.id === kind) ? kind : kinds[0]!.id;

	const submit = async () => {
		const [column = '', option = ''] = when.split(':');
		const trigger: RuleTrigger = when === 'due_soon' ? { kind: 'due_soon' } : { kind: 'status', column, option };
		const [pc = '', po = ''] = param.split(':');
		const body: RuleAction =
			action === 'assign'
				? { kind: 'assign', column: persons[0]?.id ?? '', user: param }
				: action === 'label'
					? { kind: 'label', label: param || (list.labels[0]?.id ?? '') }
					: action === 'notify'
						? { kind: 'notify', user: param || null }
						: action === 'move'
							? { kind: 'move', column: pc, option: po }
							: { kind: 'done' };
		try {
			const created = await api<ListRule>('POST', `${base}/rules`, { trigger, action: body });
			setRules((r) => [...(r ?? []), created]);
			setError('');
		} catch (e) {
			setError(message(e));
		}
	};

	return (
		<Dialog open onClose={onClose} title='Automatisations' wide>
			<div className='bs-rules'>
				<p className='muted'>Des règles simples qui s’appliquent à chaque changement fait par l’équipe. Une règle ne déclenche pas les autres.</p>
				{rules === null ? (
					<div className='spinner' aria-busy />
				) : rules.length === 0 ? (
					<p className='lst-none muted'>Aucune automatisation pour l’instant.</p>
				) : (
					<ul className='bs-rule-list'>
						{rules.map((r) => (
							<li key={r.id} className={r.enabled ? undefined : 'is-off'}>
								<Icon name='repeat' size={15} />
								<span className='grow'>
									{describeTrigger(r.trigger)}, {describeAction(r.action)}.
								</span>
								{list.canEdit && (
									<>
										<label className='bs-switch'>
											<input
												type='checkbox'
												checked={r.enabled}
												aria-label='Activer la règle'
												onChange={() =>
													void api('PATCH', `${base}/rules/${r.id}`, { enabled: !r.enabled })
														.then(() => setRules((all) => all?.map((x) => (x.id === r.id ? { ...x, enabled: !r.enabled } : x)) ?? null))
														.catch((e) => setError(message(e)))
												}
											/>
										</label>
										<button
											type='button'
											className='icon-btn icon-btn-sm'
											aria-label='Supprimer la règle'
											onClick={() =>
												void api('DELETE', `${base}/rules/${r.id}`)
													.then(() => setRules((all) => all?.filter((x) => x.id !== r.id) ?? null))
													.catch((e) => setError(message(e)))
											}
										>
											<Icon name='trash' size={14} />
										</button>
									</>
								)}
							</li>
						))}
					</ul>
				)}
				{list.canEdit && (
					<div className='bs-rule-form'>
						<label className='field'>
							Quand
							<select className='input' value={when} onChange={(e) => setWhen(e.target.value)}>
								{triggers.map((t) => (
									<option key={t.key} value={t.key}>
										{t.label}
									</option>
								))}
							</select>
						</label>
						<label className='field'>
							Alors
							<select
								className='input'
								value={action}
								onChange={(e) => {
									setKind(e.target.value as RuleAction['kind']);
									setParam('');
								}}
							>
								{kinds.map((k) => (
									<option key={k.id} value={k.id}>
										{k.label}
									</option>
								))}
							</select>
						</label>
						{(action === 'assign' || action === 'notify') && (
							<label className='field'>
								Personne
								<select className='input' value={param} onChange={(e) => setParam(e.target.value)}>
									{action === 'notify' && <option value=''>Les personnes de l’élément</option>}
									{action === 'assign' && <option value=''>Choisir</option>}
									{people.map((m) => (
										<option key={m.id} value={m.id}>
											{m.name}
										</option>
									))}
								</select>
							</label>
						)}
						{action === 'label' && (
							<label className='field'>
								Étiquette
								<select className='input' value={param} onChange={(e) => setParam(e.target.value)}>
									{list.labels.map((l) => (
										<option key={l.id} value={l.id}>
											{l.name}
										</option>
									))}
								</select>
							</label>
						)}
						{action === 'move' && (
							<label className='field'>
								Valeur
								<select className='input' value={param} onChange={(e) => setParam(e.target.value)}>
									<option value=''>Choisir</option>
									{statuses.flatMap((c) =>
										(c.options ?? []).map((o) => (
											<option key={`${c.id}:${o.id}`} value={`${c.id}:${o.id}`}>
												{c.name} : {o.label}
											</option>
										)),
									)}
								</select>
							</label>
						)}
						<button type='button' className='btn btn-primary' onClick={() => void submit()}>
							Ajouter la règle
						</button>
					</div>
				)}
				{error && <p className='notice notice-error'>{error}</p>}
			</div>
		</Dialog>
	);
}
