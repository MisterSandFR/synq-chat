import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Users } from '@rocket.chat/models';
import { Rooms } from '@rocket.chat/models';
import { Roles } from '@rocket.chat/models';
import { settings } from '@rocket.chat/settings';
import { Logger } from '@rocket.chat/logger';
import { api } from '@rocket.chat/core-services/api';
import { Random } from 'meteor/random';

const logger = new Logger('SynqPermissions');

// Collections pour les permissions granulaires
export const SynqPermissions = new Mongo.Collection('synq_permissions');
export const SynqRoleTemplates = new Mongo.Collection('synq_role_templates');
export const SynqPermissionAudit = new Mongo.Collection('synq_permission_audit');

interface Permission {
	_id: string;
	name: string;
	description: string;
	category: 'channel' | 'user' | 'system' | 'workflow' | 'analytics' | 'document' | 'jitsi';
	resource: string; // e.g., 'channel', 'user', 'message'
	action: string; // e.g., 'read', 'write', 'delete', 'admin'
	conditions?: {
		channelType?: string[];
		userRole?: string[];
		timeRestrictions?: {
			start: string;
			end: string;
			timezone: string;
		};
		customConditions?: string; // Expression JavaScript sécurisée
	};
	enabled: boolean;
	createdAt: Date;
	createdBy: string;
}

interface RoleTemplate {
	_id: string;
	name: string;
	description: string;
	category: 'admin' | 'moderator' | 'user' | 'guest' | 'custom';
	permissions: string[]; // IDs des permissions
	inheritsFrom?: string[]; // IDs des rôles hérités
	isDefault: boolean;
	enabled: boolean;
	createdAt: Date;
	createdBy: string;
}

interface UserRole {
	_id: string;
	userId: string;
	roleId: string;
	channelId?: string; // Pour les rôles spécifiques au canal
	assignedBy: string;
	assignedAt: Date;
	expiresAt?: Date;
	conditions?: {
		channelType?: string;
		timeRestrictions?: any;
	};
	enabled: boolean;
}

interface PermissionAudit {
	_id: string;
	userId: string;
	action: 'grant' | 'revoke' | 'modify' | 'access' | 'denied';
	resource: string;
	resourceId: string;
	permission: string;
	channelId?: string;
	timestamp: Date;
	ipAddress?: string;
	userAgent?: string;
	metadata?: any;
}

class SynqPermissionService {
	private permissionCache: Map<string, Permission[]> = new Map();
	private roleCache: Map<string, RoleTemplate[]> = new Map();
	private cacheExpiry: Map<string, number> = new Map();
	private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

	constructor() {
		this.initializeService();
	}

	private async initializeService(): Promise<void> {
		try {
			const isEnabled = settings.get('Synq_Permissions_Granular_Enabled');
			if (!isEnabled) {
				logger.info('Granular permissions service is disabled');
				return;
			}

			await this.loadDefaultPermissions();
			await this.loadDefaultRoleTemplates();
			await this.startCacheRefresh();
			logger.info('Granular permissions service initialized successfully');
		} catch (error) {
			logger.error('Failed to initialize Granular permissions service:', error);
		}
	}

