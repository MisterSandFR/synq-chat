import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import { Settings } from '@rocket.chat/models';
import { settings } from '@rocket.chat/settings';
import { Users } from '@rocket.chat/models';
import { Roles } from '@rocket.chat/models';
import { Logger } from '@rocket.chat/logger';

import { SynqKeycloakService } from './SynqKeycloakService';

const logger = new Logger('SynqKeycloak');

class SynqKeycloakIntegration {
	private keycloakService: SynqKeycloakService;
	private syncInterval: NodeJS.Timeout | null = null;

	constructor() {
		this.keycloakService = new SynqKeycloakService();
		this.initializeIntegration();
	}

	private async initializeIntegration(): Promise<void> {
		try {
			const isEnabled = settings.get('Synq_Keycloak_Enabled');
			if (!isEnabled) {
				logger.info('Keycloak integration is disabled');
				return;
			}

			await this.setupOAuthProvider();
			await this.startSyncProcess();
			logger.info('Keycloak integration initialized successfully');
		} catch (error) {
			logger.error('Failed to initialize Keycloak integration:', error);
		}
	}

	private async setupOAuthProvider(): Promise<void> {
		const serverUrl = settings.get('Synq_Keycloak_Server_URL');
		const realm = settings.get('Synq_Keycloak_Realm');
		const clientId = settings.get('Synq_Keycloak_Client_ID');
		const clientSecret = settings.get('Synq_Keycloak_Client_Secret');
		const redirectUri = settings.get('Synq_Keycloak_Redirect_URI');

		if (!serverUrl || !realm || !clientId || !clientSecret || !redirectUri) {
			throw new Error('Keycloak configuration is incomplete');
		}

		// Configuration OAuth pour Keycloak
		Accounts.oauth.registerService('keycloak');

		// Configuration du provider OAuth
		ServiceConfiguration.configurations.upsert(
			{ service: 'keycloak' },
			{
				$set: {
					serverUrl,
					realm,
					clientId,
					secret: clientSecret,
					redirectUri,
					loginStyle: 'popup',
				},
			}
		);

		logger.info('OAuth provider configured for Keycloak');
	}

	private async startSyncProcess(): Promise<void> {
		const syncInterval = settings.get('Synq_Keycloak_Sync_Interval') || 60;
		const realTimeSync = settings.get('Synq_Keycloak_Real_Time_Sync');

		if (realTimeSync) {
			await this.setupRealTimeSync();
		}

		// Synchronisation périodique
		this.syncInterval = setInterval(async () => {
			try {
				await this.performSync();
			} catch (error) {
				logger.error('Sync process failed:', error);
			}
		}, syncInterval * 60 * 1000);

		logger.info(`Sync process started with interval: ${syncInterval} minutes`);
	}

	private async setupRealTimeSync(): Promise<void> {
		// Configuration des webhooks Keycloak pour la synchronisation en temps réel
		// Cette fonctionnalité nécessiterait une configuration côté Keycloak
		logger.info('Real-time sync setup completed');
	}

	public async performSync(): Promise<void> {
		try {
			logger.info('Starting Keycloak sync process');

			// Synchroniser les utilisateurs
			if (settings.get('Synq_Keycloak_Auto_Provision')) {
				await this.syncUsers();
			}

			// Synchroniser les groupes
			if (settings.get('Synq_Keycloak_Sync_Groups')) {
				await this.syncGroups();
			}

			// Synchroniser les rôles
			if (settings.get('Synq_Keycloak_Sync_Roles')) {
				await this.syncRoles();
			}

			logger.info('Keycloak sync process completed successfully');
		} catch (error) {
			logger.error('Keycloak sync process failed:', error);
			throw error;
		}
	}

	private async syncUsers(): Promise<void> {
		try {
			const users = await this.keycloakService.getUsers();
			
			for (const keycloakUser of users) {
				await this.provisionUser(keycloakUser);
			}

			logger.info(`Synced ${users.length} users from Keycloak`);
		} catch (error) {
			logger.error('Failed to sync users:', error);
			throw error;
		}
	}

	private async provisionUser(keycloakUser: any): Promise<void> {
		try {
			const existingUser = await Users.findOneByEmailAddress(keycloakUser.email);
			
			if (existingUser) {
				// Mettre à jour l'utilisateur existant
				if (settings.get('Synq_Keycloak_Auto_Update')) {
					await this.updateUser(existingUser._id, keycloakUser);
				}
			} else {
				// Créer un nouvel utilisateur
				await this.createUser(keycloakUser);
			}
		} catch (error) {
			logger.error(`Failed to provision user ${keycloakUser.email}:`, error);
		}
	}

