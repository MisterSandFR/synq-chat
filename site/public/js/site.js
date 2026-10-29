// Rail des fonctions : marque le module visible, comme l'app active dans la barre de Synq.
const links = [...document.querySelectorAll('.rail a')];
const modules = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);

if (modules.length && 'IntersectionObserver' in window) {
	const visible = new Map();
	const mark = () => {
		let best = null;
		for (const el of modules) {
			if (visible.get(el) && (!best || el.offsetTop < best.offsetTop)) {
				best = el;
			}
		}
		if (!best) {
			return;
		}
		for (const a of links) {
			a.setAttribute('aria-current', a.getAttribute('href') === '#' + best.id ? 'true' : 'false');
		}
	};
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				visible.set(entry.target, entry.isIntersecting);
			}
			mark();
		},
		{ rootMargin: '-35% 0px -55% 0px' },
	);
	modules.forEach((el) => observer.observe(el));
}

// Ferme le menu mobile après un choix ou un clic ailleurs.
const menu = document.querySelector('.menu');
if (menu) {
	menu.addEventListener('click', (event) => {
		if (event.target.closest('a')) {
			menu.open = false;
		}
	});
	document.addEventListener('click', (event) => {
		if (menu.open && !menu.contains(event.target)) {
			menu.open = false;
		}
	});
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape' && menu.open) {
			menu.open = false;
			menu.querySelector('summary').focus();
		}
	});
}
