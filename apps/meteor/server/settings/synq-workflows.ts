import { settingsRegistry } from '../../app/settings/server';

export const createSynqWorkflowsSettings = () =>
	settingsRegistry.addGroup('Synq_Workflows', async function () {
		await this.section('Workflow_Engine', async function () {
			// Activer le moteur de workflows
			await this.add('Synq_Workflows_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workflows_Enabled',
				i18nDescription: 'Synq_Workflows_Enabled_Description',
				invalidValue: true,
			});

			// Moteur de workflows (Zapier, n8n, ou intégré)
			await this.add('Synq_Workflows_Engine', 'integrated', {
				type: 'select',
				public: true,
				i18nLabel: 'Synq_Workflows_Engine',
				i18nDescription: 'Synq_Workflows_Engine_Description',
				values: [
					{ key: 'integrated', i18nLabel: 'Integrated_Engine' },
					{ key: 'zapier', i18nLabel: 'Zapier' },
					{ key: 'n8n', i18nLabel: 'n8n' },
					{ key: 'custom', i18nLabel: 'Custom_Engine' },
				],
				invalidValue: 'integrated',
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});

			// URL du moteur externe
			await this.add('Synq_Workflows_External_URL', '', {
				type: 'string',
				public: true,
				i18nLabel: 'Synq_Workflows_External_URL',
				i18nDescription: 'Synq_Workflows_External_URL_Description',
				invalidValue: '',
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});

			// API Key pour le moteur externe
			await this.add('Synq_Workflows_API_Key', '', {
				type: 'password',
				public: false,
				i18nLabel: 'Synq_Workflows_API_Key',
				i18nDescription: 'Synq_Workflows_API_Key_Description',
				invalidValue: '',
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});
		});

		await this.section('Slash_Commands', async function () {
			// Activer les slash commands
			await this.add('Synq_Workflows_Slash_Commands_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workflows_Slash_Commands_Enabled',
				i18nDescription: 'Synq_Workflows_Slash_Commands_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});

			// Commands par défaut
			await this.add('Synq_Workflows_Default_Commands', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workflows_Default_Commands',
				i18nDescription: 'Synq_Workflows_Default_Commands_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workflows_Slash_Commands_Enabled',
					value: true,
				},
			});

			// Commands personnalisées
			await this.add('Synq_Workflows_Custom_Commands', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workflows_Custom_Commands',
				i18nDescription: 'Synq_Workflows_Custom_Commands_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workflows_Slash_Commands_Enabled',
					value: true,
				},
			});

			// Permissions pour créer des commands
			await this.add('Synq_Workflows_Command_Permissions', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workflows_Command_Permissions',
				i18nDescription: 'Synq_Workflows_Command_Permissions_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Workflows_Slash_Commands_Enabled',
					value: true,
				},
			});
		});

		await this.section('Automation_Triggers', async function () {
			// Triggers par message
			await this.add('Synq_Workflows_Message_Triggers', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workflows_Message_Triggers',
				i18nDescription: 'Synq_Workflows_Message_Triggers_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});

			// Triggers par utilisateur
			await this.add('Synq_Workflows_User_Triggers', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workflows_User_Triggers',
				i18nDescription: 'Synq_Workflows_User_Triggers_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});

			// Triggers par canal
			await this.add('Synq_Workflows_Channel_Triggers', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workflows_Channel_Triggers',
				i18nDescription: 'Synq_Workflows_Channel_Triggers_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});

			// Triggers par temps
			await this.add('Synq_Workflows_Time_Triggers', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workflows_Time_Triggers',
				i18nDescription: 'Synq_Workflows_Time_Triggers_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});
		});

		await this.section('Synq_Apps', async function () {
			// Activer les Synq Apps
			await this.add('Synq_Workflows_Synq_Apps_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workflows_Synq_Apps_Enabled',
				i18nDescription: 'Synq_Workflows_Synq_Apps_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});

			// Apps par défaut
			await this.add('Synq_Workflows_Default_Apps', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workflows_Default_Apps',
				i18nDescription: 'Synq_Workflows_Default_Apps_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workflows_Synq_Apps_Enabled',
					value: true,
				},
			});

			// Store d'apps
			await this.add('Synq_Workflows_App_Store_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workflows_App_Store_Enabled',
				i18nDescription: 'Synq_Workflows_App_Store_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Workflows_Synq_Apps_Enabled',
					value: true,
				},
			});

			// Permissions pour installer des apps
			await this.add('Synq_Workflows_App_Install_Permissions', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workflows_App_Install_Permissions',
				i18nDescription: 'Synq_Workflows_App_Install_Permissions_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Workflows_Synq_Apps_Enabled',
					value: true,
				},
			});
		});

		await this.section('Integration_Actions', async function () {
			// Actions par défaut
			await this.add('Synq_Workflows_Default_Actions', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workflows_Default_Actions',
				i18nDescription: 'Synq_Workflows_Default_Actions_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});

			// Actions personnalisées
			await this.add('Synq_Workflows_Custom_Actions', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Workflows_Custom_Actions',
				i18nDescription: 'Synq_Workflows_Custom_Actions_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});

			// Webhooks sortants
			await this.add('Synq_Workflows_Outgoing_Webhooks', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workflows_Outgoing_Webhooks',
				i18nDescription: 'Synq_Workflows_Outgoing_Webhooks_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});

			// Webhooks entrants
			await this.add('Synq_Workflows_Incoming_Webhooks', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Workflows_Incoming_Webhooks',
				i18nDescription: 'Synq_Workflows_Incoming_Webhooks_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Workflows_Enabled',
					value: true,
				},
			});
		});
	});
