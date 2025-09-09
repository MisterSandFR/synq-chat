import { settingsRegistry } from '../../app/settings/server';

export const createSynqJitsiSettings = () =>
	settingsRegistry.addGroup('Synq_Jitsi', async function () {
		await this.section('Enhanced_Jitsi', async function () {
			// Activer l'intégration Jitsi améliorée
			await this.add('Synq_Jitsi_Enhanced_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Enhanced_Enabled',
				i18nDescription: 'Synq_Jitsi_Enhanced_Enabled_Description',
				invalidValue: true,
			});

			// URL du serveur Jitsi
			await this.add('Synq_Jitsi_Server_URL', 'https://meet.jit.si', {
				type: 'string',
				public: true,
				i18nLabel: 'Synq_Jitsi_Server_URL',
				i18nDescription: 'Synq_Jitsi_Server_URL_Description',
				invalidValue: 'https://meet.jit.si',
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Salles persistantes
			await this.add('Synq_Jitsi_Persistent_Rooms', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Persistent_Rooms',
				i18nDescription: 'Synq_Jitsi_Persistent_Rooms_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Salles vocales persistantes (Discord-like)
			await this.add('Synq_Jitsi_Voice_Rooms', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Voice_Rooms',
				i18nDescription: 'Synq_Jitsi_Voice_Rooms_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Auto-rejoindre les salles vocales
			await this.add('Synq_Jitsi_Auto_Join_Voice', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Auto_Join_Voice',
				i18nDescription: 'Synq_Jitsi_Auto_Join_Voice_Description',
				invalidValue: false,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});
		});

		await this.section('Room_Configuration', async function () {
			// Configuration des salles par défaut
			await this.add('Synq_Jitsi_Default_Room_Config', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Jitsi_Default_Room_Config',
				i18nDescription: 'Synq_Jitsi_Default_Room_Config_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Salles vocales par défaut
			await this.add('Synq_Jitsi_Default_Voice_Rooms', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Jitsi_Default_Voice_Rooms',
				i18nDescription: 'Synq_Jitsi_Default_Voice_Rooms_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Limite d'utilisateurs par salle
			await this.add('Synq_Jitsi_Room_User_Limit', 50, {
				type: 'int',
				public: true,
				i18nLabel: 'Synq_Jitsi_Room_User_Limit',
				i18nDescription: 'Synq_Jitsi_Room_User_Limit_Description',
				invalidValue: 50,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Durée de vie des salles (en minutes)
			await this.add('Synq_Jitsi_Room_Lifetime', 60, {
				type: 'int',
				public: true,
				i18nLabel: 'Synq_Jitsi_Room_Lifetime',
				i18nDescription: 'Synq_Jitsi_Room_Lifetime_Description',
				invalidValue: 60,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});
		});

		await this.section('Advanced_Features', async function () {
			// Enregistrement des appels
			await this.add('Synq_Jitsi_Recording_Enabled', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Recording_Enabled',
				i18nDescription: 'Synq_Jitsi_Recording_Enabled_Description',
				invalidValue: false,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Partage d'écran amélioré
			await this.add('Synq_Jitsi_Enhanced_Screen_Share', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Enhanced_Screen_Share',
				i18nDescription: 'Synq_Jitsi_Enhanced_Screen_Share_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Chat intégré dans Jitsi
			await this.add('Synq_Jitsi_Integrated_Chat', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Integrated_Chat',
				i18nDescription: 'Synq_Jitsi_Integrated_Chat_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Notifications de présence
			await this.add('Synq_Jitsi_Presence_Notifications', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Presence_Notifications',
				i18nDescription: 'Synq_Jitsi_Presence_Notifications_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Intégration avec les canaux
			await this.add('Synq_Jitsi_Channel_Integration', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Channel_Integration',
				i18nDescription: 'Synq_Jitsi_Channel_Integration_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});
		});

		await this.section('Security_And_Privacy', async function () {
			// Authentification requise
			await this.add('Synq_Jitsi_Require_Auth', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Require_Auth',
				i18nDescription: 'Synq_Jitsi_Require_Auth_Description',
				invalidValue: false,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Chiffrement des appels
			await this.add('Synq_Jitsi_Encryption_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Encryption_Enabled',
				i18nDescription: 'Synq_Jitsi_Encryption_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Modération des salles
			await this.add('Synq_Jitsi_Room_Moderation', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Room_Moderation',
				i18nDescription: 'Synq_Jitsi_Room_Moderation_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});

			// Logs des appels
			await this.add('Synq_Jitsi_Call_Logs', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Jitsi_Call_Logs',
				i18nDescription: 'Synq_Jitsi_Call_Logs_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Jitsi_Enhanced_Enabled',
					value: true,
				},
			});
		});
	});
