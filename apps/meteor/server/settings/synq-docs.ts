import { settingsRegistry } from '../../app/settings/server';

export const createSynqDocsSettings = () =>
	settingsRegistry.addGroup('Synq_Docs', async function () {
		await this.section('Collaborative_Docs', async function () {
			// Activer les docs collaboratifs
			await this.add('Synq_Docs_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Docs_Enabled',
				i18nDescription: 'Synq_Docs_Enabled_Description',
				invalidValue: true,
			});

			// Type d'éditeur (Etherpad, Pad, ou intégré)
			await this.add('Synq_Docs_Editor_Type', 'etherpad', {
				type: 'select',
				public: true,
				i18nLabel: 'Synq_Docs_Editor_Type',
				i18nDescription: 'Synq_Docs_Editor_Type_Description',
				values: [
					{ key: 'etherpad', i18nLabel: 'Etherpad' },
					{ key: 'pad', i18nLabel: 'Pad' },
					{ key: 'integrated', i18nLabel: 'Integrated_Editor' },
				],
				invalidValue: 'etherpad',
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});

			// URL du serveur Etherpad/Pad
			await this.add('Synq_Docs_Server_URL', 'http://localhost:9001', {
				type: 'string',
				public: true,
				i18nLabel: 'Synq_Docs_Server_URL',
				i18nDescription: 'Synq_Docs_Server_URL_Description',
				invalidValue: 'http://localhost:9001',
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});

			// API Key pour Etherpad
			await this.add('Synq_Docs_API_Key', '', {
				type: 'password',
				public: false,
				i18nLabel: 'Synq_Docs_API_Key',
				i18nDescription: 'Synq_Docs_API_Key_Description',
				invalidValue: '',
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});
		});

		await this.section('Document_Management', async function () {
			// Permissions par défaut pour les docs
			await this.add('Synq_Docs_Default_Permissions', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Docs_Default_Permissions',
				i18nDescription: 'Synq_Docs_Default_Permissions_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});

			// Durée de vie des docs (en jours)
			await this.add('Synq_Docs_Lifetime', 30, {
				type: 'int',
				public: true,
				i18nLabel: 'Synq_Docs_Lifetime',
				i18nDescription: 'Synq_Docs_Lifetime_Description',
				invalidValue: 30,
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});

			// Sauvegarde automatique
			await this.add('Synq_Docs_Auto_Save', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Docs_Auto_Save',
				i18nDescription: 'Synq_Docs_Auto_Save_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});

			// Versioning des docs
			await this.add('Synq_Docs_Versioning', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Docs_Versioning',
				i18nDescription: 'Synq_Docs_Versioning_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});
		});

		await this.section('Integration', async function () {
			// Intégration avec les canaux
			await this.add('Synq_Docs_Channel_Integration', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Docs_Channel_Integration',
				i18nDescription: 'Synq_Docs_Channel_Integration_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});

			// Notifications de changement
			await this.add('Synq_Docs_Change_Notifications', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Docs_Change_Notifications',
				i18nDescription: 'Synq_Docs_Change_Notifications_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});

			// Partage facile
			await this.add('Synq_Docs_Easy_Sharing', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Docs_Easy_Sharing',
				i18nDescription: 'Synq_Docs_Easy_Sharing_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});

			// Export des docs
			await this.add('Synq_Docs_Export_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Docs_Export_Enabled',
				i18nDescription: 'Synq_Docs_Export_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});
		});

		await this.section('Templates', async function () {
			// Templates de docs par défaut
			await this.add('Synq_Docs_Default_Templates', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Docs_Default_Templates',
				i18nDescription: 'Synq_Docs_Default_Templates_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});

			// Template de réunion
			await this.add('Synq_Docs_Meeting_Template', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Docs_Meeting_Template',
				i18nDescription: 'Synq_Docs_Meeting_Template_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});

			// Template de notes
			await this.add('Synq_Docs_Notes_Template', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Docs_Notes_Template',
				i18nDescription: 'Synq_Docs_Notes_Template_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});

			// Template de brainstorming
			await this.add('Synq_Docs_Brainstorming_Template', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Docs_Brainstorming_Template',
				i18nDescription: 'Synq_Docs_Brainstorming_Template_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Docs_Enabled',
					value: true,
				},
			});
		});
	});
