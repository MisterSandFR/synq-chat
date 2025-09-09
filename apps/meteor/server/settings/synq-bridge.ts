import { settingsRegistry } from '../../app/settings/server';

export const createSynqBridgeSettings = async (): Promise<void> => {
	await settingsRegistry.addGroup('Synq_Bridge', async function () {
		await this.add('Synq_Bridge_Enabled', true, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'General',
			public: true,
			i18nLabel: 'Synq_Bridge_Enabled',
			i18nDescription: 'Synq_Bridge_Enabled_Description',
		});

		await this.add('Synq_Bridge_Matrix_Enabled', false, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'Matrix',
			public: true,
			i18nLabel: 'Synq_Bridge_Matrix_Enabled',
			i18nDescription: 'Synq_Bridge_Matrix_Enabled_Description',
		});

		await this.add('Synq_Bridge_Matrix_Server_URL', '', {
			type: 'string',
			group: 'Synq_Bridge',
			section: 'Matrix',
			public: true,
			i18nLabel: 'Synq_Bridge_Matrix_Server_URL',
			i18nDescription: 'Synq_Bridge_Matrix_Server_URL_Description',
		});

		await this.add('Synq_Bridge_Matrix_Access_Token', '', {
			type: 'string',
			group: 'Synq_Bridge',
			section: 'Matrix',
			public: false,
			i18nLabel: 'Synq_Bridge_Matrix_Access_Token',
			i18nDescription: 'Synq_Bridge_Matrix_Access_Token_Description',
		});

		await this.add('Synq_Bridge_Matrix_Room_Mapping', '{}', {
			type: 'code',
			group: 'Synq_Bridge',
			section: 'Matrix',
			public: false,
			i18nLabel: 'Synq_Bridge_Matrix_Room_Mapping',
			i18nDescription: 'Synq_Bridge_Matrix_Room_Mapping_Description',
		});

		await this.add('Synq_Bridge_Matrix_User_Mapping', '{}', {
			type: 'code',
			group: 'Synq_Bridge',
			section: 'Matrix',
			public: false,
			i18nLabel: 'Synq_Bridge_Matrix_User_Mapping',
			i18nDescription: 'Synq_Bridge_Matrix_User_Mapping_Description',
		});

		await this.add('Synq_Bridge_Matrix_Sync_Messages', true, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'Matrix',
			public: true,
			i18nLabel: 'Synq_Bridge_Matrix_Sync_Messages',
			i18nDescription: 'Synq_Bridge_Matrix_Sync_Messages_Description',
		});

		await this.add('Synq_Bridge_Matrix_Sync_Users', true, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'Matrix',
			public: true,
			i18nLabel: 'Synq_Bridge_Matrix_Sync_Users',
			i18nDescription: 'Synq_Bridge_Matrix_Sync_Users_Description',
		});

		await this.add('Synq_Bridge_Matrix_Sync_Files', true, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'Matrix',
			public: true,
			i18nLabel: 'Synq_Bridge_Matrix_Sync_Files',
			i18nDescription: 'Synq_Bridge_Matrix_Sync_Files_Description',
		});

		await this.add('Synq_Bridge_Discord_Enabled', false, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'Discord',
			public: true,
			i18nLabel: 'Synq_Bridge_Discord_Enabled',
			i18nDescription: 'Synq_Bridge_Discord_Enabled_Description',
		});

		await this.add('Synq_Bridge_Discord_Bot_Token', '', {
			type: 'string',
			group: 'Synq_Bridge',
			section: 'Discord',
			public: false,
			i18nLabel: 'Synq_Bridge_Discord_Bot_Token',
			i18nDescription: 'Synq_Bridge_Discord_Bot_Token_Description',
		});

		await this.add('Synq_Bridge_Discord_Guild_ID', '', {
			type: 'string',
			group: 'Synq_Bridge',
			section: 'Discord',
			public: true,
			i18nLabel: 'Synq_Bridge_Discord_Guild_ID',
			i18nDescription: 'Synq_Bridge_Discord_Guild_ID_Description',
		});

		await this.add('Synq_Bridge_Discord_Channel_Mapping', '{}', {
			type: 'code',
			group: 'Synq_Bridge',
			section: 'Discord',
			public: false,
			i18nLabel: 'Synq_Bridge_Discord_Channel_Mapping',
			i18nDescription: 'Synq_Bridge_Discord_Channel_Mapping_Description',
		});

		await this.add('Synq_Bridge_Discord_Role_Mapping', '{}', {
			type: 'code',
			group: 'Synq_Bridge',
			section: 'Discord',
			public: false,
			i18nLabel: 'Synq_Bridge_Discord_Role_Mapping',
			i18nDescription: 'Synq_Bridge_Discord_Role_Mapping_Description',
		});

		await this.add('Synq_Bridge_Discord_Sync_Messages', true, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'Discord',
			public: true,
			i18nLabel: 'Synq_Bridge_Discord_Sync_Messages',
			i18nDescription: 'Synq_Bridge_Discord_Sync_Messages_Description',
		});

		await this.add('Synq_Bridge_Discord_Sync_Users', true, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'Discord',
			public: true,
			i18nLabel: 'Synq_Bridge_Discord_Sync_Users',
			i18nDescription: 'Synq_Bridge_Discord_Sync_Users_Description',
		});

		await this.add('Synq_Bridge_Discord_Sync_Files', true, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'Discord',
			public: true,
			i18nLabel: 'Synq_Bridge_Discord_Sync_Files',
			i18nDescription: 'Synq_Bridge_Discord_Sync_Files_Description',
		});

		await this.add('Synq_Bridge_Slack_Enabled', false, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'Slack',
			public: true,
			i18nLabel: 'Synq_Bridge_Slack_Enabled',
			i18nDescription: 'Synq_Bridge_Slack_Enabled_Description',
		});

		await this.add('Synq_Bridge_Slack_Bot_Token', '', {
			type: 'string',
			group: 'Synq_Bridge',
			section: 'Slack',
			public: false,
			i18nLabel: 'Synq_Bridge_Slack_Bot_Token',
			i18nDescription: 'Synq_Bridge_Slack_Bot_Token_Description',
		});

		await this.add('Synq_Bridge_Slack_App_Token', '', {
			type: 'string',
			group: 'Synq_Bridge',
			section: 'Slack',
			public: false,
			i18nLabel: 'Synq_Bridge_Slack_App_Token',
			i18nDescription: 'Synq_Bridge_Slack_App_Token_Description',
		});

		await this.add('Synq_Bridge_Slack_Team_ID', '', {
			type: 'string',
			group: 'Synq_Bridge',
			section: 'Slack',
			public: true,
			i18nLabel: 'Synq_Bridge_Slack_Team_ID',
			i18nDescription: 'Synq_Bridge_Slack_Team_ID_Description',
		});

		await this.add('Synq_Bridge_Slack_Channel_Mapping', '{}', {
			type: 'code',
			group: 'Synq_Bridge',
			section: 'Slack',
			public: false,
			i18nLabel: 'Synq_Bridge_Slack_Channel_Mapping',
			i18nDescription: 'Synq_Bridge_Slack_Channel_Mapping_Description',
		});

		await this.add('Synq_Bridge_Slack_User_Mapping', '{}', {
			type: 'code',
			group: 'Synq_Bridge',
			section: 'Slack',
			public: false,
			i18nLabel: 'Synq_Bridge_Slack_User_Mapping',
			i18nDescription: 'Synq_Bridge_Slack_User_Mapping_Description',
		});

		await this.add('Synq_Bridge_Slack_Sync_Messages', true, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'Slack',
			public: true,
			i18nLabel: 'Synq_Bridge_Slack_Sync_Messages',
			i18nDescription: 'Synq_Bridge_Slack_Sync_Messages_Description',
		});

		await this.add('Synq_Bridge_Slack_Sync_Users', true, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'Slack',
			public: true,
			i18nLabel: 'Synq_Bridge_Slack_Sync_Users',
			i18nDescription: 'Synq_Bridge_Slack_Sync_Users_Description',
		});

		await this.add('Synq_Bridge_Slack_Sync_Files', true, {
			type: 'boolean',
			group: 'Synq_Bridge',
			section: 'Slack',
			public: true,
			i18nLabel: 'Synq_Bridge_Slack_Sync_Files',
			i18nDescription: 'Synq_Bridge_Slack_Sync_Files_Description',
		});

		await this.add('Synq_Bridge_Sync_Interval', 60000, {
			type: 'int',
			group: 'Synq_Bridge',
			section: 'General',
			public: true,
			i18nLabel: 'Synq_Bridge_Sync_Interval',
			i18nDescription: 'Synq_Bridge_Sync_Interval_Description',
		});

		await this.add('Synq_Bridge_Retry_Attempts', 3, {
			type: 'int',
			group: 'Synq_Bridge',
			section: 'General',
			public: true,
			i18nLabel: 'Synq_Bridge_Retry_Attempts',
			i18nDescription: 'Synq_Bridge_Retry_Attempts_Description',
		});

		await this.add('Synq_Bridge_Log_Level', 'info', {
			type: 'select',
			values: [
				{ key: 'debug', i18nLabel: 'Debug' },
				{ key: 'info', i18nLabel: 'Info' },
				{ key: 'warn', i18nLabel: 'Warning' },
				{ key: 'error', i18nLabel: 'Error' },
			],
			group: 'Synq_Bridge',
			section: 'General',
			public: true,
			i18nLabel: 'Synq_Bridge_Log_Level',
			i18nDescription: 'Synq_Bridge_Log_Level_Description',
		});

		await this.add('Synq_Bridge_Configuration_Help_Text', 'Pour configurer les connecteurs Synq, suivez ces étapes :', {
			type: 'string',
			group: 'Synq_Bridge',
			section: 'General',
			public: true,
			i18nLabel: 'Synq_Bridge_Configuration_Help_Text',
			i18nDescription: 'Synq_Bridge_Configuration_Help_Text_Description',
		});

		await this.add('Synq_Bridge_Configuration_Step_1', 'Activez le connecteur souhaité', {
			type: 'string',
			group: 'Synq_Bridge',
			section: 'General',
			public: true,
			i18nLabel: 'Synq_Bridge_Configuration_Step_1',
			i18nDescription: 'Synq_Bridge_Configuration_Step_1_Description',
		});

		await this.add('Synq_Bridge_Configuration_Step_2', 'Configurez les tokens et identifiants', {
			type: 'string',
			group: 'Synq_Bridge',
			section: 'General',
			public: true,
			i18nLabel: 'Synq_Bridge_Configuration_Step_2',
			i18nDescription: 'Synq_Bridge_Configuration_Step_2_Description',
		});

		await this.add('Synq_Bridge_Configuration_Step_3', 'Définissez les mappings de canaux et utilisateurs', {
			type: 'string',
			group: 'Synq_Bridge',
			section: 'General',
			public: true,
			i18nLabel: 'Synq_Bridge_Configuration_Step_3',
			i18nDescription: 'Synq_Bridge_Configuration_Step_3_Description',
		});

		await this.add('Synq_Bridge_Configuration_Step_4', 'Testez la synchronisation', {
			type: 'string',
			group: 'Synq_Bridge',
			section: 'General',
			public: true,
			i18nLabel: 'Synq_Bridge_Configuration_Step_4',
			i18nDescription: 'Synq_Bridge_Configuration_Step_4_Description',
		});
	});
};