	private async loadDefaultPermissions(): Promise<void> {
		try {
			const defaultPermissions: Permission[] = [
				// Permissions de canal
				{
					_id: 'channel_read',
					name: 'Lire les canaux',
					description: 'Permission de lire les messages dans les canaux',
					category: 'channel',
					resource: 'channel',
					action: 'read',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'channel_write',
					name: 'Écrire dans les canaux',
					description: 'Permission d\'envoyer des messages dans les canaux',
					category: 'channel',
					resource: 'channel',
					action: 'write',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'channel_admin',
					name: 'Administrer les canaux',
					description: 'Permission d\'administrer les canaux',
					category: 'channel',
					resource: 'channel',
					action: 'admin',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				// Permissions utilisateur
				{
					_id: 'user_manage',
					name: 'Gérer les utilisateurs',
					description: 'Permission de gérer les utilisateurs',
					category: 'user',
					resource: 'user',
					action: 'manage',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'user_invite',
					name: 'Inviter des utilisateurs',
					description: 'Permission d\'inviter de nouveaux utilisateurs',
					category: 'user',
					resource: 'user',
					action: 'invite',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				// Permissions système
				{
					_id: 'system_admin',
					name: 'Administration système',
					description: 'Permission d\'accéder à l\'administration système',
					category: 'system',
					resource: 'system',
					action: 'admin',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'system_settings',
					name: 'Modifier les paramètres',
					description: 'Permission de modifier les paramètres système',
					category: 'system',
					resource: 'settings',
					action: 'modify',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				// Permissions workflow
				{
					_id: 'workflow_create',
					name: 'Créer des workflows',
					description: 'Permission de créer des workflows',
					category: 'workflow',
					resource: 'workflow',
					action: 'create',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'workflow_execute',
					name: 'Exécuter des workflows',
					description: 'Permission d\'exécuter des workflows',
					category: 'workflow',
					resource: 'workflow',
					action: 'execute',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				// Permissions analytics
				{
					_id: 'analytics_view',
					name: 'Voir les analytics',
					description: 'Permission de voir les analytics',
					category: 'analytics',
					resource: 'analytics',
					action: 'view',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'analytics_export',
					name: 'Exporter les analytics',
					description: 'Permission d\'exporter les données analytics',
					category: 'analytics',
					resource: 'analytics',
					action: 'export',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				// Permissions documents
				{
					_id: 'document_create',
					name: 'Créer des documents',
					description: 'Permission de créer des documents collaboratifs',
					category: 'document',
					resource: 'document',
					action: 'create',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'document_edit',
					name: 'Modifier des documents',
					description: 'Permission de modifier des documents collaboratifs',
					category: 'document',
					resource: 'document',
					action: 'edit',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				// Permissions Jitsi
				{
					_id: 'jitsi_create_room',
					name: 'Créer des salles Jitsi',
					description: 'Permission de créer des salles vocales Jitsi',
					category: 'jitsi',
					resource: 'jitsi_room',
					action: 'create',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'jitsi_join_room',
					name: 'Rejoindre des salles Jitsi',
					description: 'Permission de rejoindre des salles vocales Jitsi',
					category: 'jitsi',
					resource: 'jitsi_room',
					action: 'join',
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
			];

			for (const permission of defaultPermissions) {
				await SynqPermissions.upsert(
					{ _id: permission._id },
					{ $set: permission }
				);
			}

			logger.info(`Loaded ${defaultPermissions.length} default permissions`);
		} catch (error) {
			logger.error('Failed to load default permissions:', error);
		}
	}

	private async loadDefaultRoleTemplates(): Promise<void> {
		try {
			const defaultRoles: RoleTemplate[] = [
				{
					_id: 'admin',
					name: 'Administrateur',
					description: 'Accès complet à toutes les fonctionnalités',
					category: 'admin',
					permissions: [
						'channel_read', 'channel_write', 'channel_admin',
						'user_manage', 'user_invite',
						'system_admin', 'system_settings',
						'workflow_create', 'workflow_execute',
						'analytics_view', 'analytics_export',
						'document_create', 'document_edit',
						'jitsi_create_room', 'jitsi_join_room',
					],
					isDefault: true,
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'moderator',
					name: 'Modérateur',
					description: 'Gestion des canaux et utilisateurs',
					category: 'moderator',
					permissions: [
						'channel_read', 'channel_write', 'channel_admin',
						'user_invite',
						'workflow_execute',
						'document_create', 'document_edit',
						'jitsi_create_room', 'jitsi_join_room',
					],
					isDefault: true,
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'user',
					name: 'Utilisateur',
					description: 'Utilisateur standard avec accès de base',
					category: 'user',
					permissions: [
						'channel_read', 'channel_write',
						'document_create', 'document_edit',
						'jitsi_join_room',
					],
					isDefault: true,
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'guest',
					name: 'Invité',
					description: 'Accès limité en lecture seule',
					category: 'guest',
					permissions: [
						'channel_read',
					],
					isDefault: true,
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
			];

			for (const role of defaultRoles) {
				await SynqRoleTemplates.upsert(
					{ _id: role._id },
					{ $set: role }
				);
			}

			logger.info(`Loaded ${defaultRoles.length} default role templates`);
		} catch (error) {
			logger.error('Failed to load default role templates:', error);
		}
	}

	private async startCacheRefresh(): Promise<void> {
		// Rafraîchir le cache toutes les 5 minutes
		setInterval(async () => {
			try {
				await this.refreshCache();
			} catch (error) {
				logger.error('Cache refresh failed:', error);
			}
		}, this.CACHE_DURATION);

		logger.info('Started permission cache refresh');
	}

	private async refreshCache(): Promise<void> {
		try {
			this.permissionCache.clear();
			this.roleCache.clear();
			this.cacheExpiry.clear();
			logger.info('Permission cache refreshed');
		} catch (error) {
			logger.error('Failed to refresh cache:', error);
		}
	}

	public async checkPermission(
		userId: string,
		permission: string,
		resourceId?: string,
		channelId?: string
	): Promise<boolean> {
		try {
			// Vérifier le cache d'abord
			const cacheKey = `${userId}_${permission}_${resourceId || ''}_${channelId || ''}`;
			if (this.isCacheValid(cacheKey)) {
				const cachedPermissions = this.permissionCache.get(cacheKey);
				if (cachedPermissions) {
					return cachedPermissions.some(p => p._id === permission);
				}
			}

			// Obtenir les rôles de l'utilisateur
			const userRoles = await this.getUserRoles(userId, channelId);
			
			// Vérifier chaque rôle
			for (const userRole of userRoles) {
				const roleTemplate = await this.getRoleTemplate(userRole.roleId);
				if (!roleTemplate) {
					continue;
				}

				// Vérifier les permissions du rôle
				if (roleTemplate.permissions.includes(permission)) {
					// Vérifier les conditions spécifiques
					if (await this.checkPermissionConditions(permission, userRole, resourceId, channelId)) {
						// Mettre en cache le résultat
						this.cachePermission(cacheKey, [{ _id: permission } as Permission]);
						
						// Enregistrer l'audit
						await this.logPermissionAccess(userId, permission, resourceId, channelId, true);
						
						return true;
					}
				}
			}

			// Enregistrer l'audit pour l'accès refusé
			await this.logPermissionAccess(userId, permission, resourceId, channelId, false);
			
			return false;
		} catch (error) {
			logger.error(`Failed to check permission ${permission} for user ${userId}:`, error);
			return false;
		}
	}

	private async checkPermissionConditions(
		permission: string,
		userRole: UserRole,
		resourceId?: string,
		channelId?: string
	): Promise<boolean> {
		try {
			const permissionDef = await SynqPermissions.findOne(permission);
			if (!permissionDef || !permissionDef.conditions) {
				return true;
			}

			const conditions = permissionDef.conditions;

			// Vérifier les restrictions de temps
			if (conditions.timeRestrictions) {
				if (!this.isWithinTimeRestrictions(conditions.timeRestrictions)) {
					return false;
				}
			}

			// Vérifier les conditions personnalisées
			if (conditions.customConditions) {
				try {
					// Évaluer les conditions personnalisées de manière sécurisée
					const context = {
						userId: userRole.userId,
						roleId: userRole.roleId,
						channelId,
						resourceId,
						timestamp: new Date(),
					};
					
					// Dans un environnement de production, utiliser une bibliothèque d'évaluation sécurisée
					const result = this.evaluateCustomCondition(conditions.customConditions, context);
					if (!result) {
						return false;
					}
				} catch (error) {
					logger.error('Failed to evaluate custom conditions:', error);
					return false;
				}
			}

			return true;
		} catch (error) {
			logger.error('Failed to check permission conditions:', error);
			return false;
		}
	}

	private isWithinTimeRestrictions(timeRestrictions: any): boolean {
		try {
			const now = new Date();
			const currentTime = now.toLocaleTimeString('en-US', {
				hour12: false,
				timeZone: timeRestrictions.timezone,
			});

			return currentTime >= timeRestrictions.start && currentTime <= timeRestrictions.end;
		} catch (error) {
			logger.error('Failed to check time restrictions:', error);
			return true; // Par défaut, autoriser si la vérification échoue
		}
	}

	private evaluateCustomCondition(condition: string, context: any): boolean {
		try {
			// Implémentation simplifiée pour l'évaluation des conditions
			// Dans un environnement de production, utiliser une bibliothèque sécurisée
			
			// Exemples de conditions simples
			if (condition.includes('userId ==')) {
				const expectedUserId = condition.split('userId ==')[1].trim().replace(/['"]/g, '');
				return context.userId === expectedUserId;
			}
			
			if (condition.includes('channelId ==')) {
				const expectedChannelId = condition.split('channelId ==')[1].trim().replace(/['"]/g, '');
				return context.channelId === expectedChannelId;
			}

			// Condition booléenne simple
			return Boolean(condition);
		} catch (error) {
			logger.error('Failed to evaluate custom condition:', error);
			return false;
		}
	}

	private async getUserRoles(userId: string, channelId?: string): Promise<UserRole[]> {
		try {
			const query: any = { userId, enabled: true };
			if (channelId) {
				query.$or = [
					{ channelId: { $exists: false } }, // Rôles globaux
					{ channelId }, // Rôles spécifiques au canal
				];
			}

			return await SynqPermissions.find(query).fetch() as UserRole[];
		} catch (error) {
			logger.error(`Failed to get roles for user ${userId}:`, error);
			return [];
		}
	}

	private async getRoleTemplate(roleId: string): Promise<RoleTemplate | null> {
		try {
			// Vérifier le cache d'abord
			if (this.roleCache.has(roleId)) {
				const cached = this.roleCache.get(roleId);
				if (cached && cached.length > 0) {
					return cached[0];
				}
			}

			const role = await SynqRoleTemplates.findOne(roleId);
			if (role) {
				this.roleCache.set(roleId, [role]);
			}

			return role;
		} catch (error) {
			logger.error(`Failed to get role template ${roleId}:`, error);
			return null;
		}
	}

	private isCacheValid(key: string): boolean {
		const expiry = this.cacheExpiry.get(key);
		return expiry ? Date.now() < expiry : false;
	}

	private cachePermission(key: string, permissions: Permission[]): void {
		this.permissionCache.set(key, permissions);
		this.cacheExpiry.set(key, Date.now() + this.CACHE_DURATION);
	}

	private async logPermissionAccess(
		userId: string,
		permission: string,
		resourceId?: string,
		channelId?: string,
		granted: boolean = true
	): Promise<void> {
		try {
			if (!settings.get('Synq_Permissions_Enable_Audit')) {
				return;
			}

			const audit: PermissionAudit = {
				_id: Random.id(),
				userId,
				action: granted ? 'access' : 'denied',
				resource: 'permission',
				resourceId: permission,
				permission,
				channelId,
				timestamp: new Date(),
				ipAddress: this.connection?.clientAddress,
				userAgent: this.connection?.httpHeaders?.['user-agent'],
			};

			await SynqPermissionAudit.insert(audit);
		} catch (error) {
			logger.error('Failed to log permission access:', error);
		}
	}

	public async assignRole(
		userId: string,
		roleId: string,
		channelId?: string,
		expiresAt?: Date,
		conditions?: any
	): Promise<void> {
		try {
			const userRole: UserRole = {
				_id: Random.id(),
				userId,
				roleId,
				channelId,
				assignedBy: this.userId!,
				assignedAt: new Date(),
				expiresAt,
				conditions,
				enabled: true,
			};

			await SynqPermissions.insert(userRole);

			// Enregistrer l'audit
			await this.logPermissionAction('grant', userId, 'role', roleId, channelId);

			logger.info(`Assigned role ${roleId} to user ${userId}`);
		} catch (error) {
			logger.error(`Failed to assign role ${roleId} to user ${userId}:`, error);
			throw error;
		}
	}

	public async revokeRole(userId: string, roleId: string, channelId?: string): Promise<void> {
		try {
			const query: any = { userId, roleId, enabled: true };
			if (channelId) {
				query.channelId = channelId;
			}

			await SynqPermissions.update(query, { $set: { enabled: false } });

			// Enregistrer l'audit
			await this.logPermissionAction('revoke', userId, 'role', roleId, channelId);

			logger.info(`Revoked role ${roleId} from user ${userId}`);
		} catch (error) {
			logger.error(`Failed to revoke role ${roleId} from user ${userId}:`, error);
			throw error;
		}
	}

	private async logPermissionAction(
		action: 'grant' | 'revoke' | 'modify',
		userId: string,
		resource: string,
		resourceId: string,
		channelId?: string
	): Promise<void> {
		try {
			const audit: PermissionAudit = {
				_id: Random.id(),
				userId,
				action,
				resource,
				resourceId,
				channelId,
				timestamp: new Date(),
				ipAddress: this.connection?.clientAddress,
				userAgent: this.connection?.httpHeaders?.['user-agent'],
			};

			await SynqPermissionAudit.insert(audit);
		} catch (error) {
			logger.error('Failed to log permission action:', error);
		}
	}

	public async createRoleTemplate(
		name: string,
		description: string,
		category: RoleTemplate['category'],
		permissions: string[],
		inheritsFrom?: string[]
	): Promise<RoleTemplate> {
		try {
			const roleTemplate: RoleTemplate = {
				_id: Random.id(),
				name,
				description,
				category,
				permissions,
				inheritsFrom,
				isDefault: false,
				enabled: true,
				createdAt: new Date(),
				createdBy: this.userId!,
			};

			await SynqRoleTemplates.insert(roleTemplate);
			logger.info(`Created role template: ${name}`);

			return roleTemplate;
		} catch (error) {
			logger.error('Failed to create role template:', error);
			throw error;
		}
	}

	public async getPermissions(): Promise<Permission[]> {
		return await SynqPermissions.find({ enabled: true }).fetch();
	}

	public async getRoleTemplates(): Promise<RoleTemplate[]> {
		return await SynqRoleTemplates.find({ enabled: true }).fetch();
	}

	public async getPermissionAudit(
		userId?: string,
		startDate?: Date,
		endDate?: Date,
		limit: number = 100
	): Promise<PermissionAudit[]> {
		try {
			const query: any = {};
			
			if (userId) {
				query.userId = userId;
			}
			
			if (startDate || endDate) {
				query.timestamp = {};
				if (startDate) {
					query.timestamp.$gte = startDate;
				}
				if (endDate) {
					query.timestamp.$lte = endDate;
				}
			}

			return await SynqPermissionAudit.find(query, {
				sort: { timestamp: -1 },
				limit,
			}).fetch();
		} catch (error) {
			logger.error('Failed to get permission audit:', error);
			return [];
		}
	}
}

// Instance globale du service
let permissionService: SynqPermissionService | null = null;

Meteor.startup(async () => {
	try {
		permissionService = new SynqPermissionService();
	} catch (error) {
		logger.error('Failed to initialize Permission service:', error);
	}
});

// Méthodes Meteor pour l'interface utilisateur
Meteor.methods({
	async 'synq.permissions.check'(permission: string, resourceId?: string, channelId?: string): Promise<boolean> {
		if (!permissionService) {
			throw new Meteor.Error('permission-not-initialized', 'Permission service is not initialized');
		}
		return await permissionService.checkPermission(this.userId!, permission, resourceId, channelId);
	},

	async 'synq.permissions.assign-role'(userId: string, roleId: string, channelId?: string, expiresAt?: Date, conditions?: any): Promise<void> {
		if (!permissionService) {
			throw new Meteor.Error('permission-not-initialized', 'Permission service is not initialized');
		}
		return await permissionService.assignRole(userId, roleId, channelId, expiresAt, conditions);
	},

	async 'synq.permissions.revoke-role'(userId: string, roleId: string, channelId?: string): Promise<void> {
		if (!permissionService) {
			throw new Meteor.Error('permission-not-initialized', 'Permission service is not initialized');
		}
		return await permissionService.revokeRole(userId, roleId, channelId);
	},

	async 'synq.permissions.create-role-template'(name: string, description: string, category: string, permissions: string[], inheritsFrom?: string[]): Promise<RoleTemplate> {
		if (!permissionService) {
			throw new Meteor.Error('permission-not-initialized', 'Permission service is not initialized');
		}
		return await permissionService.createRoleTemplate(name, description, category as any, permissions, inheritsFrom);
	},

	async 'synq.permissions.get-permissions'(): Promise<Permission[]> {
		if (!permissionService) {
			throw new Meteor.Error('permission-not-initialized', 'Permission service is not initialized');
		}
		return await permissionService.getPermissions();
	},

	async 'synq.permissions.get-role-templates'(): Promise<RoleTemplate[]> {
		if (!permissionService) {
			throw new Meteor.Error('permission-not-initialized', 'Permission service is not initialized');
		}
		return await permissionService.getRoleTemplates();
	},

	async 'synq.permissions.get-audit'(userId?: string, startDate?: Date, endDate?: Date, limit: number = 100): Promise<PermissionAudit[]> {
		if (!permissionService) {
			throw new Meteor.Error('permission-not-initialized', 'Permission service is not initialized');
		}
		return await permissionService.getPermissionAudit(userId, startDate, endDate, limit);
	},
});

// API REST pour l'intégration externe
api.addRoute('synq/permissions/check', { authRequired: true }, {
	async post() {
		if (!permissionService) {
			throw new Error('Permission service is not initialized');
		}
		const { permission, resourceId, channelId } = this.bodyParams;
		return await permissionService.checkPermission(this.userId!, permission, resourceId, channelId);
	},
});

api.addRoute('synq/permissions/roles', { authRequired: true }, {
	async get() {
		if (!permissionService) {
			throw new Error('Permission service is not initialized');
		}
		return await permissionService.getRoleTemplates();
	},

	async post() {
		if (!permissionService) {
			throw new Error('Permission service is not initialized');
		}
		const { name, description, category, permissions, inheritsFrom } = this.bodyParams;
		return await permissionService.createRoleTemplate(name, description, category, permissions, inheritsFrom);
	},
});

api.addRoute('synq/permissions/assign', { authRequired: true }, {
	async post() {
		if (!permissionService) {
			throw new Error('Permission service is not initialized');
		}
		const { userId, roleId, channelId, expiresAt, conditions } = this.bodyParams;
		return await permissionService.assignRole(userId, roleId, channelId, expiresAt, conditions);
	},
});

api.addRoute('synq/permissions/revoke', { authRequired: true }, {
	async post() {
		if (!permissionService) {
			throw new Error('Permission service is not initialized');
		}
		const { userId, roleId, channelId } = this.bodyParams;
		return await permissionService.revokeRole(userId, roleId, channelId);
	},
});

api.addRoute('synq/permissions/audit', { authRequired: true }, {
	async get() {
		if (!permissionService) {
			throw new Error('Permission service is not initialized');
		}
		const { userId, startDate, endDate, limit = 100 } = this.queryParams;
		return await permissionService.getPermissionAudit(userId, startDate ? new Date(startDate) : undefined, endDate ? new Date(endDate) : undefined, limit);
	},
});

export { SynqPermissionService };
