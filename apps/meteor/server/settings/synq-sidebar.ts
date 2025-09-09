import { settingsRegistry } from '../../app/settings/server';

export const createSynqSidebarSettings = () =>
	settingsRegistry.addGroup('Synq_Sidebar', async function () {
		await this.section('Channel_Categories', async function () {
			// Activer les catégories de canaux
			await this.add('Synq_Sidebar_Categories_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Sidebar_Categories_Enabled',
				i18nDescription: 'Synq_Sidebar_Categories_Enabled_Description',
				invalidValue: true,
			});

			// Configuration des catégories par défaut
			await this.add('Synq_Sidebar_Default_Categories', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Sidebar_Default_Categories',
				i18nDescription: 'Synq_Sidebar_Default_Categories_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Sidebar_Categories_Enabled',
					value: true,
				},
			});

			// Permettre aux utilisateurs de créer des catégories
			await this.add('Synq_Sidebar_Allow_User_Categories', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Sidebar_Allow_User_Categories',
				i18nDescription: 'Synq_Sidebar_Allow_User_Categories_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Sidebar_Categories_Enabled',
					value: true,
				},
			});

			// Permettre aux utilisateurs de réorganiser les catégories
			await this.add('Synq_Sidebar_Allow_Reorder', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Sidebar_Allow_Reorder',
				i18nDescription: 'Synq_Sidebar_Allow_Reorder_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Sidebar_Categories_Enabled',
					value: true,
				},
			});
		});

		await this.section('Sidebar_Appearance', async function () {
			// Afficher les icônes des catégories
			await this.add('Synq_Sidebar_Show_Category_Icons', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Sidebar_Show_Category_Icons',
				i18nDescription: 'Synq_Sidebar_Show_Category_Icons_Description',
				invalidValue: true,
			});

			// Afficher le nombre de canaux par catégorie
			await this.add('Synq_Sidebar_Show_Channel_Count', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Sidebar_Show_Channel_Count',
				i18nDescription: 'Synq_Sidebar_Show_Channel_Count_Description',
				invalidValue: true,
			});

			// Permettre de replier les catégories
			await this.add('Synq_Sidebar_Collapsible_Categories', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Sidebar_Collapsible_Categories',
				i18nDescription: 'Synq_Sidebar_Collapsible_Categories_Description',
				invalidValue: true,
			});

			// État par défaut des catégories (repliées/dépliées)
			await this.add('Synq_Sidebar_Default_Collapsed', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Sidebar_Default_Collapsed',
				i18nDescription: 'Synq_Sidebar_Default_Collapsed_Description',
				invalidValue: false,
			});
		});

		await this.section('Favorites_System', async function () {
			// Activer le système de favoris amélioré
			await this.add('Synq_Sidebar_Enhanced_Favorites', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Sidebar_Enhanced_Favorites',
				i18nDescription: 'Synq_Sidebar_Enhanced_Favorites_Description',
				invalidValue: true,
			});

			// Afficher les favoris en haut
			await this.add('Synq_Sidebar_Favorites_At_Top', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Sidebar_Favorites_At_Top',
				i18nDescription: 'Synq_Sidebar_Favorites_At_Top_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Sidebar_Enhanced_Favorites',
					value: true,
				},
			});

			// Limite du nombre de favoris
			await this.add('Synq_Sidebar_Favorites_Limit', 10, {
				type: 'int',
				public: true,
				i18nLabel: 'Synq_Sidebar_Favorites_Limit',
				i18nDescription: 'Synq_Sidebar_Favorites_Limit_Description',
				invalidValue: 10,
				enableQuery: {
					_id: 'Synq_Sidebar_Enhanced_Favorites',
					value: true,
				},
			});
		});

		await this.section('Advanced_Features', async function () {
			// Activer la recherche dans la sidebar
			await this.add('Synq_Sidebar_Enable_Search', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Sidebar_Enable_Search',
				i18nDescription: 'Synq_Sidebar_Enable_Search_Description',
				invalidValue: true,
			});

			// Afficher les canaux récents
			await this.add('Synq_Sidebar_Show_Recent_Channels', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Sidebar_Show_Recent_Channels',
				i18nDescription: 'Synq_Sidebar_Show_Recent_Channels_Description',
				invalidValue: true,
			});

			// Nombre de canaux récents à afficher
			await this.add('Synq_Sidebar_Recent_Channels_Limit', 5, {
				type: 'int',
				public: true,
				i18nLabel: 'Synq_Sidebar_Recent_Channels_Limit',
				i18nDescription: 'Synq_Sidebar_Recent_Channels_Limit_Description',
				invalidValue: 5,
				enableQuery: {
					_id: 'Synq_Sidebar_Show_Recent_Channels',
					value: true,
				},
			});

			// Activer les raccourcis clavier
			await this.add('Synq_Sidebar_Keyboard_Shortcuts', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Sidebar_Keyboard_Shortcuts',
				i18nDescription: 'Synq_Sidebar_Keyboard_Shortcuts_Description',
				invalidValue: true,
			});
		});
	});
