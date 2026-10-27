import { ACCENTS } from '../../../shared/types';
import { Icon } from '../../ui';

export function Swatches({ value, onPick, allowNone, disabled }: { value: string; onPick: (color: string) => void; allowNone?: boolean; disabled?: boolean }) {
	return (
		<div className='swatches'>
			{allowNone && (
				<button type='button' className='swatch swatch-none' aria-label='Sans couleur' aria-pressed={value === ''} disabled={disabled} onClick={() => onPick('')}>
					<Icon name='close' size={14} />
				</button>
			)}
			{ACCENTS.map((color) => (
				<button key={color} type='button' className='swatch' style={{ background: color }} aria-label={`Couleur ${color}`} aria-pressed={value.toUpperCase() === color} disabled={disabled} onClick={() => onPick(color)} />
			))}
			<label className='swatch' style={{ display: 'grid', placeItems: 'center', background: 'var(--surface)', cursor: disabled ? 'default' : 'pointer' }} title='Couleur personnalisée'>
				<Icon name='plus' size={14} />
				<input type='color' className='sr-only' defaultValue={value || '#6A4BFF'} disabled={disabled} onChange={(e) => onPick(e.target.value)} aria-label='Couleur personnalisée' />
			</label>
		</div>
	);
}
