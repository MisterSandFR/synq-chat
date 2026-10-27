import { useEffect, useState } from 'react';

import { readPref, writePref } from './router';

export type Theme = 'system' | 'light' | 'dark';

const read = (): Theme => {
	const saved = readPref('theme');
	return saved === 'light' || saved === 'dark' ? saved : 'system';
};

export function applyTheme(theme: Theme = read()): void {
	if (theme === 'system') {
		delete document.documentElement.dataset.theme;
	} else {
		document.documentElement.dataset.theme = theme;
	}
}

export function useTheme() {
	const [theme, setTheme] = useState<Theme>(read);
	useEffect(() => {
		applyTheme(theme);
		writePref('theme', theme);
	}, [theme]);
	return [theme, setTheme] as const;
}
