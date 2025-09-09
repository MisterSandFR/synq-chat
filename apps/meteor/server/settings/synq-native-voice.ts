import { settingsRegistry } from '../../app/settings/server';

export const createSynqNativeVoiceSettings = () =>
	settingsRegistry.addGroup('Synq_Native_Voice', async function () {
		await this.section('Core_Settings', async function () {
			// Activer le service vocal natif
			await this.add('Synq_Native_Voice_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Native_Voice_Enabled',
				i18nDescription: 'Synq_Native_Voice_Enabled_Description',
				invalidValue: true,
			});

			// Salles persistantes
			await this.add('Synq_Voice_Persistent_Rooms', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Persistent_Rooms',
				i18nDescription: 'Synq_Voice_Persistent_Rooms_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Auto-rejoindre les salles vocales
			await this.add('Synq_Voice_Auto_Join', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Auto_Join',
				i18nDescription: 'Synq_Voice_Auto_Join_Description',
				invalidValue: false,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Intégration avec les canaux
			await this.add('Synq_Voice_Channel_Integration', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Channel_Integration',
				i18nDescription: 'Synq_Voice_Channel_Integration_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});
		});

		await this.section('Room_Configuration', async function () {
			// Limite d'utilisateurs par salle
			await this.add('Synq_Voice_Max_Participants', 50, {
				type: 'int',
				public: true,
				i18nLabel: 'Synq_Voice_Max_Participants',
				i18nDescription: 'Synq_Voice_Max_Participants_Description',
				invalidValue: 50,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Durée de vie des salles (en minutes)
			await this.add('Synq_Voice_Room_Lifetime', 60, {
				type: 'int',
				public: true,
				i18nLabel: 'Synq_Voice_Room_Lifetime',
				i18nDescription: 'Synq_Voice_Room_Lifetime_Description',
				invalidValue: 60,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Salles vocales par défaut
			await this.add('Synq_Voice_Default_Rooms', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Voice_Default_Rooms',
				i18nDescription: 'Synq_Voice_Default_Rooms_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Configuration WebRTC par défaut
			await this.add('Synq_Voice_WebRTC_Config', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Voice_WebRTC_Config',
				i18nDescription: 'Synq_Voice_WebRTC_Config_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});
		});

		await this.section('Advanced_Features', async function () {
			// Partage d'écran natif
			await this.add('Synq_Voice_Screen_Share_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Screen_Share_Enabled',
				i18nDescription: 'Synq_Voice_Screen_Share_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Chat intégré dans les salles vocales
			await this.add('Synq_Voice_Chat_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Chat_Enabled',
				i18nDescription: 'Synq_Voice_Chat_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Enregistrement des appels
			await this.add('Synq_Voice_Recording_Enabled', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Recording_Enabled',
				i18nDescription: 'Synq_Voice_Recording_Enabled_Description',
				invalidValue: false,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Notifications de présence
			await this.add('Synq_Voice_Presence_Notifications', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Presence_Notifications',
				i18nDescription: 'Synq_Voice_Presence_Notifications_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Détection de la parole
			await this.add('Synq_Voice_Speech_Detection', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Speech_Detection',
				i18nDescription: 'Synq_Voice_Speech_Detection_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Réduction du bruit
			await this.add('Synq_Voice_Noise_Reduction', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Noise_Reduction',
				i18nDescription: 'Synq_Voice_Noise_Reduction_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Écho cancellation
			await this.add('Synq_Voice_Echo_Cancellation', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Echo_Cancellation',
				i18nDescription: 'Synq_Voice_Echo_Cancellation_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});
		});

		await this.section('Security_And_Privacy', async function () {
			// Chiffrement des appels
			await this.add('Synq_Voice_Encryption_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Encryption_Enabled',
				i18nDescription: 'Synq_Voice_Encryption_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Modération des salles
			await this.add('Synq_Voice_Moderation_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Moderation_Enabled',
				i18nDescription: 'Synq_Voice_Moderation_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Logs des appels
			await this.add('Synq_Voice_Call_Logs', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Call_Logs',
				i18nDescription: 'Synq_Voice_Call_Logs_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Authentification requise
			await this.add('Synq_Voice_Require_Auth', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Require_Auth',
				i18nDescription: 'Synq_Voice_Require_Auth_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Permissions par rôle
			await this.add('Synq_Voice_Role_Permissions', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Voice_Role_Permissions',
				i18nDescription: 'Synq_Voice_Role_Permissions_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});
		});

		await this.section('Performance_And_Quality', async function () {
			// Qualité audio par défaut
			await this.add('Synq_Voice_Audio_Quality', 'high', {
				type: 'select',
				values: [
					{ key: 'low', i18nLabel: 'Low' },
					{ key: 'medium', i18nLabel: 'Medium' },
					{ key: 'high', i18nLabel: 'High' },
					{ key: 'ultra', i18nLabel: 'Ultra' },
				],
				public: true,
				i18nLabel: 'Synq_Voice_Audio_Quality',
				i18nDescription: 'Synq_Voice_Audio_Quality_Description',
				invalidValue: 'high',
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Qualité vidéo par défaut
			await this.add('Synq_Voice_Video_Quality', 'high', {
				type: 'select',
				values: [
					{ key: 'low', i18nLabel: 'Low' },
					{ key: 'medium', i18nLabel: 'Medium' },
					{ key: 'high', i18nLabel: 'High' },
					{ key: 'ultra', i18nLabel: 'Ultra' },
				],
				public: true,
				i18nLabel: 'Synq_Voice_Video_Quality',
				i18nDescription: 'Synq_Voice_Video_Quality_Description',
				invalidValue: 'high',
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Limite de bande passante
			await this.add('Synq_Voice_Bandwidth_Limit', 0, {
				type: 'int',
				public: true,
				i18nLabel: 'Synq_Voice_Bandwidth_Limit',
				i18nDescription: 'Synq_Voice_Bandwidth_Limit_Description',
				invalidValue: 0,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Adaptation automatique de la qualité
			await this.add('Synq_Voice_Auto_Quality_Adaptation', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Auto_Quality_Adaptation',
				i18nDescription: 'Synq_Voice_Auto_Quality_Adaptation_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Compression audio
			await this.add('Synq_Voice_Audio_Compression', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Audio_Compression',
				i18nDescription: 'Synq_Voice_Audio_Compression_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});

			// Compression vidéo
			await this.add('Synq_Voice_Video_Compression', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Voice_Video_Compression',
				i18nDescription: 'Synq_Voice_Video_Compression_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Native_Voice_Enabled',
					value: true,
				},
			});
		});
	});
