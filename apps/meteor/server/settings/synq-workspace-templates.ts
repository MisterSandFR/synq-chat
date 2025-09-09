import { settingsRegistry } from '../../app/settings/server';

export const createSynqWorkspaceTemplatesSettings = () =>
	settingsRegistry.addGroup('Synq_Workspace_Templates', async function () {
		await this.section('Templates_Management', async function () {
			// Activer les templates de workspace
			await this.add('Synq_Workspace_Templates_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workspace_Templates_Enabled',
				i18nDescription: 'Synq_Workspace_Templates_Enabled_Description',
				invalidValue: true,
			});

			// Templates disponibles
			await this.add('Synq_Workspace_Templates_Available', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Templates_Available',
				i18nDescription: 'Synq_Workspace_Templates_Available_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});

			// Template par défaut
			await this.add('Synq_Workspace_Templates_Default', 'startup', {
				type: 'select',
				public: true,
				i18nLabel: 'Synq_Workspace_Templates_Default',
				i18nDescription: 'Synq_Workspace_Templates_Default_Description',
				values: [
					{ key: 'startup', i18nLabel: 'Startup_Template' },
					{ key: 'enterprise', i18nLabel: 'Enterprise_Template' },
					{ key: 'community', i18nLabel: 'Community_Template' },
					{ key: 'education', i18nLabel: 'Education_Template' },
					{ key: 'custom', i18nLabel: 'Custom_Template' },
				],
				invalidValue: 'startup',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});

			// Permettre aux utilisateurs de créer des templates personnalisés
			await this.add('Synq_Workspace_Templates_Allow_Custom', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workspace_Templates_Allow_Custom',
				i18nDescription: 'Synq_Workspace_Templates_Allow_Custom_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});
		});

		await this.section('Template_Startup', async function () {
			// Template Startup - canaux par défaut
			await this.add('Synq_Workspace_Template_Startup_Channels', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Template_Startup_Channels',
				i18nDescription: 'Synq_Workspace_Template_Startup_Channels_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});

			// Template Startup - rôles par défaut
			await this.add('Synq_Workspace_Template_Startup_Roles', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Template_Startup_Roles',
				i18nDescription: 'Synq_Workspace_Template_Startup_Roles_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});

			// Template Startup - intégrations par défaut
			await this.add('Synq_Workspace_Template_Startup_Integrations', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Template_Startup_Integrations',
				i18nDescription: 'Synq_Workspace_Template_Startup_Integrations_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});
		});

		await this.section('Template_Enterprise', async function () {
			// Template Enterprise - canaux par défaut
			await this.add('Synq_Workspace_Template_Enterprise_Channels', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Template_Enterprise_Channels',
				i18nDescription: 'Synq_Workspace_Template_Enterprise_Channels_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});

			// Template Enterprise - rôles par défaut
			await this.add('Synq_Workspace_Template_Enterprise_Roles', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Template_Enterprise_Roles',
				i18nDescription: 'Synq_Workspace_Template_Enterprise_Roles_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});

			// Template Enterprise - intégrations par défaut
			await this.add('Synq_Workspace_Template_Enterprise_Integrations', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Template_Enterprise_Integrations',
				i18nDescription: 'Synq_Workspace_Template_Enterprise_Integrations_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});
		});

		await this.section('Template_Community', async function () {
			// Template Community - canaux par défaut
			await this.add('Synq_Workspace_Template_Community_Channels', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Template_Community_Channels',
				i18nDescription: 'Synq_Workspace_Template_Community_Channels_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});

			// Template Community - rôles par défaut
			await this.add('Synq_Workspace_Template_Community_Roles', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Template_Community_Roles',
				i18nDescription: 'Synq_Workspace_Template_Community_Roles_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});

			// Template Community - intégrations par défaut
			await this.add('Synq_Workspace_Template_Community_Integrations', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Template_Community_Integrations',
				i18nDescription: 'Synq_Workspace_Template_Community_Integrations_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});
		});

		await this.section('Template_Education', async function () {
			// Template Education - canaux par défaut
			await this.add('Synq_Workspace_Template_Education_Channels', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Template_Education_Channels',
				i18nDescription: 'Synq_Workspace_Template_Education_Channels_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});

			// Template Education - rôles par défaut
			await this.add('Synq_Workspace_Template_Education_Roles', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Template_Education_Roles',
				i18nDescription: 'Synq_Workspace_Template_Education_Roles_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});

			// Template Education - intégrations par défaut
			await this.add('Synq_Workspace_Template_Education_Integrations', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workspace_Template_Education_Integrations',
				i18nDescription: 'Synq_Workspace_Template_Education_Integrations_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});
		});

		await this.section('Advanced_Features', async function () {
			// Auto-configuration lors de la création
			await this.add('Synq_Workspace_Templates_Auto_Configure', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workspace_Templates_Auto_Configure',
				i18nDescription: 'Synq_Workspace_Templates_Auto_Configure_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});

			// Migration automatique des anciens workspaces
			await this.add('Synq_Workspace_Templates_Auto_Migrate', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workspace_Templates_Auto_Migrate',
				i18nDescription: 'Synq_Workspace_Templates_Auto_Migrate_Description',
				invalidValue: false,
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});

			// Sauvegarde des templates personnalisés
			await this.add('Synq_Workspace_Templates_Backup_Custom', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workspace_Templates_Backup_Custom',
				i18nDescription: 'Synq_Workspace_Templates_Backup_Custom_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Workspace_Templates_Enabled',
					value: true,
				},
			});
		});
	});