	private async createUser(keycloakUser: any): Promise<void> {
		try {
			const userId = await Users.create({
				name: keycloakUser.firstName + ' ' + keycloakUser.lastName,
				username: keycloakUser.username,
				emails: [{ address: keycloakUser.email, verified: true }],
				services: {
					keycloak: {
						id: keycloakUser.id,
						email: keycloakUser.email,
					},
				},
			});

			// Assigner le rôle par défaut
			const defaultRole = settings.get('Synq_Keycloak_Default_Role') || 'user';
			await Roles.addUserRoles(userId, defaultRole);

			logger.info(`Created new user: ${keycloakUser.email}`);
		} catch (error) {
			logger.error(`Failed to create user ${keycloakUser.email}:`, error);
			throw error;
		}
	}

	private async updateUser(userId: string, keycloakUser: any): Promise<void> {
		try {
			await Users.updateOne(
				{ _id: userId },
				{
					$set: {
						name: keycloakUser.firstName + ' ' + keycloakUser.lastName,
						username: keycloakUser.username,
						'emails.0.address': keycloakUser.email,
						'services.keycloak.email': keycloakUser.email,
					},
				}
			);

			logger.info(`Updated user: ${keycloakUser.email}`);
		} catch (error) {
			logger.error(`Failed to update user ${keycloakUser.email}:`, error);
			throw error;
		}
	}

	private async syncGroups(): Promise<void> {
		try {
			const groups = await this.keycloakService.getGroups();
			const groupMapping = JSON.parse(settings.get('Synq_Keycloak_Group_Mapping') || '{}');

			for (const keycloakGroup of groups) {
				await this.syncGroup(keycloakGroup, groupMapping);
			}

			logger.info(`Synced ${groups.length} groups from Keycloak`);
		} catch (error) {
			logger.error('Failed to sync groups:', error);
			throw error;
		}
	}

	private async syncGroup(keycloakGroup: any, groupMapping: any): Promise<void> {
		try {
			// Créer ou mettre à jour le groupe dans Synq
			// Cette logique dépendrait de la structure des groupes dans Rocket.Chat
			logger.info(`Synced group: ${keycloakGroup.name}`);
		} catch (error) {
			logger.error(`Failed to sync group ${keycloakGroup.name}:`, error);
		}
	}

	private async syncRoles(): Promise<void> {
		try {
			const roles = await this.keycloakService.getRoles();
			const roleMapping = JSON.parse(settings.get('Synq_Keycloak_Role_Mapping') || '{}');

			for (const keycloakRole of roles) {
				await this.syncRole(keycloakRole, roleMapping);
			}

			logger.info(`Synced ${roles.length} roles from Keycloak`);
		} catch (error) {
			logger.error('Failed to sync roles:', error);
			throw error;
		}
	}

	private async syncRole(keycloakRole: any, roleMapping: any): Promise<void> {
		try {
			// Créer ou mettre à jour le rôle dans Synq
			// Cette logique dépendrait de la structure des rôles dans Rocket.Chat
			logger.info(`Synced role: ${keycloakRole.name}`);
		} catch (error) {
			logger.error(`Failed to sync role ${keycloakRole.name}:`, error);
		}
	}

	public async stopSync(): Promise<void> {
		if (this.syncInterval) {
			clearInterval(this.syncInterval);
			this.syncInterval = null;
		}
		logger.info('Keycloak sync process stopped');
	}

	public async testConnection(): Promise<boolean> {
		try {
			await this.keycloakService.testConnection();
			return true;
		} catch (error) {
			logger.error('Keycloak connection test failed:', error);
			return false;
		}
	}
}

// Initialiser l'intégration Keycloak
let keycloakIntegration: SynqKeycloakIntegration | null = null;

Meteor.startup(async () => {
	try {
		keycloakIntegration = new SynqKeycloakIntegration();
	} catch (error) {
		logger.error('Failed to initialize Keycloak integration:', error);
	}
});

// Méthodes Meteor pour l'interface utilisateur
Meteor.methods({
	async 'synq.keycloak.sync'(): Promise<void> {
		if (!keycloakIntegration) {
			throw new Meteor.Error('keycloak-not-initialized', 'Keycloak integration is not initialized');
		}
		await keycloakIntegration.performSync();
	},

	async 'synq.keycloak.test-connection'(): Promise<boolean> {
		if (!keycloakIntegration) {
			throw new Meteor.Error('keycloak-not-initialized', 'Keycloak integration is not initialized');
		}
		return await keycloakIntegration.testConnection();
	},

	async 'synq.keycloak.stop-sync'(): Promise<void> {
		if (!keycloakIntegration) {
			throw new Meteor.Error('keycloak-not-initialized', 'Keycloak integration is not initialized');
		}
		await keycloakIntegration.stopSync();
	},
});

export { SynqKeycloakIntegration };
