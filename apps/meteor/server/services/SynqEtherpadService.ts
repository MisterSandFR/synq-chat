import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { Rooms } from '@rocket.chat/models';
import { Users } from '@rocket.chat/models';
import { Messages } from '@rocket.chat/models';
import { settings } from '@rocket.chat/settings';
import { Logger } from '@rocket.chat/logger';
import { api } from '@rocket.chat/core-services/api';
import { Random } from 'meteor/random';

const logger = new Logger('SynqEtherpad');

interface EtherpadDocument {
	_id: string;
	name: string;
	padId: string;
	channelId: string;
	createdBy: string;
	createdAt: Date;
	lastModified: Date;
	isActive: boolean;
	participants: string[];
	permissions: {
		read: string[];
		write: string[];
		admin: string[];
	};
	template?: string;
	versions: DocumentVersion[];
	settings: {
		autoSave: boolean;
		versioning: boolean;
		exportEnabled: boolean;
	};
}

interface DocumentVersion {
	version: number;
	createdAt: Date;
	createdBy: string;
	description?: string;
	content: string;
}

interface EtherpadTemplate {
	id: string;
	name: string;
	description: string;
	content: string;
	category: 'meeting' | 'notes' | 'brainstorming' | 'custom';
}

class SynqEtherpadService {
	private documents: Map<string, EtherpadDocument> = new Map();
	private serverUrl: string;
	private apiKey: string;
	private editorType: string;

	constructor() {
		this.serverUrl = settings.get('Synq_Docs_Server_URL') || 'http://localhost:9001';
		this.apiKey = settings.get('Synq_Docs_API_Key') || '';
		this.editorType = settings.get('Synq_Docs_Editor_Type') || 'etherpad';
		this.initializeService();
	}

	private async initializeService(): Promise<void> {
		try {
			const isEnabled = settings.get('Synq_Docs_Enabled');
			if (!isEnabled) {
				logger.info('Collaborative documents integration is disabled');
				return;
			}

			await this.loadExistingDocuments();
			await this.startDocumentCleanup();
			logger.info('Etherpad service initialized successfully');
		} catch (error) {
			logger.error('Failed to initialize Etherpad service:', error);
		}
	}

	private async loadExistingDocuments(): Promise<void> {
		try {
			// Charger les documents existants depuis la base de données
			const rooms = await Rooms.find({
				'docs.documents': { $exists: true },
			}).toArray();

			for (const room of rooms) {
				if (room.docs?.documents) {
					for (const doc of room.docs.documents) {
						const document: EtherpadDocument = {
							_id: doc._id,
							name: doc.name,
							padId: doc.padId,
							channelId: room._id,
							createdBy: doc.createdBy,
							createdAt: doc.createdAt,
							lastModified: doc.lastModified,
							isActive: doc.isActive,
							participants: doc.participants || [],
							permissions: doc.permissions || { read: [], write: [], admin: [] },
							template: doc.template,
							versions: doc.versions || [],
							settings: {
								autoSave: doc.settings?.autoSave ?? settings.get('Synq_Docs_Auto_Save') ?? true,
								versioning: doc.settings?.versioning ?? settings.get('Synq_Docs_Versioning') ?? true,
								exportEnabled: doc.settings?.exportEnabled ?? settings.get('Synq_Docs_Export_Enabled') ?? true,
							},
						};

						this.documents.set(doc._id, document);
					}
				}
			}

			logger.info(`Loaded ${this.documents.size} existing documents`);
		} catch (error) {
			logger.error('Failed to load existing documents:', error);
		}
	}

	private async startDocumentCleanup(): Promise<void> {
		// Nettoyer les documents expirés toutes les heures
		setInterval(async () => {
			try {
				await this.cleanupExpiredDocuments();
			} catch (error) {
				logger.error('Document cleanup failed:', error);
			}
		}, 60 * 60 * 1000);
	}

	private async cleanupExpiredDocuments(): Promise<void> {
		const lifetime = settings.get('Synq_Docs_Lifetime') || 30;
		const cutoffDate = new Date(Date.now() - lifetime * 24 * 60 * 60 * 1000);

		for (const [docId, doc] of this.documents) {
			if (!doc.isActive && doc.lastModified < cutoffDate) {
				await this.deleteDocument(docId);
			}
		}
	}

