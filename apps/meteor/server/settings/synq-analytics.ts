import { settingsRegistry } from '../../app/settings/server';

export const createSynqAnalyticsSettings = () =>
	settingsRegistry.addGroup('Synq_Analytics', async function () {
		await this.section('Analytics_Configuration', async function () {
			// Activer les analytics intégrés
			await this.add('Synq_Analytics_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Enabled',
				i18nDescription: 'Synq_Analytics_Enabled_Description',
				invalidValue: true,
			});

			// Collecte de données
			await this.add('Synq_Analytics_Data_Collection', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Data_Collection',
				i18nDescription: 'Synq_Analytics_Data_Collection_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Intervalle de collecte (en minutes)
			await this.add('Synq_Analytics_Collection_Interval', 5, {
				type: 'int',
				public: true,
				i18nLabel: 'Synq_Analytics_Collection_Interval',
				i18nDescription: 'Synq_Analytics_Collection_Interval_Description',
				invalidValue: 5,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Rétention des données (en jours)
			await this.add('Synq_Analytics_Data_Retention', 90, {
				type: 'int',
				public: true,
				i18nLabel: 'Synq_Analytics_Data_Retention',
				i18nDescription: 'Synq_Analytics_Data_Retention_Description',
				invalidValue: 90,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});
		});

		await this.section('Activity_Metrics', async function () {
			// Messages par jour
			await this.add('Synq_Analytics_Messages_Per_Day', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Messages_Per_Day',
				i18nDescription: 'Synq_Analytics_Messages_Per_Day_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Utilisateurs actifs
			await this.add('Synq_Analytics_Active_Users', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Active_Users',
				i18nDescription: 'Synq_Analytics_Active_Users_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Top canaux
			await this.add('Synq_Analytics_Top_Channels', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Top_Channels',
				i18nDescription: 'Synq_Analytics_Top_Channels_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Temps de réponse moyen
			await this.add('Synq_Analytics_Response_Time', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Response_Time',
				i18nDescription: 'Synq_Analytics_Response_Time_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});
		});

		await this.section('User_Behavior', async function () {
			// Heures de pointe
			await this.add('Synq_Analytics_Peak_Hours', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Peak_Hours',
				i18nDescription: 'Synq_Analytics_Peak_Hours_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Jours de la semaine les plus actifs
			await this.add('Synq_Analytics_Peak_Days', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Peak_Days',
				i18nDescription: 'Synq_Analytics_Peak_Days_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Utilisateurs les plus actifs
			await this.add('Synq_Analytics_Top_Users', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Top_Users',
				i18nDescription: 'Synq_Analytics_Top_Users_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Types de messages
			await this.add('Synq_Analytics_Message_Types', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Message_Types',
				i18nDescription: 'Synq_Analytics_Message_Types_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});
		});

		await this.section('Dashboard_Configuration', async function () {
			// Dashboard admin
			await this.add('Synq_Analytics_Admin_Dashboard', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Admin_Dashboard',
				i18nDescription: 'Synq_Analytics_Admin_Dashboard_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Dashboard utilisateur
			await this.add('Synq_Analytics_User_Dashboard', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_User_Dashboard',
				i18nDescription: 'Synq_Analytics_User_Dashboard_Description',
				invalidValue: false,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Rapports automatiques
			await this.add('Synq_Analytics_Auto_Reports', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Auto_Reports',
				i18nDescription: 'Synq_Analytics_Auto_Reports_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Fréquence des rapports (en jours)
			await this.add('Synq_Analytics_Report_Frequency', 7, {
				type: 'int',
				public: true,
				i18nLabel: 'Synq_Analytics_Report_Frequency',
				i18nDescription: 'Synq_Analytics_Report_Frequency_Description',
				invalidValue: 7,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});
		});

		await this.section('Export_And_Integration', async function () {
			// Export des données
			await this.add('Synq_Analytics_Export_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_Export_Enabled',
				i18nDescription: 'Synq_Analytics_Export_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Formats d'export
			await this.add('Synq_Analytics_Export_Formats', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Analytics_Export_Formats',
				i18nDescription: 'Synq_Analytics_Export_Formats_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// Intégration avec des outils externes
			await this.add('Synq_Analytics_External_Integration', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_External_Integration',
				i18nDescription: 'Synq_Analytics_External_Integration_Description',
				invalidValue: false,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});

			// API pour les analytics
			await this.add('Synq_Analytics_API_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Analytics_API_Enabled',
				i18nDescription: 'Synq_Analytics_API_Enabled_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Analytics_Enabled',
					value: true,
				},
			});
		});
	});
