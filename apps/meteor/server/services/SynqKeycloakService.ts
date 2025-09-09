import { HTTP } from 'meteor/http';
import { Logger } from '@rocket.chat/logger';
import { settings } from '@rocket.chat/settings';

const logger = new Logger('SynqKeycloakService');

export class SynqKeycloakService {
	private serverUrl: string;
	private realm: string;
	private clientId: string;
	private clientSecret: string;
	private accessToken: string | null = null;
	private tokenExpiry: number = 0;

	constructor() {
		this.serverUrl = settings.get('Synq_Keycloak_Server_URL') || '';
		this.realm = settings.get('Synq_Keycloak_Realm') || 'master';
		this.clientId = settings.get('Synq_Keycloak_Client_ID') || '';
		this.clientSecret = settings.get('Synq_Keycloak_Client_Secret') || '';
	}

	private async getAccessToken(): Promise<string> {
		try {
			// Vérifier si le token est encore valide
			if (this.accessToken && Date.now() < this.tokenExpiry) {
				return this.accessToken;
			}

			// Obtenir un nouveau token
			const tokenUrl = `${this.serverUrl}/realms/${this.realm}/protocol/openid-connect/token`;
			
			const response = HTTP.post(tokenUrl, {
				data: {
					grant_type: 'client_credentials',
					client_id: this.clientId,
					client_secret: this.clientSecret,
				},
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
			});

			if (response.statusCode === 200 && response.data) {
				this.accessToken = response.data.access_token;
				this.tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // 1 minute de marge
				
				logger.info('Successfully obtained Keycloak access token');
				return this.accessToken;
			} else {
				throw new Error(`Failed to obtain access token: ${response.statusCode}`);
			}
		} catch (error) {
			logger.error('Failed to obtain Keycloak access token:', error);
			throw error;
		}
	}

	private async makeRequest(endpoint: string, method: string = 'GET', data?: any): Promise<any> {
		try {
			const token = await this.getAccessToken();
			const url = `${this.serverUrl}/admin/realms/${this.realm}${endpoint}`;

			const options: any = {
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
			};

			if (data) {
				options.data = data;
			}

			let response;
			switch (method.toUpperCase()) {
				case 'GET':
					response = HTTP.get(url, options);
					break;
				case 'POST':
					response = HTTP.post(url, options);
					break;
				case 'PUT':
					response = HTTP.put(url, options);
					break;
				case 'DELETE':
					response = HTTP.del(url, options);
					break;
				default:
					throw new Error(`Unsupported HTTP method: ${method}`);
			}

			if (response.statusCode >= 200 && response.statusCode < 300) {
				return response.data;
			} else {
				throw new Error(`HTTP ${response.statusCode}: ${response.statusText}`);
			}
		} catch (error) {
			logger.error(`Keycloak API request failed for ${endpoint}:`, error);
			throw error;
		}
	}

	public async testConnection(): Promise<boolean> {
		try {
			await this.makeRequest('/users?max=1');
			logger.info('Keycloak connection test successful');
			return true;
		} catch (error) {
			logger.error('Keycloak connection test failed:', error);
			return false;
		}
	}

	public async getUsers(options: { max?: number; first?: number; search?: string } = {}): Promise<any[]> {
		try {
			const params = new URLSearchParams();
			if (options.max) params.append('max', options.max.toString());
			if (options.first) params.append('first', options.first.toString());
			if (options.search) params.append('search', options.search);

			const queryString = params.toString();
			const endpoint = `/users${queryString ? `?${queryString}` : ''}`;
			
			const users = await this.makeRequest(endpoint);
			logger.info(`Retrieved ${users.length} users from Keycloak`);
			return users;
		} catch (error) {
			logger.error('Failed to get users from Keycloak:', error);
			throw error;
		}
	}

	public async getUser(userId: string): Promise<any> {
		try {
			const user = await this.makeRequest(`/users/${userId}`);
			logger.info(`Retrieved user ${userId} from Keycloak`);
			return user;
		} catch (error) {
			logger.error(`Failed to get user ${userId} from Keycloak:`, error);
			throw error;
		}
	}

	public async createUser(userData: any): Promise<string> {
		try {
			const response = await this.makeRequest('/users', 'POST', userData);
			const userId = response.headers?.location?.split('/').pop();
			logger.info(`Created user ${userData.email} in Keycloak with ID: ${userId}`);
			return userId || '';
		} catch (error) {
			logger.error(`Failed to create user ${userData.email} in Keycloak:`, error);
			throw error;
		}
	}

	public async updateUser(userId: string, userData: any): Promise<void> {
		try {
			await this.makeRequest(`/users/${userId}`, 'PUT', userData);
			logger.info(`Updated user ${userId} in Keycloak`);
		} catch (error) {
			logger.error(`Failed to update user ${userId} in Keycloak:`, error);
			throw error;
		}
	}

	public async deleteUser(userId: string): Promise<void> {
		try {
			await this.makeRequest(`/users/${userId}`, 'DELETE');
			logger.info(`Deleted user ${userId} from Keycloak`);
		} catch (error) {
			logger.error(`Failed to delete user ${userId} from Keycloak:`, error);
			throw error;
		}
	}

	public async getGroups(options: { max?: number; first?: number; search?: string } = {}): Promise<any[]> {
		try {
			const params = new URLSearchParams();
			if (options.max) params.append('max', options.max.toString());
			if (options.first) params.append('first', options.first.toString());
			if (options.search) params.append('search', options.search);

			const queryString = params.toString();
			const endpoint = `/groups${queryString ? `?${queryString}` : ''}`;
			
			const groups = await this.makeRequest(endpoint);
			logger.info(`Retrieved ${groups.length} groups from Keycloak`);
			return groups;
		} catch (error) {
			logger.error('Failed to get groups from Keycloak:', error);
			throw error;
		}
	}

