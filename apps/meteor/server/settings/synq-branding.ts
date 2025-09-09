import { settingsRegistry } from '../../app/settings/server';

export const createSynqBrandingSettings = () =>
	settingsRegistry.addGroup('Synq_Branding', async function () {
		await this.section('Workspace_Branding', async function () {
			// Nom du workspace
			await this.add('Synq_Workspace_Name', 'Synq', {
				type: 'string',
				public: true,
				i18nLabel: 'Synq_Workspace_Name',
				i18nDescription: 'Synq_Workspace_Name_Description',
				invalidValue: 'Synq',
			});

			// Logo personnalisé
			await this.add('Synq_Logo', '', {
				type: 'asset',
				public: true,
				i18nLabel: 'Synq_Logo',
				i18nDescription: 'Synq_Logo_Description',
				invalidValue: '',
			});

			// Logo pour thème sombre
			await this.add('Synq_Logo_Dark', '', {
				type: 'asset',
				public: true,
				i18nLabel: 'Synq_Logo_Dark',
				i18nDescription: 'Synq_Logo_Dark_Description',
				invalidValue: '',
			});

			// Favicon personnalisé
			await this.add('Synq_Favicon', '', {
				type: 'asset',
				public: true,
				i18nLabel: 'Synq_Favicon',
				i18nDescription: 'Synq_Favicon_Description',
				invalidValue: '',
			});

			// Couleur primaire
			await this.add('Synq_Primary_Color', '#1d74f5', {
				type: 'color',
				public: true,
				i18nLabel: 'Synq_Primary_Color',
				i18nDescription: 'Synq_Primary_Color_Description',
				invalidValue: '#1d74f5',
			});

			// Couleur secondaire
			await this.add('Synq_Secondary_Color', '#f5455c', {
				type: 'color',
				public: true,
				i18nLabel: 'Synq_Secondary_Color',
				i18nDescription: 'Synq_Secondary_Color_Description',
				invalidValue: '#f5455c',
			});

			// Couleur d'accent
			await this.add('Synq_Accent_Color', '#ffd21f', {
				type: 'color',
				public: true,
				i18nLabel: 'Synq_Accent_Color',
				i18nDescription: 'Synq_Accent_Color_Description',
				invalidValue: '#ffd21f',
			});

			// Couleur de fond
			await this.add('Synq_Background_Color', '#ffffff', {
				type: 'color',
				public: true,
				i18nLabel: 'Synq_Background_Color',
				i18nDescription: 'Synq_Background_Color_Description',
				invalidValue: '#ffffff',
			});

			// Couleur de texte
			await this.add('Synq_Text_Color', '#2f343d', {
				type: 'color',
				public: true,
				i18nLabel: 'Synq_Text_Color',
				i18nDescription: 'Synq_Text_Color_Description',
				invalidValue: '#2f343d',
			});
		});

		await this.section('Login_Page_Customization', async function () {
			// Image de fond pour la page de login
			await this.add('Synq_Login_Background_Image', '', {
				type: 'asset',
				public: true,
				i18nLabel: 'Synq_Login_Background_Image',
				i18nDescription: 'Synq_Login_Background_Image_Description',
				invalidValue: '',
			});

			// Couleur de fond pour la page de login
			await this.add('Synq_Login_Background_Color', '#f7f8fa', {
				type: 'color',
				public: true,
				i18nLabel: 'Synq_Login_Background_Color',
				i18nDescription: 'Synq_Login_Background_Color_Description',
				invalidValue: '#f7f8fa',
			});

			// Texte personnalisé pour la page de login
			await this.add('Synq_Login_Welcome_Text', 'Bienvenue sur Synq', {
				type: 'string',
				public: true,
				i18nLabel: 'Synq_Login_Welcome_Text',
				i18nDescription: 'Synq_Login_Welcome_Text_Description',
				invalidValue: 'Bienvenue sur Synq',
			});

			// Sous-titre personnalisé pour la page de login
			await this.add('Synq_Login_Subtitle_Text', 'Votre plateforme de communication souveraine', {
				type: 'string',
				public: true,
				i18nLabel: 'Synq_Login_Subtitle_Text',
				i18nDescription: 'Synq_Login_Subtitle_Text_Description',
				invalidValue: 'Votre plateforme de communication souveraine',
			});

			// Masquer le logo sur la page de login
			await this.add('Synq_Login_Hide_Logo', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Login_Hide_Logo',
				i18nDescription: 'Synq_Login_Hide_Logo_Description',
				invalidValue: false,
			});

			// Masquer le titre sur la page de login
			await this.add('Synq_Login_Hide_Title', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Login_Hide_Title',
				i18nDescription: 'Synq_Login_Hide_Title_Description',
				invalidValue: false,
			});
		});

		await this.section('Sidebar_Customization', async function () {
			// Couleur de fond de la sidebar
			await this.add('Synq_Sidebar_Background_Color', '#2f343d', {
				type: 'color',
				public: true,
				i18nLabel: 'Synq_Sidebar_Background_Color',
				i18nDescription: 'Synq_Sidebar_Background_Color_Description',
				invalidValue: '#2f343d',
			});

			// Couleur de texte de la sidebar
			await this.add('Synq_Sidebar_Text_Color', '#ffffff', {
				type: 'color',
				public: true,
				i18nLabel: 'Synq_Sidebar_Text_Color',
				i18nDescription: 'Synq_Sidebar_Text_Color_Description',
				invalidValue: '#ffffff',
			});

			// Couleur de survol de la sidebar
			await this.add('Synq_Sidebar_Hover_Color', '#3a4049', {
				type: 'color',
				public: true,
				i18nLabel: 'Synq_Sidebar_Hover_Color',
				i18nDescription: 'Synq_Sidebar_Hover_Color_Description',
				invalidValue: '#3a4049',
			});
		});

		await this.section('Advanced_Customization', async function () {
			// CSS personnalisé
			await this.add('Synq_Custom_CSS', '', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Custom_CSS',
				i18nDescription: 'Synq_Custom_CSS_Description',
				invalidValue: '',
			});

			// JavaScript personnalisé
			await this.add('Synq_Custom_JavaScript', '', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Custom_JavaScript',
				i18nDescription: 'Synq_Custom_JavaScript_Description',
				invalidValue: '',
			});

			// Activer le thème sombre par défaut
			await this.add('Synq_Default_Dark_Theme', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Default_Dark_Theme',
				i18nDescription: 'Synq_Default_Dark_Theme_Description',
				invalidValue: false,
			});
		});
	});
