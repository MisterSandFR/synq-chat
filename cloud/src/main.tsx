import '@fontsource-variable/onest';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { applyTheme } from './theme';

applyTheme();

(window as Window & { __synqBooted?: boolean }).__synqBooted = true;
try {
	sessionStorage.removeItem('synq_boot_retry');
} catch {
	// Stockage indisponible.
}

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
