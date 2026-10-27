import { useEffect, useRef, useState, type FormEvent } from 'react';

import { MAIL_LIMITS, type MailTemplate, type MailTemplateInput } from '../../shared/mail';
import { api, errorText } from '../api';
import { Icon, useDismiss } from '../ui';

type Props = { text: string; onInsert: (body: string) => void };

export function Templates({ text, onInsert }: Props) {
	const [open, setOpen] = useState(false);
	const [list, setList] = useState<MailTemplate[] | null>(null);
	const [naming, setNaming] = useState(false);
	const [name, setName] = useState('');
	const [error, setError] = useState<string | null>(null);
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, open, () => setOpen(false));

	useEffect(() => {
		if (!open) {
			return;
		}
		let cancelled = false;
		api<MailTemplate[]>('GET', '/mail/templates')
			.then((items) => !cancelled && setList(items))
			.catch((e) => !cancelled && (setList([]), setError(errorText(e))));
		return () => {
			cancelled = true;
		};
	}, [open]);

	const save = async (event: FormEvent) => {
		event.preventDefault();
		const input: MailTemplateInput = { name: name.trim(), body: text.trim() };
		if (!input.name || !input.body) {
			return;
		}
		setError(null);
		try {
			const saved = await api<MailTemplate>('PUT', `/mail/templates/${crypto.randomUUID()}`, input);
			setList((current) => [...(current ?? []), saved].sort((a, b) => a.name.localeCompare(b.name)));
			setNaming(false);
			setName('');
		} catch (e) {
			setError(errorText(e));
		}
	};

	const remove = async (template: MailTemplate) => {
		setError(null);
		try {
			await api('DELETE', `/mail/templates/${template.id}`);
			setList((current) => (current ?? []).filter((item) => item.id !== template.id));
		} catch (e) {
			setError(errorText(e));
		}
	};

	return (
		<div className='mail-pop-anchor' ref={ref}>
			<button type='button' className='icon-btn icon-btn-sm' onClick={() => setOpen(!open)} title='Modèles de réponse' aria-label='Modèles de réponse' aria-expanded={open}>
				<Icon name='bookmark' size={16} />
			</button>
			{open && (
				<div className='popover mail-pop mail-pop-up mail-templates'>
					<div className='menu-label'>Modèles</div>
					{list === null ? (
						<div className='spinner' aria-busy />
					) : list.length === 0 ? (
						<p className='mail-templates-empty'>Aucun modèle pour l’instant.</p>
					) : (
						<div className='mail-pop-list'>
							{list.map((template) => (
								<div key={template.id} className='mail-template'>
									<button type='button' className='menu-item' onClick={() => (setOpen(false), onInsert(template.body))} title={template.body.slice(0, 300)}>
										<span className='mail-pop-grow'>{template.name}</span>
									</button>
									<button type='button' className='icon-btn icon-btn-sm' onClick={() => void remove(template)} title='Supprimer le modèle' aria-label={`Supprimer ${template.name}`}>
										<Icon name='trash' size={14} />
									</button>
								</div>
							))}
						</div>
					)}
					<div className='menu-sep' />
					{naming ? (
						<form className='mail-pop-date' onSubmit={(e) => void save(e)}>
							<input value={name} onChange={(e) => setName(e.target.value)} placeholder='Nom du modèle' maxLength={MAIL_LIMITS.templateName} autoFocus aria-label='Nom du modèle' />
							<button className='btn' disabled={!name.trim()}>
								Enregistrer
							</button>
						</form>
					) : (
						<button type='button' className='menu-item' disabled={!text.trim() || text.length > MAIL_LIMITS.templateBody} onClick={() => setNaming(true)}>
							<Icon name='plus' size={16} />
							Enregistrer le texte comme modèle
						</button>
					)}
					{error && <p className='notice notice-error'>{error}</p>}
				</div>
			)}
		</div>
	);
}