	public async createDocument(
		channelId: string,
		documentName: string,
		templateId?: string,
		permissions?: { read: string[]; write: string[]; admin: string[] }
	): Promise<EtherpadDocument> {
		try {
			const channel = await Rooms.findOneById(channelId);
			if (!channel) {
				throw new Error('Channel not found');
			}

			const user = await Users.findOneById(this.userId!);
			if (!user) {
				throw new Error('User not found');
			}

			const documentId = Random.id();
			const padId = `synq-${channelId}-${documentId}`;

			// Créer le pad sur Etherpad
			await this.createEtherpadPad(padId, documentName);

			// Appliquer le template si spécifié
			if (templateId) {
				await this.applyTemplate(padId, templateId);
			}

			const document: EtherpadDocument = {
				_id: documentId,
				name: documentName,
				padId,
				channelId,
				createdBy: this.userId!,
				createdAt: new Date(),
				lastModified: new Date(),
				isActive: true,
				participants: [this.userId!],
				permissions: permissions || {
					read: [this.userId!],
					write: [this.userId!],
					admin: [this.userId!],
				},
				template: templateId,
				versions: [],
				settings: {
					autoSave: settings.get('Synq_Docs_Auto_Save') || true,
					versioning: settings.get('Synq_Docs_Versioning') || true,
					exportEnabled: settings.get('Synq_Docs_Export_Enabled') || true,
				},
			};

			this.documents.set(documentId, document);

			// Sauvegarder dans la base de données
			await this.saveDocumentToDatabase(document);

			// Envoyer une notification au canal
			await this.notifyChannelDocumentCreated(channel, user, document);

			logger.info(`Created document: ${documentName} in channel: ${channel.name}`);
			return document;
		} catch (error) {
			logger.error('Failed to create document:', error);
			throw error;
		}
	}

	private async createEtherpadPad(padId: string, padName: string): Promise<void> {
		try {
			const url = `${this.serverUrl}/api/1/createPad`;
			const params = {
				apikey: this.apiKey,
				padID: padId,
				text: `# ${padName}\n\n`,
			};

			const response = HTTP.post(url, { params });
			
			if (response.statusCode !== 200) {
				throw new Error(`Failed to create Etherpad: ${response.statusCode}`);
			}

			logger.info(`Created Etherpad: ${padId}`);
		} catch (error) {
			logger.error(`Failed to create Etherpad ${padId}:`, error);
			throw error;
		}
	}

	private async applyTemplate(padId: string, templateId: string): Promise<void> {
		try {
			const template = await this.getTemplate(templateId);
			if (!template) {
				throw new Error('Template not found');
			}

			const url = `${this.serverUrl}/api/1/setText`;
			const params = {
				apikey: this.apiKey,
				padID: padId,
				text: template.content,
			};

			await HTTP.post(url, { params });
			logger.info(`Applied template ${templateId} to pad ${padId}`);
		} catch (error) {
			logger.error(`Failed to apply template ${templateId} to pad ${padId}:`, error);
		}
	}

	public async getDocumentUrl(documentId: string, userId: string): Promise<string> {
		try {
			const document = this.documents.get(documentId);
			if (!document) {
				throw new Error('Document not found');
			}

			// Vérifier les permissions
			if (!this.hasPermission(document, userId, 'read')) {
				throw new Error('Insufficient permissions');
			}

			// Ajouter l'utilisateur aux participants s'il n'y est pas déjà
			if (!document.participants.includes(userId)) {
				document.participants.push(userId);
				await this.updateDocument(document);
			}

			// Générer l'URL avec les paramètres appropriés
			const url = new URL(`${this.serverUrl}/p/${document.padId}`);
			
			// Ajouter les paramètres utilisateur
			const user = await Users.findOneById(userId);
			if (user) {
				url.searchParams.set('userName', user.name || user.username);
				url.searchParams.set('userColor', this.generateUserColor(userId));
			}

			return url.toString();
		} catch (error) {
			logger.error(`Failed to get document URL for ${documentId}:`, error);
			throw error;
		}
	}