	public async getGroup(groupId: string): Promise<any> {
		try {
			const group = await this.makeRequest(`/groups/${groupId}`);
			logger.info(`Retrieved group ${groupId} from Keycloak`);
			return group;
		} catch (error) {
			logger.error(`Failed to get group ${groupId} from Keycloak:`, error);
			throw error;
		}
	}

	public async createGroup(groupData: any): Promise<string> {
		try {
			const response = await this.makeRequest('/groups', 'POST', groupData);
			const groupId = response.headers?.location?.split('/').pop();
			logger.info(`Created group ${groupData.name} in Keycloak with ID: ${groupId}`);
			return groupId || '';
		} catch (error) {
			logger.error(`Failed to create group ${groupData.name} in Keycloak:`, error);
			throw error;
		}
	}

	public async updateGroup(groupId: string, groupData: any): Promise<void> {
		try {
			await this.makeRequest(`/groups/${groupId}`, 'PUT', groupData);
			logger.info(`Updated group ${groupId} in Keycloak`);
		} catch (error) {
			logger.error(`Failed to update group ${groupId} in Keycloak:`, error);
			throw error;
		}
	}

	public async deleteGroup(groupId: string): Promise<void> {
		try {
			await this.makeRequest(`/groups/${groupId}`, 'DELETE');
			logger.info(`Deleted group ${groupId} from Keycloak`);
		} catch (error) {
			logger.error(`Failed to delete group ${groupId} from Keycloak:`, error);
			throw error;
		}
	}

	public async getRoles(): Promise<any[]> {
		try {
			const roles = await this.makeRequest('/roles');
			logger.info(`Retrieved ${roles.length} roles from Keycloak`);
			return roles;
		} catch (error) {
			logger.error('Failed to get roles from Keycloak:', error);
			throw error;
		}
	}

	public async getRole(roleName: string): Promise<any> {
		try {
			const role = await this.makeRequest(`/roles/${roleName}`);
			logger.info(`Retrieved role ${roleName} from Keycloak`);
			return role;
		} catch (error) {
			logger.error(`Failed to get role ${roleName} from Keycloak:`, error);
			throw error;
		}
	}

	public async createRole(roleData: any): Promise<void> {
		try {
			await this.makeRequest('/roles', 'POST', roleData);
			logger.info(`Created role ${roleData.name} in Keycloak`);
		} catch (error) {
			logger.error(`Failed to create role ${roleData.name} in Keycloak:`, error);
			throw error;
		}
	}

	public async updateRole(roleName: string, roleData: any): Promise<void> {
		try {
			await this.makeRequest(`/roles/${roleName}`, 'PUT', roleData);
			logger.info(`Updated role ${roleName} in Keycloak`);
		} catch (error) {
			logger.error(`Failed to update role ${roleName} in Keycloak:`, error);
			throw error;
		}
	}

	public async deleteRole(roleName: string): Promise<void> {
		try {
			await this.makeRequest(`/roles/${roleName}`, 'DELETE');
			logger.info(`Deleted role ${roleName} from Keycloak`);
		} catch (error) {
			logger.error(`Failed to delete role ${roleName} from Keycloak:`, error);
			throw error;
		}
	}

	public async getUserGroups(userId: string): Promise<any[]> {
		try {
			const groups = await this.makeRequest(`/users/${userId}/groups`);
			logger.info(`Retrieved ${groups.length} groups for user ${userId} from Keycloak`);
			return groups;
		} catch (error) {
			logger.error(`Failed to get groups for user ${userId} from Keycloak:`, error);
			throw error;
		}
	}

	public async getUserRoles(userId: string): Promise<any[]> {
		try {
			const roles = await this.makeRequest(`/users/${userId}/role-mappings/realm`);
			logger.info(`Retrieved ${roles.length} roles for user ${userId} from Keycloak`);
			return roles;
		} catch (error) {
			logger.error(`Failed to get roles for user ${userId} from Keycloak:`, error);
			throw error;
		}
	}

	public async assignUserToGroup(userId: string, groupId: string): Promise<void> {
		try {
			await this.makeRequest(`/users/${userId}/groups/${groupId}`, 'PUT');
			logger.info(`Assigned user ${userId} to group ${groupId} in Keycloak`);
		} catch (error) {
			logger.error(`Failed to assign user ${userId} to group ${groupId} in Keycloak:`, error);
			throw error;
		}
	}

	public async removeUserFromGroup(userId: string, groupId: string): Promise<void> {
		try {
			await this.makeRequest(`/users/${userId}/groups/${groupId}`, 'DELETE');
			logger.info(`Removed user ${userId} from group ${groupId} in Keycloak`);
		} catch (error) {
			logger.error(`Failed to remove user ${userId} from group ${groupId} in Keycloak:`, error);
			throw error;
		}
	}

	public async assignRoleToUser(userId: string, roleData: any): Promise<void> {
		try {
			await this.makeRequest(`/users/${userId}/role-mappings/realm`, 'POST', [roleData]);
			logger.info(`Assigned role ${roleData.name} to user ${userId} in Keycloak`);
		} catch (error) {
			logger.error(`Failed to assign role ${roleData.name} to user ${userId} in Keycloak:`, error);
			throw error;
		}
	}

	public async removeRoleFromUser(userId: string, roleData: any): Promise<void> {
		try {
			await this.makeRequest(`/users/${userId}/role-mappings/realm`, 'DELETE', [roleData]);
			logger.info(`Removed role ${roleData.name} from user ${userId} in Keycloak`);
		} catch (error) {
			logger.error(`Failed to remove role ${roleData.name} from user ${userId} in Keycloak:`, error);
			throw error;
		}
	}
}
