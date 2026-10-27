import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { BUILTIN_COMMANDS, COMMAND_LIMITS, type CommandConfig, type CommandInput } from '../../../shared/commands';
import { api, errorText } from '../../api';
import { Icon } from '../../ui';
import { COMMANDS_EVENT } from './useSlash';
import './commands.css';

const randomSecret = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');

export function CommandsTab({ workspaceId }: { workspaceId: string }) {
	const [list, setList] = useState<CommandConfig[] | null>(null);
	const [editing, setEditing] = useState<CommandConfig | 'new' | null>(null);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(
		() =>
			api<CommandConfig[]>('GET', `/w/${workspaceId}/commands/config`)
				.then(setList)
				.catch((err) => setError(errorText(err))),
		[workspaceId],
	);

	useEffect(() => {
		void load();
		const onChange = (event: Event) => (event as CustomEvent<string>).detail === workspaceId && void load();
		window.addEventListener(COMMANDS_EVENT, onChange);
		return () => window.removeEventListener(COMMANDS_EVENT, onChange);
	}, [load, workspaceId]);

	const remove = async (command: CommandConfig) => {
		if (!window.confirm(`Supprimer la commande /${command.name} ?`)) {
			return;
		}
		setError(null);
		try {
			await api('DELETE', `/w/${workspaceId}/commands/${command.id}`);
			await load();
		} catch (err) {
			setError(errorText(err));
		}
	};

	if (editing) {
		return (
			<CommandForm
				workspaceId={workspaceId}
				command={editing === 'new' ? undefined : editing}
				onDone={() => {
					setEditing(null);
					void load();
				}}
			/>
		);
	}

	return (
		<div className='stack'>
			<div className='row'>
				<p className='muted grow' style={{ fontSize: 14 }}>
					Une commande envoie une requête signée à ton service et affiche sa réponse. Toujours disponibles : {BUILTIN_COMMANDS.map((c) => `/${c.name}`).join(', ')}.
				</p>
				<button type='button' className='btn btn-primary' onClick={() => setEditing('new')}>
					<Icon name='plus' size={16} /> Nouvelle commande
				</button>
			</div>
			{list === null ? (
				!error && <div className='spinner' aria-busy />
			) : list.length === 0 ? (
				<p className='muted' style={{ fontSize: 14 }}>
					Aucune commande personnalisée pour l’instant.
				</p>
			) : (
				<ul className='list'>
					{list.map((command) => (
						<li key={command.id} className='list-row'>
							<span className='slash-name'>/{command.name}</span>
							<span className='grow ellipsis muted' style={{ fontSize: 14 }}>
								{command.description}
							</span>
							<span className='tag cmd-visibility'>{command.ephemeral ? 'Auteur seul' : 'Salon'}</span>
							<button type='button' className='icon-btn icon-btn-sm' aria-label={`Modifier /${command.name}`} onClick={() => setEditing(command)}>
								<Icon name='pencil' size={16} />
							</button>
							<button type='button' className='icon-btn icon-btn-sm' aria-label={`Supprimer /${command.name}`} onClick={() => void remove(command)}>
								<Icon name='trash' size={16} />
							</button>
						</li>
					))}
				</ul>
			)}
			{error && <p className='notice notice-error'>{error}</p>}
		</div>
	);
}

function CommandForm({ workspaceId, command, onDone }: { workspaceId: string; command?: CommandConfig; onDone: () => void }) {
	const [secret, setSecret] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const data = new FormData(event.currentTarget);
		const input: CommandInput = {
			name: String(data.get('name') ?? ''),
			description: String(data.get('description') ?? ''),
			usage: String(data.get('usage') ?? ''),
			url: String(data.get('url') ?? ''),
			ephemeral: data.get('visibility') === 'ephemeral',
			...(secret ? { secret } : {}),
		};
		setBusy(true);
		setError(null);
		try {
			await (command ? api('PATCH', `/w/${workspaceId}/commands/${command.id}`, input) : api('POST', `/w/${workspaceId}/commands`, input));
			onDone();
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<form className='stack' onSubmit={(e) => void submit(e)}>
			<label className='field'>
				Nom
				<input name='name' required maxLength={32} pattern='[a-z0-9][a-z0-9_\-]{0,31}' defaultValue={command?.name} placeholder='deploy' autoFocus spellCheck={false} />
				<span className='field-hint'>Sans la barre oblique. Minuscules, chiffres, - et _.</span>
			</label>
			<label className='field'>
				Description
				<input name='description' maxLength={COMMAND_LIMITS.descriptionLength} defaultValue={command?.description} placeholder='Déployer une branche' />
			</label>
			<label className='field'>
				Aide des arguments
				<input name='usage' maxLength={COMMAND_LIMITS.usageLength} defaultValue={command?.usage} placeholder='[branche] [environnement]' />
			</label>
			<label className='field'>
				URL de requête
				<input name='url' type='url' required maxLength={COMMAND_LIMITS.urlLength} defaultValue={command?.url} placeholder='https://exemple.fr/synq/commande' spellCheck={false} />
				<span className='field-hint'>https vers une adresse publique. Réponse attendue en 5 secondes, JSON {'{ text, ephemeral }'} de 16 Ko max.</span>
			</label>
			<div className='field'>
				<label htmlFor='command-secret'>Secret de signature</label>
				<div className='inline-form'>
					<input
						id='command-secret'
						value={secret}
						onChange={(e) => setSecret(e.target.value)}
						required={!command}
						minLength={COMMAND_LIMITS.secretMin}
						maxLength={COMMAND_LIMITS.secretMax}
						placeholder={command ? 'Inchangé si vide' : `${COMMAND_LIMITS.secretMin} caractères minimum`}
						autoComplete='off'
						spellCheck={false}
						className='cmd-secret'
					/>
					<button type='button' className='btn' onClick={() => setSecret(randomSecret())}>
						Générer
					</button>
				</div>
				<span className='field-hint'>
					Jamais réaffiché après l’enregistrement : copie-le dans ton service. Chaque appel porte X-Synq-Timestamp (secondes) et X-Synq-Signature = sha256= suivi du
					HMAC-SHA256 hexadécimal de « horodatage.corps ». Refuse les appels de plus de 5 minutes.
				</span>
			</div>
			<fieldset className='cmd-visibility-field'>
				<legend>Réponse</legend>
				<label className='check'>
					<input type='radio' name='visibility' value='channel' defaultChecked={!command?.ephemeral} /> Publiée dans le salon
				</label>
				<label className='check'>
					<input type='radio' name='visibility' value='ephemeral' defaultChecked={command?.ephemeral} /> Visible par l’auteur de la commande seulement
				</label>
			</fieldset>
			{error && <p className='notice notice-error'>{error}</p>}
			<div className='row'>
				<button className='btn btn-primary' disabled={busy}>
					{command ? 'Enregistrer' : 'Créer la commande'}
				</button>
				<button type='button' className='btn btn-ghost' onClick={onDone}>
					Annuler
				</button>
			</div>
		</form>
	);
}
