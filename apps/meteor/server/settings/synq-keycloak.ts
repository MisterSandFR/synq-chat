import { settingsRegistry } from '../../app/settings/server';

export const createSynqKeycloakSettings = () =>
	settingsRegistry.addGroup('Synq_Keycloak', async function () {
		await this.section('Keycloak_Configuration', async function () {
			// Activer Keycloak
			await this.add('Synq_Keycloak_Enabled', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Keycloak_Enabled',
				i18nDescription: 'Synq_Keycloak_Enabled_Description',
				invalidValue: false,
			});

			// URL du serveur Keycloak
			await this.add('Synq_Keycloak_Server_URL', '', {
				type: 'string',
				public: true,
				i18nLabel: 'Synq_Keycloak_Server_URL',
				i18nDescription: 'Synq_Keycloak_Server_URL_Description',
				invalidValue: '',
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});

			// Realm Keycloak
			await this.add('Synq_Keycloak_Realm', 'master', {
				type: 'string',
				public: true,
				i18nLabel: 'Synq_Keycloak_Realm',
				i18nDescription: 'Synq_Keycloak_Realm_Description',
				invalidValue: 'master',
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});

			// Client ID
			await this.add('Synq_Keycloak_Client_ID', '', {
				type: 'string',
				public: true,
				i18nLabel: 'Synq_Keycloak_Client_ID',
				i18nDescription: 'Synq_Keycloak_Client_ID_Description',
				invalidValue: '',
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});

			// Client Secret
			await this.add('Synq_Keycloak_Client_Secret', '', {
				type: 'password',
				public: false,
				i18nLabel: 'Synq_Keycloak_Client_Secret',
				i18nDescription: 'Synq_Keycloak_Client_Secret_Description',
				invalidValue: '',
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});

			// Redirect URI
			await this.add('Synq_Keycloak_Redirect_URI', '', {
				type: 'string',
				public: true,
				i18nLabel: 'Synq_Keycloak_Redirect_URI',
				i18nDescription: 'Synq_Keycloak_Redirect_URI_Description',
				invalidValue: '',
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});
		});

		await this.section('User_Provisioning', async function () {
			// Provision automatique des utilisateurs
			await this.add('Synq_Keycloak_Auto_Provision', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Keycloak_Auto_Provision',
				i18nDescription: 'Synq_Keycloak_Auto_Provision_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});

			// Mise à jour automatique des utilisateurs
			await this.add('Synq_Keycloak_Auto_Update', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Keycloak_Auto_Update',
				i18nDescription: 'Synq_Keycloak_Auto_Update_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});

			// Synchronisation des groupes
			await this.add('Synq_Keycloak_Sync_Groups', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Keycloak_Sync_Groups',
				i18nDescription: 'Synq_Keycloak_Sync_Groups_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});

			// Synchronisation des rôles
			await this.add('Synq_Keycloak_Sync_Roles', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Keycloak_Sync_Roles',
				i18nDescription: 'Synq_Keycloak_Sync_Roles_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});
		});

		await this.section('Role_Mapping', async function () {
			// Mapping des rôles Keycloak vers les rôles Synq
			await this.add('Synq_Keycloak_Role_Mapping', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Keycloak_Role_Mapping',
				i18nDescription: 'Synq_Keycloak_Role_Mapping_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});

			// Mapping des groupes Keycloak vers les rôles Synq
			await this.add('Synq_Keycloak_Group_Mapping', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Keycloak_Group_Mapping',
				i18nDescription: 'Synq_Keycloak_Group_Mapping_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});

			// Rôle par défaut pour les nouveaux utilisateurs
			await this.add('Synq_Keycloak_Default_Role', 'user', {
				type: 'select',
				values: [
					{ key: 'user', i18nLabel: 'User' },
					{ key: 'moderator', i18nLabel: 'Moderator' },
					{ key: 'admin', i18nLabel: 'Admin' },
				],
				public: true,
				i18nLabel: 'Synq_Keycloak_Default_Role',
				i18nDescription: 'Synq_Keycloak_Default_Role_Description',
				invalidValue: 'user',
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});
		});

		await this.section('Advanced_Configuration', async function () {
			// Intervalle de synchronisation (en minutes)
			await this.add('Synq_Keycloak_Sync_Interval', 60, {
				type: 'int',
				public: true,
				i18nLabel: 'Synq_Keycloak_Sync_Interval',
				i18nDescription: 'Synq_Keycloak_Sync_Interval_Description',
				invalidValue: 60,
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});

			// Activer la synchronisation en temps réel
			await this.add('Synq_Keycloak_Real_Time_Sync', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Keycloak_Real_Time_Sync',
				i18nDescription: 'Synq_Keycloak_Real_Time_Sync_Description',
				invalidValue: false,
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});

			// Activer les logs de débogage
			await this.add('Synq_Keycloak_Debug_Logs', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Keycloak_Debug_Logs',
				i18nDescription: 'Synq_Keycloak_Debug_Logs_Description',
				invalidValue: false,
				enableQuery: {
					_id: 'Synq_Keycloak_Enabled',
					value: true,
				},
			});
		});
	});


