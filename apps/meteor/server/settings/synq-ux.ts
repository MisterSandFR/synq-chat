import { settingsRegistry } from '../../app/settings/server';

export const createSynqUXSettings = () =>
	settingsRegistry.addGroup('Synq_UX', async function () {
		await this.section('Simplified_Interface', async function () {
			// Activer l'interface simplifiée
			await this.add('Synq_UX_Simplified_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Simplified_Enabled',
				i18nDescription: 'Synq_UX_Simplified_Enabled_Description',
				invalidValue: true,
			});

			// Masquer les menus complexes
			await this.add('Synq_UX_Hide_Complex_Menus', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Hide_Complex_Menus',
				i18nDescription: 'Synq_UX_Hide_Complex_Menus_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Simplified_Enabled',
					value: true,
				},
			});

			// Interface en mode "débutant"
			await this.add('Synq_UX_Beginner_Mode', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Beginner_Mode',
				i18nDescription: 'Synq_UX_Beginner_Mode_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Simplified_Enabled',
					value: true,
				},
			});

			// Masquer les fonctionnalités avancées
			await this.add('Synq_UX_Hide_Advanced_Features', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Hide_Advanced_Features',
				i18nDescription: 'Synq_UX_Hide_Advanced_Features_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Simplified_Enabled',
					value: true,
				},
			});
		});

		await this.section('Onboarding', async function () {
			// Activer l'onboarding amélioré
			await this.add('Synq_UX_Onboarding_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Onboarding_Enabled',
				i18nDescription: 'Synq_UX_Onboarding_Enabled_Description',
				invalidValue: true,
			});

			// Assistant de configuration
			await this.add('Synq_UX_Setup_Wizard_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Setup_Wizard_Enabled',
				i18nDescription: 'Synq_UX_Setup_Wizard_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Onboarding_Enabled',
					value: true,
				},
			});

			// Tours guidés
			await this.add('Synq_UX_Guided_Tours_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Guided_Tours_Enabled',
				i18nDescription: 'Synq_UX_Guided_Tours_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Onboarding_Enabled',
					value: true,
				},
			});

			// Conseils contextuels
			await this.add('Synq_UX_Contextual_Tips_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Contextual_Tips_Enabled',
				i18nDescription: 'Synq_UX_Contextual_Tips_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Onboarding_Enabled',
					value: true,
				},
			});

			// Création de compte simplifiée
			await this.add('Synq_UX_Simplified_Registration', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Simplified_Registration',
				i18nDescription: 'Synq_UX_Simplified_Registration_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Onboarding_Enabled',
					value: true,
				},
			});
		});

		await this.section('Navigation', async function () {
			// Sidebar simplifiée
			await this.add('Synq_UX_Simplified_Sidebar', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Simplified_Sidebar',
				i18nDescription: 'Synq_UX_Simplified_Sidebar_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Simplified_Enabled',
					value: true,
				},
			});

			// Menu principal simplifié
			await this.add('Synq_UX_Simplified_Main_Menu', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Simplified_Main_Menu',
				i18nDescription: 'Synq_UX_Simplified_Main_Menu_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Simplified_Enabled',
					value: true,
				},
			});

			// Barre d'outils simplifiée
			await this.add('Synq_UX_Simplified_Toolbar', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Simplified_Toolbar',
				i18nDescription: 'Synq_UX_Simplified_Toolbar_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Simplified_Enabled',
					value: true,
				},
			});

			// Raccourcis clavier simplifiés
			await this.add('Synq_UX_Simplified_Shortcuts', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Simplified_Shortcuts',
				i18nDescription: 'Synq_UX_Simplified_Shortcuts_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Simplified_Enabled',
					value: true,
				},
			});
		});

		await this.section('Help_And_Support', async function () {
			// Centre d'aide intégré
			await this.add('Synq_UX_Help_Center_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Help_Center_Enabled',
				i18nDescription: 'Synq_UX_Help_Center_Enabled_Description',
				invalidValue: true,
			});

			// Chat de support intégré
			await this.add('Synq_UX_Support_Chat_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Support_Chat_Enabled',
				i18nDescription: 'Synq_UX_Support_Chat_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Help_Center_Enabled',
					value: true,
				},
			});

			// Documentation contextuelle
			await this.add('Synq_UX_Contextual_Docs_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Contextual_Docs_Enabled',
				i18nDescription: 'Synq_UX_Contextual_Docs_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Help_Center_Enabled',
					value: true,
				},
			});

			// FAQ intégrée
			await this.add('Synq_UX_Integrated_FAQ_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Integrated_FAQ_Enabled',
				i18nDescription: 'Synq_UX_Integrated_FAQ_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_UX_Help_Center_Enabled',
					value: true,
				},
			});
		});

		await this.section('Accessibility', async function () {
			// Mode contraste élevé
			await this.add('Synq_UX_High_Contrast_Mode', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_High_Contrast_Mode',
				i18nDescription: 'Synq_UX_High_Contrast_Mode_Description',
				invalidValue: false,
			});

			// Taille de police ajustable
			await this.add('Synq_UX_Adjustable_Font_Size', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Adjustable_Font_Size',
				i18nDescription: 'Synq_UX_Adjustable_Font_Size_Description',
				invalidValue: true,
			});

			// Navigation au clavier
			await this.add('Synq_UX_Keyboard_Navigation', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Keyboard_Navigation',
				i18nDescription: 'Synq_UX_Keyboard_Navigation_Description',
				invalidValue: true,
			});

			// Support des lecteurs d'écran
			await this.add('Synq_UX_Screen_Reader_Support', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_UX_Screen_Reader_Support',
				i18nDescription: 'Synq_UX_Screen_Reader_Support_Description',
				invalidValue: true,
			});
		});
	});
