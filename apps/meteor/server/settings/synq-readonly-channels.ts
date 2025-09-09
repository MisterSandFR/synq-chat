import { settingsRegistry } from '../../app/settings/server';

export const createSynqReadOnlyChannelsSettings = () =>
	settingsRegistry.addGroup('Synq_ReadOnly_Channels', async function () {
		await this.section('Read_Only_Configuration', async function () {
			// Activer les canaux en lecture seule
			await this.add('Synq_ReadOnly_Channels_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_Enabled',
				i18nDescription: 'Synq_ReadOnly_Channels_Enabled_Description',
				invalidValue: true,
			});

			// Permissions par défaut pour les canaux en lecture seule
			await this.add('Synq_ReadOnly_Channels_Default_Permissions', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_Default_Permissions',
				i18nDescription: 'Synq_ReadOnly_Channels_Default_Permissions_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_Enabled',
					value: true,
				},
			});

			// Rôles autorisés à écrire dans les canaux en lecture seule
			await this.add('Synq_ReadOnly_Channels_Write_Roles', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_Write_Roles',
				i18nDescription: 'Synq_ReadOnly_Channels_Write_Roles_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_Enabled',
					value: true,
				},
			});

			// Rôles autorisés à modérer les canaux en lecture seule
			await this.add('Synq_ReadOnly_Channels_Moderate_Roles', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_Moderate_Roles',
				i18nDescription: 'Synq_ReadOnly_Channels_Moderate_Roles_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_Enabled',
					value: true,
				},
			});
		});

		await this.section('Q_A_Features', async function () {
			// Activer le système Q&A
			await this.add('Synq_ReadOnly_Channels_QA_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_QA_Enabled',
				i18nDescription: 'Synq_ReadOnly_Channels_QA_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_Enabled',
					value: true,
				},
			});

			// Types de questions autorisées
			await this.add('Synq_ReadOnly_Channels_QA_Question_Types', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_QA_Question_Types',
				i18nDescription: 'Synq_ReadOnly_Channels_QA_Question_Types_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_QA_Enabled',
					value: true,
				},
			});

			// Modération des questions
			await this.add('Synq_ReadOnly_Channels_QA_Moderation', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_QA_Moderation',
				i18nDescription: 'Synq_ReadOnly_Channels_QA_Moderation_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_QA_Enabled',
					value: true,
				},
			});

			// Notifications pour les nouvelles questions
			await this.add('Synq_ReadOnly_Channels_QA_Notifications', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_QA_Notifications',
				i18nDescription: 'Synq_ReadOnly_Channels_QA_Notifications_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_QA_Enabled',
					value: true,
				},
			});
		});

		await this.section('Announcement_Channels', async function () {
			// Canaux d'annonces par défaut
			await this.add('Synq_ReadOnly_Channels_Announcement_Channels', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_Announcement_Channels',
				i18nDescription: 'Synq_ReadOnly_Channels_Announcement_Channels_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_Enabled',
					value: true,
				},
			});

			// Template pour les annonces
			await this.add('Synq_ReadOnly_Channels_Announcement_Template', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_Announcement_Template',
				i18nDescription: 'Synq_ReadOnly_Channels_Announcement_Template_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_Enabled',
					value: true,
				},
			});

			// Formatage des annonces
			await this.add('Synq_ReadOnly_Channels_Announcement_Formatting', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_Announcement_Formatting',
				i18nDescription: 'Synq_ReadOnly_Channels_Announcement_Formatting_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_Enabled',
					value: true,
				},
			});

			// Pin automatique des annonces importantes
			await this.add('Synq_ReadOnly_Channels_Auto_Pin_Important', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_Auto_Pin_Important',
				i18nDescription: 'Synq_ReadOnly_Channels_Auto_Pin_Important_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_Enabled',
					value: true,
				},
			});
		});

		await this.section('Advanced_Features', async function () {
			// Réactions sur les messages en lecture seule
			await this.add('Synq_ReadOnly_Channels_Reactions_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_Reactions_Enabled',
				i18nDescription: 'Synq_ReadOnly_Channels_Reactions_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_Enabled',
					value: true,
				},
			});

			// Threads sur les messages en lecture seule
			await this.add('Synq_ReadOnly_Channels_Threads_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_Threads_Enabled',
				i18nDescription: 'Synq_ReadOnly_Channels_Threads_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_Enabled',
					value: true,
				},
			});

			// Partage de messages
			await this.add('Synq_ReadOnly_Channels_Share_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_Share_Enabled',
				i18nDescription: 'Synq_ReadOnly_Channels_Share_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_Enabled',
					value: true,
				},
			});

			// Bookmarks des messages importants
			await this.add('Synq_ReadOnly_Channels_Bookmarks_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_ReadOnly_Channels_Bookmarks_Enabled',
				i18nDescription: 'Synq_ReadOnly_Channels_Bookmarks_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_ReadOnly_Channels_Enabled',
					value: true,
				},
			});
		});
	});
