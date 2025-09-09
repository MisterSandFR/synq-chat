import { useEffect } from 'react';
import { useSettings } from '@rocket.chat/ui-contexts';

export const useSynqBranding = () => {
	const settings = useSettings();

	useEffect(() => {
		// Appliquer les couleurs personnalisées
		const root = document.documentElement;
		
		// Couleurs principales
		if (settings.Synq_Primary_Color) {
			root.style.setProperty('--rc-color-primary', settings.Synq_Primary_Color);
		}
		
		if (settings.Synq_Secondary_Color) {
			root.style.setProperty('--rc-color-secondary', settings.Synq_Secondary_Color);
		}
		
		if (settings.Synq_Accent_Color) {
			root.style.setProperty('--rc-color-accent', settings.Synq_Accent_Color);
		}
		
		if (settings.Synq_Background_Color) {
			root.style.setProperty('--rc-color-background', settings.Synq_Background_Color);
		}
		
		if (settings.Synq_Text_Color) {
			root.style.setProperty('--rc-color-text', settings.Synq_Text_Color);
		}

		// Couleurs de la sidebar
		if (settings.Synq_Sidebar_Background_Color) {
			root.style.setProperty('--rc-color-sidebar-background', settings.Synq_Sidebar_Background_Color);
		}
		
		if (settings.Synq_Sidebar_Text_Color) {
			root.style.setProperty('--rc-color-sidebar-text', settings.Synq_Sidebar_Text_Color);
		}
		
		if (settings.Synq_Sidebar_Hover_Color) {
			root.style.setProperty('--rc-color-sidebar-hover', settings.Synq_Sidebar_Hover_Color);
		}

		// Couleurs de la page de connexion
		if (settings.Synq_Login_Background_Color) {
			root.style.setProperty('--rc-color-login-background', settings.Synq_Login_Background_Color);
		}

		// Appliquer le CSS personnalisé
		if (settings.Synq_Custom_CSS) {
			let customStyleElement = document.getElementById('synq-custom-css');
			if (!customStyleElement) {
				customStyleElement = document.createElement('style');
				customStyleElement.id = 'synq-custom-css';
				document.head.appendChild(customStyleElement);
			}
			customStyleElement.textContent = settings.Synq_Custom_CSS;
		}

		// Appliquer le JavaScript personnalisé
		if (settings.Synq_Custom_JavaScript) {
			let customScriptElement = document.getElementById('synq-custom-js');
			if (!customScriptElement) {
				customScriptElement = document.createElement('script');
				customScriptElement.id = 'synq-custom-js';
				document.head.appendChild(customScriptElement);
			}
			customScriptElement.textContent = settings.Synq_Custom_JavaScript;
		}

		// Appliquer le thème sombre par défaut
		if (settings.Synq_Default_Dark_Theme) {
			root.classList.add('dark-theme');
		} else {
			root.classList.remove('dark-theme');
		}

		// Appliquer le favicon personnalisé
		if (settings.Synq_Favicon) {
			let favicon = document.querySelector('link[rel="icon"]') as HTMLLinkElement;
			if (!favicon) {
				favicon = document.createElement('link');
				favicon.rel = 'icon';
				document.head.appendChild(favicon);
			}
			favicon.href = settings.Synq_Favicon;
		}

		// Appliquer le logo personnalisé
		if (settings.Synq_Logo) {
			const logoElements = document.querySelectorAll('.rc-logo, .logo, [data-logo]');
			logoElements.forEach((element) => {
				if (element instanceof HTMLImageElement) {
					element.src = settings.Synq_Logo;
				} else {
					element.style.backgroundImage = `url(${settings.Synq_Logo})`;
					element.style.backgroundSize = 'contain';
					element.style.backgroundRepeat = 'no-repeat';
					element.style.backgroundPosition = 'center';
				}
			});
		}

		// Appliquer le logo sombre si disponible
		if (settings.Synq_Logo_Dark && root.classList.contains('dark-theme')) {
			const logoElements = document.querySelectorAll('.rc-logo, .logo, [data-logo]');
			logoElements.forEach((element) => {
				if (element instanceof HTMLImageElement) {
					element.src = settings.Synq_Logo_Dark;
				} else {
					element.style.backgroundImage = `url(${settings.Synq_Logo_Dark})`;
				}
			});
		}

		// Appliquer le nom du workspace
		if (settings.Synq_Workspace_Name) {
			const titleElements = document.querySelectorAll('[data-workspace-name]');
			titleElements.forEach((element) => {
				element.textContent = settings.Synq_Workspace_Name;
			});
			
			// Mettre à jour le titre de la page
			document.title = settings.Synq_Workspace_Name;
		}

	}, [settings]);

	return {
		workspaceName: settings.Synq_Workspace_Name,
		logo: settings.Synq_Logo,
		logoDark: settings.Synq_Logo_Dark,
		favicon: settings.Synq_Favicon,
		primaryColor: settings.Synq_Primary_Color,
		secondaryColor: settings.Synq_Secondary_Color,
		accentColor: settings.Synq_Accent_Color,
		backgroundColor: settings.Synq_Background_Color,
		textColor: settings.Synq_Text_Color,
		loginBackgroundImage: settings.Synq_Login_Background_Image,
		loginBackgroundColor: settings.Synq_Login_Background_Color,
		loginWelcomeText: settings.Synq_Login_Welcome_Text,
		loginSubtitleText: settings.Synq_Login_Subtitle_Text,
		loginHideLogo: settings.Synq_Login_Hide_Logo,
		loginHideTitle: settings.Synq_Login_Hide_Title,
		sidebarBackgroundColor: settings.Synq_Sidebar_Background_Color,
		sidebarTextColor: settings.Synq_Sidebar_Text_Color,
		sidebarHoverColor: settings.Synq_Sidebar_Hover_Color,
		customCSS: settings.Synq_Custom_CSS,
		customJavaScript: settings.Synq_Custom_JavaScript,
		defaultDarkTheme: settings.Synq_Default_Dark_Theme,
	};
};
