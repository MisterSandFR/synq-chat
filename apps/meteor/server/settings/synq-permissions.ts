import { settingsRegistry } from '../../app/settings/server';

export const createSynqPermissionsSettings = () =>
	settingsRegistry.addGroup('Synq_Permissions', async function () {
		await this.section('Granular_Permissions', async function () {
			// Activer les permissions granulaires
			await this.add('Synq_Permissions_Granular_Enabled', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Permissions_Granular_Enabled',
				i18nDescription: 'Synq_Permissions_Granular_Enabled_Description',
				invalidValue: true,
			});

			// Templates de rôles par défaut
			await this.add('Synq_Permissions_Role_Templates', '[]', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Permissions_Role_Templates',
				i18nDescription: 'Synq_Permissions_Role_Templates_Description',
				invalidValue: '[]',
				enableQuery: {
					_id: 'Synq_Permissions_Granular_Enabled',
					value: true,
				},
			});

			// Permettre aux utilisateurs de créer des rôles personnalisés
			await this.add('Synq_Permissions_Allow_Custom_Roles', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Permissions_Allow_Custom_Roles',
				i18nDescription: 'Synq_Permissions_Allow_Custom_Roles_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Permissions_Granular_Enabled',
					value: true,
				},
			});

			// Permissions par défaut pour les nouveaux canaux
			await this.add('Synq_Permissions_Default_Channel_Permissions', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Permissions_Default_Channel_Permissions',
				i18nDescription: 'Synq_Permissions_Default_Channel_Permissions_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Permissions_Granular_Enabled',
					value: true,
				},
			});
		});

		await this.section('Role_Templates', async function () {
			// Template Owner
			await this.add('Synq_Permissions_Template_Owner', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Permissions_Template_Owner',
				i18nDescription: 'Synq_Permissions_Template_Owner_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Permissions_Granular_Enabled',
					value: true,
				},
			});

			// Template Manager
			await this.add('Synq_Permissions_Template_Manager', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Permissions_Template_Manager',
				i18nDescription: 'Synq_Permissions_Template_Manager_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Permissions_Granular_Enabled',
					value: true,
				},
			});

			// Template Moderator
			await this.add('Synq_Permissions_Template_Moderator', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Permissions_Template_Moderator',
				i18nDescription: 'Synq_Permissions_Template_Moderator_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Permissions_Granular_Enabled',
					value: true,
				},
			});

			// Template Member
			await this.add('Synq_Permissions_Template_Member', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Permissions_Template_Member',
				i18nDescription: 'Synq_Permissions_Template_Member_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Permissions_Granular_Enabled',
					value: true,
				},
			});

			// Template Guest
			await this.add('Synq_Permissions_Template_Guest', '{}', {
				type: 'code',
				public: true,
				i18nLabel: 'Synq_Permissions_Template_Guest',
				i18nDescription: 'Synq_Permissions_Template_Guest_Description',
				invalidValue: '{}',
				enableQuery: {
					_id: 'Synq_Permissions_Granular_Enabled',
					value: true,
				},
			});
		});

		await this.section('Advanced_Permissions', async function () {
			// Héritage des permissions
			await this.add('Synq_Permissions_Enable_Inheritance', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Permissions_Enable_Inheritance',
				i18nDescription: 'Synq_Permissions_Enable_Inheritance_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Permissions_Granular_Enabled',
					value: true,
				},
			});

			// Permissions conditionnelles
			await this.add('Synq_Permissions_Enable_Conditional', false, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Permissions_Enable_Conditional',
				i18nDescription: 'Synq_Permissions_Enable_Conditional_Description',
				invalidValue: false,
				enableQuery: {
					_id: 'Synq_Permissions_Granular_Enabled',
					value: true,
				},
			});

			// Audit des permissions
			await this.add('Synq_Permissions_Enable_Audit', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Permissions_Enable_Audit',
				i18nDescription: 'Synq_Permissions_Enable_Audit_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Permissions_Granular_Enabled',
					value: true,
				},
			});

			// Notifications de changement de permissions
			await this.add('Synq_Permissions_Enable_Notifications', true, {
				type: 'boolean',
				public: true,
				i18nLabel: 'Synq_Permissions_Enable_Notifications',
				i18nDescription: 'Synq_Permissions_Enable_Notifications_Description',
				invalidValue: true,
				enableQuery: {
					_id: 'Synq_Permissions_Granular_Enabled',
					value: true,
				},
			});
		});
	});