	private generateUserColor(userId: string): string {
		// Générer une couleur basée sur l'ID utilisateur
		const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3', '#54a0ff'];
		const index = userId.charCodeAt(0) % colors.length;
		return colors[index];
	}

	public async saveDocumentVersion(documentId: string, description?: string): Promise<void> {
		try {
			const document = this.documents.get(documentId);
			if (!document) {
				throw new Error('Document not found');
			}

			if (!document.settings.versioning) {
				return;
			}

			// Obtenir le contenu actuel du pad
			const content = await this.getEtherpadContent(document.padId);
			
			const version: DocumentVersion = {
				version: document.versions.length + 1,
				createdAt: new Date(),
				createdBy: this.userId!,
				description,
				content,
			};

			document.versions.push(version);
			document.lastModified = new Date();

			await this.updateDocument(document);
			logger.info(`Saved version ${version.version} for document ${documentId}`);
		} catch (error) {
			logger.error(`Failed to save version for document ${documentId}:`, error);
		}
	}

	private async getEtherpadContent(padId: string): Promise<string> {
		try {
			const url = `${this.serverUrl}/api/1/getText`;
			const params = {
				apikey: this.apiKey,
				padID: padId,
			};

			const response = HTTP.get(url, { params });
			return response.data?.data?.text || '';
		} catch (error) {
			logger.error(`Failed to get content for pad ${padId}:`, error);
			return '';
		}
	}

	public async exportDocument(documentId: string, format: 'html' | 'txt' | 'pdf' = 'html'): Promise<string> {
		try {
			const document = this.documents.get(documentId);
			if (!document) {
				throw new Error('Document not found');
			}

			if (!document.settings.exportEnabled) {
				throw new Error('Export is disabled for this document');
			}

			const url = `${this.serverUrl}/api/1/get${format.charAt(0).toUpperCase() + format.slice(1)}`;
			const params = {
				apikey: this.apiKey,
				padID: document.padId,
			};

			const response = HTTP.get(url, { params });
			return response.data?.data || '';
		} catch (error) {
			logger.error(`Failed to export document ${documentId} as ${format}:`, error);
			throw error;
		}
	}

	public async deleteDocument(documentId: string): Promise<void> {
		try {
			const document = this.documents.get(documentId);
			if (!document) {
				return;
			}

			// Supprimer le pad d'Etherpad
			await this.deleteEtherpadPad(document.padId);

			// Supprimer de la base de données
			await Rooms.updateOne(
				{ _id: document.channelId },
				{
					$unset: {
						[`docs.documents.${documentId}`]: 1,
					},
				}
			);

			// Supprimer de la collection locale
			this.documents.delete(documentId);

			logger.info(`Deleted document: ${document.name}`);
		} catch (error) {
			logger.error(`Failed to delete document ${documentId}:`, error);
		}
	}

	private async deleteEtherpadPad(padId: string): Promise<void> {
		try {
			const url = `${this.serverUrl}/api/1/deletePad`;
			const params = {
				apikey: this.apiKey,
				padID: padId,
			};

			await HTTP.post(url, { params });
			logger.info(`Deleted Etherpad: ${padId}`);
		} catch (error) {
			logger.error(`Failed to delete Etherpad ${padId}:`, error);
		}
	}

