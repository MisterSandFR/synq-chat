import { Meteor } from 'meteor/meteor';
import { Settings } from '@rocket.chat/models';
import { Logger } from '@rocket.chat/logger';
import { Users } from '@rocket.chat/models';
import { Roles } from '@rocket.chat/models';

const logger = new Logger('SynqKeycloak');

interface KeycloakUserInfo {
	sub: string;
	preferred_username: string;
	email: string;
	given_name?: string;
	family_name?: string;
	name?: string;
	groups?: string[];
	realm_access?: {
		roles?: string[];
	};
}

interface KeycloakConfig {
	serverUrl: string;
	realm: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}

export class SynqKeycloakService {
	private config: KeycloakConfig | null = null;

	constructor() {
		this.loadConfig();
	}

	private loadConfig(): void {
		const enabled = Settings.get('Synq_Keycloak_Enabled');
		if (!enabled) {
			this.config = null;
			return;
		}

		this.config = {
			serverUrl: Settings.get('Synq_Keycloak_Server_URL'),
			realm: Settings.get('Synq_Keycloak_Realm'),
			clientId: Settings.get('Synq_Keycloak_Client_ID'),
			clientSecret: Settings.get('Synq_Keycloak_Client_Secret'),
			redirectUri: Settings.get('Synq_Keycloak_Redirect_URI'),
		};

		// Vérifier que tous les paramètres requis sont présents
		if (!this.config.serverUrl || !this.config.realm || !this.config.clientId || !this.config.clientSecret) {
			logger.error('Configuration Keycloak incomplète');
			this.config = null;
		}
	}

	public isEnabled(): boolean {
		return this.config !== null;
	}

	public getAuthUrl(state?: string): string {
		if (!this.config) {
			throw new Error('Keycloak non configuré');
		}

		const params = new URLSearchParams({
			client_id: this.config.clientId,
			redirect_uri: this.config.redirectUri,
			response_type: 'code',
			scope: 'openid profile email',
			...(state && { state }),
		});

		return `${this.config.serverUrl}/realms/${this.config.realm}/protocol/openid-connect/auth?${params.toString()}`;
	}

	public async exchangeCodeForToken(code: string): Promise<string> {
		if (!this.config) {
			throw new Error('Keycloak non configuré');
		}

		const tokenUrl = `${this.config.serverUrl}/realms/${this.config.realm}/protocol/openid-connect/token`;
		
		const response = await fetch(tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: this.config.clientId,
				client_secret: this.config.clientSecret,
				code,
				redirect_uri: this.config.redirectUri,
			}),
		});

		if (!response.ok) {
			throw new Error(`Erreur lors de l'échange du code: ${response.statusText}`);
		}

		const tokenData = await response.json();
		return tokenData.access_token;
	}

	public async getUserInfo(accessToken: string): Promise<KeycloakUserInfo> {
		if (!this.config) {
			throw new Error('Keycloak non configuré');
		}

		const userInfoUrl = `${this.config.serverUrl}/realms/${this.config.realm}/protocol/openid-connect/userinfo`;
		
		const response = await fetch(userInfoUrl, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});

		if (!response.ok) {
			throw new Error(`Erreur lors de la récupération des informations utilisateur: ${response.statusText}`);
		}

		return await response.json();
	}

	public async provisionUser(keycloakUser: KeycloakUserInfo): Promise<string> {
		const autoProvision = Settings.get('Synq_Keycloak_Auto_Provision');
		if (!autoProvision) {
			throw new Error('Provision automatique désactivée');
		}

		// Vérifier si l'utilisateur existe déjà
		let user = await Users.findOneByEmailAddress(keycloakUser.email);
		
		if (!user) {
			// Créer un nouvel utilisateur
			const userId = await Users.create({
				username: keycloakUser.preferred_username,
				emails: [{ address: keycloakUser.email, verified: true }],
				name: keycloakUser.name || `${keycloakUser.given_name || ''} ${keycloakUser.family_name || ''}`.trim(),
				active: true,
				services: {
					keycloak: {
						id: keycloakUser.sub,
						username: keycloakUser.preferred_username,
					},
				},
			});

			user = await Users.findOneById(userId);
			logger.info(`Utilisateur créé: ${keycloakUser.preferred_username}`);
		} else {
			// Mettre à jour l'utilisateur existant
			const autoUpdate = Settings.get('Synq_Keycloak_Auto_Update');
			if (autoUpdate) {
				await Users.updateOne(
					{ _id: user._id },
					{
						$set: {
							name: keycloakUser.name || `${keycloakUser.given_name || ''} ${keycloakUser.family_name || ''}`.trim(),
							emails: [{ address: keycloakUser.email, verified: true }],
							'services.keycloak': {
								id: keycloakUser.sub,
								username: keycloakUser.preferred_username,
							},
						},
					}
				);
				logger.info(`Utilisateur mis à jour: ${keycloakUser.preferred_username}`);
			}
		}

		// Synchroniser les rôles et groupes
		await this.syncUserRoles(user._id, keycloakUser);

		return user._id;
	}

	private async syncUserRoles(userId: string, keycloakUser: KeycloakUserInfo): Promise<void> {
		const syncRoles = Settings.get('Synq_Keycloak_Sync_Roles');
		const syncGroups = Settings.get('Synq_Keycloak_Sync_Groups');
		
		if (!syncRoles && !syncGroups) {
			return;
		}

		const roleMapping = JSON.parse(Settings.get('Synq_Keycloak_Role_Mapping') || '{}');
		const groupMapping = JSON.parse(Settings.get('Synq_Keycloak_Group_Mapping') || '{}');
		const defaultRole = Settings.get('Synq_Keycloak_Default_Role') || 'user';

		const synqRoles: string[] = [];

		// Synchroniser les rôles Keycloak
		if (syncRoles && keycloakUser.realm_access?.roles) {
			for (const keycloakRole of keycloakUser.realm_access.roles) {
				const synqRole = roleMapping[keycloakRole];
				if (synqRole) {
					synqRoles.push(synqRole);
				}
			}
		}

		// Synchroniser les groupes Keycloak
		if (syncGroups && keycloakUser.groups) {
			for (const keycloakGroup of keycloakUser.groups) {
				const synqRole = groupMapping[keycloakGroup];
				if (synqRole) {
					synqRoles.push(synqRole);
				}
			}
		}

		// Ajouter le rôle par défaut si aucun rôle n'est trouvé
		if (synqRoles.length === 0) {
			synqRoles.push(defaultRole);
		}

		// Appliquer les rôles à l'utilisateur
		for (const role of synqRoles) {
			await Roles.addUserRoles(userId, role);
		}

		logger.info(`Rôles synchronisés pour l'utilisateur ${userId}: ${synqRoles.join(', ')}`);
	}

	public async authenticateWithKeycloak(code: string): Promise<string> {
		try {
			// Échanger le code contre un token
			const accessToken = await this.exchangeCodeForToken(code);
			
			// Récupérer les informations utilisateur
			const keycloakUser = await this.getUserInfo(accessToken);
			
			// Provisionner ou mettre à jour l'utilisateur
			const userId = await this.provisionUser(keycloakUser);
			
			return userId;
		} catch (error) {
			logger.error('Erreur lors de l\'authentification Keycloak:', error);
			throw error;
		}
	}
}

export const synqKeycloakService = new SynqKeycloakService();


