const DAY = 24 * 3600 * 1000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const weekday = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const shortDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const yearDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const clock = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

// « 9 h », « 14 h 30 » : forme française des heures.
export function hourText(at: number): string {
	const d = new Date(at);
	const minutes = d.getMinutes();
	return `${d.getHours()} h${minutes ? ` ${String(minutes).padStart(2, '0')}` : ''}`;
}

// Échéance à venir : « aujourd’hui à 9 h », « demain à 9 h », « lundi à 9 h », « lun. 3 nov. à 9 h ».
export function whenText(at: number, now = Date.now()): string {
	const days = Math.round((startOfDay(new Date(at)) - startOfDay(new Date(now))) / DAY);
	const hour = hourText(at);
	if (days === 0) {
		return `aujourd’hui à ${hour}`;
	}
	if (days === 1) {
		return `demain à ${hour}`;
	}
	if (days > 1 && days < 7) {
		return `${weekday.format(at)} à ${hour}`;
	}
	return `${new Date(at).getFullYear() === new Date(now).getFullYear() ? shortDate.format(at) : yearDate.format(at)} à ${hour}`;
}

// Date passée : heure si aujourd'hui, sinon jour.
export function pastText(at: number, now = Date.now()): string {
	const days = Math.round((startOfDay(new Date(now)) - startOfDay(new Date(at))) / DAY);
	if (days === 0) {
		return clock.format(at);
	}
	if (days === 1) {
		return 'hier';
	}
	return new Date(at).getFullYear() === new Date(now).getFullYear() ? shortDate.format(at) : yearDate.format(at);
}

export const dayText = (at: number) => shortDate.format(at);

export function presets(now = new Date()): Array<{ label: string; at: number }> {
	const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9);
	const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((8 - now.getDay()) % 7 || 7), 9);
	return [
		{ label: 'Demain à 9 h', at: tomorrow.getTime() },
		{ label: 'Lundi à 9 h', at: monday.getTime() },
	];
}

const pad = (n: number) => String(n).padStart(2, '0');

// Valeurs des champs date et heure, en heure locale.
export const dateField = (at: number) => {
	const d = new Date(at);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const timeField = (at: number) => {
	const d = new Date(at);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function fromFields(date: string, time: string): number | null {
	const [y, m, d] = date.split('-').map(Number);
	const [h, min] = time.split(':').map(Number);
	if (!y || !m || !d || h === undefined || min === undefined || Number.isNaN(h) || Number.isNaN(min)) {
		return null;
	}
	return new Date(y, m - 1, d, h, min).getTime();
}