	public async getTemplates(): Promise<EtherpadTemplate[]> {
		try {
			const defaultTemplates = JSON.parse(settings.get('Synq_Docs_Default_Templates') || '[]');
			
			// Templates prédéfinis
			const predefinedTemplates: EtherpadTemplate[] = [
				{
					id: 'meeting',
					name: 'Template de Réunion',
					description: 'Template pour les comptes-rendus de réunion',
					content: '# Réunion - {{date}}\n\n## Participants\n- \n\n## Ordre du jour\n1. \n2. \n3. \n\n## Points discutés\n\n\n## Décisions prises\n\n\n## Actions à suivre\n| Action | Responsable | Échéance |\n|--------|-------------|----------|\n|        |             |          |',
					category: 'meeting',
				},
				{
					id: 'notes',
					name: 'Template de Notes',
					description: 'Template pour prendre des notes',
					content: '# Notes - {{date}}\n\n## Sujet\n\n\n## Points clés\n- \n- \n- \n\n## Questions\n- \n- \n\n## Prochaines étapes\n- \n- ',
					category: 'notes',
				},
				{
					id: 'brainstorming',
					name: 'Template de Brainstorming',
					description: 'Template pour les sessions de brainstorming',
					content: '# Brainstorming - {{topic}}\n\n## Objectif\n\n\n## Contraintes\n- \n- \n\n## Idées\n\n### Idée 1\n- Description: \n- Avantages: \n- Inconvénients: \n\n### Idée 2\n- Description: \n- Avantages: \n- Inconvénients: \n\n## Évaluation\n| Idée | Score | Commentaires |\n|------|-------|-------------|\n|      |       |             |',
					category: 'brainstorming',
				},
			];

			return [...predefinedTemplates, ...defaultTemplates];
		} catch (error) {
			logger.error('Failed to get templates:', error);
			return [];
		}
	}

	public async getTemplate(templateId: string): Promise<EtherpadTemplate | null> {
		try {
			const templates = await this.getTemplates();
			return templates.find(t => t.id === templateId) || null;
		} catch (error) {
			logger.error(`Failed to get template ${templateId}:`, error);
			return null;
		}
	}

	private hasPermission(document: EtherpadDocument, userId: string, permission: 'read' | 'write' | 'admin'): boolean {
		return document.permissions[permission].includes(userId) || document.permissions.admin.includes(userId);
	}

	private async updateDocument(document: EtherpadDocument): Promise<void> {
		try {
			await Rooms.updateOne(
				{ _id: document.channelId },
				{
					$set: {
						[`docs.documents.${document._id}`]: document,
					},
				}
			);
		} catch (error) {
			logger.error(`Failed to update document ${document._id}:`, error);
		}
	}

	private async saveDocumentToDatabase(document: EtherpadDocument): Promise<void> {
		try {
			await Rooms.updateOne(
				{ _id: document.channelId },
				{
					$set: {
						[`docs.documents.${document._id}`]: document,
					},
				}
			);
		} catch (error) {
			logger.error(`Failed to save document ${document._id} to database:`, error);
		}
	}

	private async notifyChannelDocumentCreated(channel: any, user: any, document: EtherpadDocument): Promise<void> {
		try {
			await Messages.createWithTypeRoomIdMessageUserAndUnread(
				'document_created',
				channel._id,
				`${user.name || user.username} a créé le document collaboratif "${document.name}"`,
				user,
				false,
				{
					documentId: document._id,
					documentName: document.name,
					padId: document.padId,
				}
			);
		} catch (error) {
			logger.error('Failed to send document created notification:', error);
		}
	}

	public async getDocument(documentId: string): Promise<EtherpadDocument | null> {
		return this.documents.get(documentId) || null;
	}

	public async getChannelDocuments(channelId: string): Promise<EtherpadDocument[]> {
		return Array.from(this.documents.values()).filter(doc => doc.channelId === channelId);
	}

	public async getUserDocuments(userId: string): Promise<EtherpadDocument[]> {
		return Array.from(this.documents.values()).filter(doc => 
			doc.participants.includes(userId) || 
			doc.permissions.read.includes(userId) ||
			doc.permissions.write.includes(userId) ||
			doc.permissions.admin.includes(userId)
		);
	}
}

// Instance globale du service
let etherpadService: SynqEtherpadService | null = null;

Meteor.startup(async () => {
	try {
		etherpadService = new SynqEtherpadService();
	} catch (error) {
		logger.error('Failed to initialize Etherpad service:', error);
	}
});

