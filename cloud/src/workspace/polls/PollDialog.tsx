import { useState, type FormEvent } from 'react';

import { POLL_DURATIONS, POLL_LIMITS, type PollInput } from '../../../shared/polls';
import { api, errorText } from '../../api';
import { Dialog, Icon } from '../../ui';
import { EmojiPicker, rememberEmoji } from '../chat/EmojiPicker';
import { CustomEmojiImg, customOf } from '../emojis/customEmojis';
import type { Lookup } from '../richText';
import './polls.css';

type Draft = { key: number; text: string; emoji: string };

type Props = { workspaceId: string; channelId: string; threadRoot?: number | null; lookup: Lookup; initialQuestion: string; onClose: () => void };

let nextKey = 0;
const blank = (): Draft => ({ key: nextKey++, text: '', emoji: '' });

export function PollDialog({ workspaceId, channelId, threadRoot = null, lookup, initialQuestion, onClose }: Props) {
	const [question, setQuestion] = useState(initialQuestion);
	const [options, setOptions] = useState<Draft[]>(() => [blank(), blank()]);
	const [multiple, setMultiple] = useState(false);
	const [anonymous, setAnonymous] = useState(false);
	const [allowAdd, setAllowAdd] = useState(false);
	const [duration, setDuration] = useState(String(24 * 3_600_000));
	const [picker, setPicker] = useState<{ key: number; anchor: DOMRect } | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');

	const patch = (key: number, change: Partial<Draft>) => setOptions((list) => list.map((o) => (o.key === key ? { ...o, ...change } : o)));
	const move = (index: number, by: number) =>
		setOptions((list) => {
			const next = [...list];
			const [item] = next.splice(index, 1);
			next.splice(index + by, 0, item!);
			return next;
		});

	const filled = options.filter((o) => o.text.trim());

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (filled.length < POLL_LIMITS.minOptions) {
			setError(`Ajoute au moins ${POLL_LIMITS.minOptions} options`);
			return;
		}
		const body: PollInput = {
			question,
			options: filled.map((o) => ({ text: o.text, emoji: o.emoji })),
			multiple,
			anonymous,
			allowAdd,
			duration: duration === 'none' ? null : Number(duration),
			threadRoot,
		};
		setBusy(true);
		setError('');
		try {
			await api('POST', `/w/${workspaceId}/channels/${channelId}/polls`, body);
			onClose();
		} catch (err) {
			setError(errorText(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open onClose={onClose} title='Créer un sondage'>
			<form className='pld-form' onSubmit={submit}>
				<label className='field'>
					Question
					<input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={POLL_LIMITS.question} required autoFocus placeholder='Quel créneau pour la rétro ?' />
				</label>
				<fieldset className='pld-options'>
					<legend>Options</legend>
					{options.map((option, index) => {
						const custom = option.emoji ? customOf(option.emoji, lookup.emojis) : null;
						return (
							<div key={option.key} className='pld-option'>
								<button
									type='button'
									className='icon-btn pld-emoji'
									aria-label={option.emoji ? `Emoji ${option.emoji}, changer` : 'Ajouter un emoji'}
									onClick={(e) => setPicker({ key: option.key, anchor: e.currentTarget.getBoundingClientRect() })}
								>
									{option.emoji ? custom ? <CustomEmojiImg emoji={custom} /> : option.emoji : <Icon name='smile' size={16} />}
								</button>
								<input
									value={option.text}
									onChange={(e) => patch(option.key, { text: e.target.value })}
									maxLength={POLL_LIMITS.option}
									placeholder={`Option ${index + 1}`}
									aria-label={`Option ${index + 1}`}
								/>
								<span className='pld-tools'>
									<button type='button' className='icon-btn icon-btn-sm' aria-label='Monter' disabled={index === 0} onClick={() => move(index, -1)}>
										<Icon name='chevron-up' size={14} />
									</button>
									<button type='button' className='icon-btn icon-btn-sm' aria-label='Descendre' disabled={index === options.length - 1} onClick={() => move(index, 1)}>
										<Icon name='chevron' size={14} />
									</button>
									<button
										type='button'
										className='icon-btn icon-btn-sm'
										aria-label='Retirer l’option'
										disabled={options.length <= POLL_LIMITS.minOptions}
										onClick={() => setOptions((list) => list.filter((o) => o.key !== option.key))}
									>
										<Icon name='close' size={14} />
									</button>
								</span>
							</div>
						);
					})}
					{options.length < POLL_LIMITS.maxOptions && (
						<button type='button' className='btn btn-ghost pld-more' onClick={() => setOptions((list) => [...list, blank()])}>
							<Icon name='plus' size={16} /> Ajouter une option
						</button>
					)}
				</fieldset>
				<label className='field'>
					Durée
					<select value={duration} onChange={(e) => setDuration(e.target.value)}>
						{POLL_DURATIONS.map((d) => (
							<option key={d.label} value={d.value === null ? 'none' : String(d.value)}>
								{d.label}
							</option>
						))}
					</select>
				</label>
				<div className='pld-switches'>
					<label className='pld-switch'>
						<span>
							<strong>Choix multiple</strong>
							<span>Chacun peut cocher plusieurs options.</span>
						</span>
						<input type='checkbox' role='switch' className='pld-toggle' checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
					</label>
					<label className='pld-switch'>
						<span>
							<strong>Vote anonyme</strong>
							<span>Personne ne voit qui a voté quoi, toi compris.</span>
						</span>
						<input type='checkbox' role='switch' className='pld-toggle' checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
					</label>
					<label className='pld-switch'>
						<span>
							<strong>Options libres</strong>
							<span>Les participants peuvent proposer des options.</span>
						</span>
						<input type='checkbox' role='switch' className='pld-toggle' checked={allowAdd} onChange={(e) => setAllowAdd(e.target.checked)} />
					</label>
				</div>
				{error && (
					<p className='notice notice-error' role='alert'>
						{error}
					</p>
				)}
				<div className='pld-actions'>
					<button type='button' className='btn' onClick={onClose}>
						Annuler
					</button>
					<button className='btn btn-primary' disabled={busy || !question.trim() || filled.length < POLL_LIMITS.minOptions}>
						Publier le sondage
					</button>
				</div>
			</form>
			{picker && (
				<EmojiPicker
					anchor={picker.anchor}
					custom={lookup.emojis}
					onClose={() => setPicker(null)}
					onPick={(char) => {
						rememberEmoji(char);
						patch(picker.key, { emoji: char });
						setPicker(null);
					}}
				/>
			)}
		</Dialog>
	);
}