// Méthodes Meteor pour l'interface utilisateur
Meteor.methods({
	async 'synq.etherpad.create-document'(channelId: string, documentName: string, templateId?: string): Promise<EtherpadDocument> {
		if (!etherpadService) {
			throw new Meteor.Error('etherpad-not-initialized', 'Etherpad service is not initialized');
		}
		return await etherpadService.createDocument(channelId, documentName, templateId);
	},

	async 'synq.etherpad.get-document-url'(documentId: string): Promise<string> {
		if (!etherpadService) {
			throw new Meteor.Error('etherpad-not-initialized', 'Etherpad service is not initialized');
		}
		return await etherpadService.getDocumentUrl(documentId, this.userId!);
	},

	async 'synq.etherpad.save-version'(documentId: string, description?: string): Promise<void> {
		if (!etherpadService) {
			throw new Meteor.Error('etherpad-not-initialized', 'Etherpad service is not initialized');
		}
		return await etherpadService.saveDocumentVersion(documentId, description);
	},

	async 'synq.etherpad.export-document'(documentId: string, format: 'html' | 'txt' | 'pdf' = 'html'): Promise<string> {
		if (!etherpadService) {
			throw new Meteor.Error('etherpad-not-initialized', 'Etherpad service is not initialized');
		}
		return await etherpadService.exportDocument(documentId, format);
	},

	async 'synq.etherpad.delete-document'(documentId: string): Promise<void> {
		if (!etherpadService) {
			throw new Meteor.Error('etherpad-not-initialized', 'Etherpad service is not initialized');
		}
		return await etherpadService.deleteDocument(documentId);
	},

	async 'synq.etherpad.get-templates'(): Promise<EtherpadTemplate[]> {
		if (!etherpadService) {
			throw new Meteor.Error('etherpad-not-initialized', 'Etherpad service is not initialized');
		}
		return await etherpadService.getTemplates();
	},

	async 'synq.etherpad.get-document'(documentId: string): Promise<EtherpadDocument | null> {
		if (!etherpadService) {
			throw new Meteor.Error('etherpad-not-initialized', 'Etherpad service is not initialized');
		}
		return await etherpadService.getDocument(documentId);
	},

	async 'synq.etherpad.get-channel-documents'(channelId: string): Promise<EtherpadDocument[]> {
		if (!etherpadService) {
			throw new Meteor.Error('etherpad-not-initialized', 'Etherpad service is not initialized');
		}
		return await etherpadService.getChannelDocuments(channelId);
	},

	async 'synq.etherpad.get-user-documents'(): Promise<EtherpadDocument[]> {
		if (!etherpadService) {
			throw new Meteor.Error('etherpad-not-initialized', 'Etherpad service is not initialized');
		}
		return await etherpadService.getUserDocuments(this.userId!);
	},
});

// API REST pour l'intégration externe
api.addRoute('synq/etherpad/documents', { authRequired: true }, {
	async get() {
		if (!etherpadService) {
			throw new Error('Etherpad service is not initialized');
		}
		const { channelId } = this.queryParams;
		if (channelId) {
			return await etherpadService.getChannelDocuments(channelId);
		}
		return await etherpadService.getUserDocuments(this.userId!);
	},

	async post() {
		if (!etherpadService) {
			throw new Error('Etherpad service is not initialized');
		}
		const { channelId, documentName, templateId } = this.bodyParams;
		return await etherpadService.createDocument(channelId, documentName, templateId);
	},
});

api.addRoute('synq/etherpad/documents/:documentId', { authRequired: true }, {
	async get() {
		if (!etherpadService) {
			throw new Error('Etherpad service is not initialized');
		}
		return await etherpadService.getDocument(this.urlParams.documentId);
	},

	async delete() {
		if (!etherpadService) {
			throw new Error('Etherpad service is not initialized');
		}
		return await etherpadService.deleteDocument(this.urlParams.documentId);
	},
});

api.addRoute('synq/etherpad/documents/:documentId/export', { authRequired: true }, {
	async get() {
		if (!etherpadService) {
			throw new Error('Etherpad service is not initialized');
		}
		const { format = 'html' } = this.queryParams;
		return await etherpadService.exportDocument(this.urlParams.documentId, format);
	},
});

api.addRoute('synq/etherpad/templates', { authRequired: true }, {
	async get() {
		if (!etherpadService) {
			throw new Error('Etherpad service is not initialized');
		}
		return await etherpadService.getTemplates();
	},
});

export { SynqEtherpadService };
