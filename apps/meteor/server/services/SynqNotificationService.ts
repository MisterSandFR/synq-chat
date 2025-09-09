import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Users } from '@rocket.chat/models';
import { Rooms } from '@rocket.chat/models';
import { Messages } from '@rocket.chat/models';
import { settings } from '@rocket.chat/settings';
import { Logger } from '@rocket.chat/logger';
import { api } from '@rocket.chat/core-services/api';
import { Random } from 'meteor/random';

const logger = new Logger('SynqNotifications');

// Collections pour les notifications
export const SynqNotifications = new Mongo.Collection('synq_notifications');
export const SynqNotificationSettings = new Mongo.Collection('synq_notification_settings');
export const SynqNotificationTemplates = new Mongo.Collection('synq_notification_templates');

interface NotificationTemplate {
	_id: string;
	name: string;
	type: 'message' | 'mention' | 'system' | 'workflow' | 'jitsi' | 'document' | 'analytics';
	subject: string;
	body: string;
	variables: string[];
	enabled: boolean;
	createdAt: Date;
	createdBy: string;
}

interface NotificationSettings {
	_id: string;
	userId: string;
	channels: {
		email: boolean;
		push: boolean;
		inApp: boolean;
		sms: boolean;
		webhook: boolean;
	};
	types: {
		message: boolean;
		mention: boolean;
		system: boolean;
		workflow: boolean;
		jitsi: boolean;
		document: boolean;
		analytics: boolean;
	};
	quietHours: {
		enabled: boolean;
		start: string; // HH:MM format
		end: string; // HH:MM format
		timezone: string;
	};
	webhookUrl?: string;
	emailAddress?: string;
	phoneNumber?: string;
}

interface Notification {
	_id: string;
	userId: string;
	type: 'message' | 'mention' | 'system' | 'workflow' | 'jitsi' | 'document' | 'analytics';
	title: string;
	message: string;
	data: {
		roomId?: string;
		messageId?: string;
		workflowId?: string;
		documentId?: string;
		jitsiRoomId?: string;
		url?: string;
		action?: string;
		metadata?: any;
	};
	channels: ('email' | 'push' | 'inApp' | 'sms' | 'webhook')[];
	status: 'pending' | 'sent' | 'delivered' | 'failed' | 'read';
	priority: 'low' | 'normal' | 'high' | 'urgent';
	createdAt: Date;
	sentAt?: Date;
	deliveredAt?: Date;
	readAt?: Date;
	expiresAt?: Date;
	retryCount: number;
	maxRetries: number;
	error?: string;
}

class SynqNotificationService {
	private processingQueue: Notification[] = [];
	private processingInterval: NodeJS.Timeout | null = null;
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor() {
		this.initializeService();
	}

	private async initializeService(): Promise<void> {
		try {
			await this.loadDefaultTemplates();
			await this.startNotificationProcessing();
			await this.startCleanupProcess();
			logger.info('Notification service initialized successfully');
		} catch (error) {
			logger.error('Failed to initialize Notification service:', error);
		}
	}

	private async loadDefaultTemplates(): Promise<void> {
		try {
			const defaultTemplates: NotificationTemplate[] = [
				{
					_id: 'message_notification',
					name: 'Message Notification',
					type: 'message',
					subject: 'Nouveau message de {{senderName}}',
					body: '{{senderName}} a envoyé un message dans {{channelName}}: {{messagePreview}}',
					variables: ['senderName', 'channelName', 'messagePreview'],
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'mention_notification',
					name: 'Mention Notification',
					type: 'mention',
					subject: 'Vous avez été mentionné par {{senderName}}',
					body: '{{senderName}} vous a mentionné dans {{channelName}}: {{messagePreview}}',
					variables: ['senderName', 'channelName', 'messagePreview'],
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'workflow_notification',
					name: 'Workflow Notification',
					type: 'workflow',
					subject: 'Workflow {{workflowName}} exécuté',
					body: 'Le workflow "{{workflowName}}" a été exécuté avec succès. {{workflowResult}}',
					variables: ['workflowName', 'workflowResult'],
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'jitsi_notification',
					name: 'Jitsi Notification',
					type: 'jitsi',
					subject: 'Salle vocale {{roomName}}',
					body: '{{senderName}} vous invite à rejoindre la salle vocale "{{roomName}}"',
					variables: ['senderName', 'roomName'],
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'document_notification',
					name: 'Document Notification',
					type: 'document',
					subject: 'Document {{documentName}} modifié',
					body: '{{senderName}} a modifié le document "{{documentName}}" dans {{channelName}}',
					variables: ['senderName', 'documentName', 'channelName'],
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
				{
					_id: 'analytics_notification',
					name: 'Analytics Notification',
					type: 'analytics',
					subject: 'Rapport Analytics {{reportName}}',
					body: 'Le rapport "{{reportName}}" est maintenant disponible. {{reportSummary}}',
					variables: ['reportName', 'reportSummary'],
					enabled: true,
					createdAt: new Date(),
					createdBy: 'system',
				},
			];

			for (const template of defaultTemplates) {
				await SynqNotificationTemplates.upsert(
					{ _id: template._id },
					{ $set: template }
				);
			}

			logger.info(`Loaded ${defaultTemplates.length} default notification templates`);
		} catch (error) {
			logger.error('Failed to load default templates:', error);
		}
	}

	private async startNotificationProcessing(): Promise<void> {
		// Traiter les notifications toutes les 30 secondes
		this.processingInterval = setInterval(async () => {
			try {
				await this.processNotificationQueue();
			} catch (error) {
				logger.error('Notification processing failed:', error);
			}
		}, 30 * 1000);

		logger.info('Started notification processing');
	}

	private async startCleanupProcess(): Promise<void> {
		// Nettoyer les anciennes notifications toutes les heures
		this.cleanupInterval = setInterval(async () => {
			try {
				await this.cleanupOldNotifications();
			} catch (error) {
				logger.error('Notification cleanup failed:', error);
			}
		}, 60 * 60 * 1000);

		logger.info('Started notification cleanup process');
	}

	private async processNotificationQueue(): Promise<void> {
		try {
			const pendingNotifications = await SynqNotifications.find({
				status: 'pending',
				$or: [
					{ expiresAt: { $exists: false } },
					{ expiresAt: { $gt: new Date() } },
				],
			}).fetch();

			for (const notification of pendingNotifications) {
				try {
					await this.sendNotification(notification);
				} catch (error) {
					logger.error(`Failed to send notification ${notification._id}:`, error);
					await this.handleNotificationError(notification, error);
				}
			}
		} catch (error) {
			logger.error('Failed to process notification queue:', error);
		}
	}

	private async sendNotification(notification: Notification): Promise<void> {
		try {
			const userSettings = await this.getUserNotificationSettings(notification.userId);
			if (!userSettings) {
				logger.warn(`No notification settings found for user ${notification.userId}`);
				return;
			}

			// Vérifier les heures silencieuses
			if (this.isQuietHours(userSettings)) {
				logger.info(`Notification ${notification._id} skipped due to quiet hours`);
				return;
			}

			// Vérifier si le type de notification est activé
			if (!userSettings.types[notification.type]) {
				logger.info(`Notification ${notification._id} skipped - type ${notification.type} disabled`);
				return;
			}

			// Envoyer via les canaux activés
			const promises: Promise<any>[] = [];

			if (userSettings.channels.email && notification.channels.includes('email')) {
				promises.push(this.sendEmailNotification(notification, userSettings));
			}

			if (userSettings.channels.push && notification.channels.includes('push')) {
				promises.push(this.sendPushNotification(notification, userSettings));
			}

			if (userSettings.channels.inApp && notification.channels.includes('inApp')) {
				promises.push(this.sendInAppNotification(notification, userSettings));
			}

			if (userSettings.channels.sms && notification.channels.includes('sms')) {
				promises.push(this.sendSmsNotification(notification, userSettings));
			}

			if (userSettings.channels.webhook && notification.channels.includes('webhook')) {
				promises.push(this.sendWebhookNotification(notification, userSettings));
			}

			// Attendre que tous les envois soient terminés
			await Promise.allSettled(promises);

			// Marquer comme envoyé
			await SynqNotifications.updateOne(
				{ _id: notification._id },
				{
					$set: {
						status: 'sent',
						sentAt: new Date(),
					},
				}
			);

			logger.info(`Notification ${notification._id} sent successfully`);
		} catch (error) {
			logger.error(`Failed to send notification ${notification._id}:`, error);
			throw error;
		}
	}

	private async sendEmailNotification(notification: Notification, settings: NotificationSettings): Promise<void> {
		try {
			if (!settings.emailAddress) {
				throw new Error('No email address configured');
			}

			// Utiliser le service d'email de Rocket.Chat ou un service externe
			logger.info(`Sending email notification to ${settings.emailAddress}: ${notification.title}`);
			
			// Implémentation de l'envoi d'email
			// Dans un environnement de production, utiliser un service comme SendGrid, Mailgun, etc.
			
		} catch (error) {
			logger.error('Failed to send email notification:', error);
			throw error;
		}
	}

	private async sendPushNotification(notification: Notification, settings: NotificationSettings): Promise<void> {
		try {
			// Envoyer une notification push via FCM, APNS, etc.
			logger.info(`Sending push notification to user ${notification.userId}: ${notification.title}`);
			
			// Implémentation de l'envoi de push notification
			// Dans un environnement de production, utiliser FCM ou APNS
			
		} catch (error) {
			logger.error('Failed to send push notification:', error);
			throw error;
		}
	}

	private async sendInAppNotification(notification: Notification, settings: NotificationSettings): Promise<void> {
		try {
			// Envoyer une notification in-app via WebSocket
			logger.info(`Sending in-app notification to user ${notification.userId}: ${notification.title}`);
			
			// Utiliser Meteor's DDP pour envoyer la notification en temps réel
			Meteor.users.update(
				{ _id: notification.userId },
				{
					$push: {
						'notifications': {
							_id: notification._id,
							title: notification.title,
							message: notification.message,
							data: notification.data,
							createdAt: notification.createdAt,
							read: false,
						},
					},
				}
			);

			// Publier via DDP
			Meteor.publish('userNotifications', function() {
				return SynqNotifications.find({
					userId: this.userId,
					status: 'sent',
				}, {
					sort: { createdAt: -1 },
					limit: 50,
				});
			});

		} catch (error) {
			logger.error('Failed to send in-app notification:', error);
			throw error;
		}
	}

	private async sendSmsNotification(notification: Notification, settings: NotificationSettings): Promise<void> {
		try {
			if (!settings.phoneNumber) {
				throw new Error('No phone number configured');
			}

			// Envoyer un SMS via un service comme Twilio, AWS SNS, etc.
			logger.info(`Sending SMS notification to ${settings.phoneNumber}: ${notification.title}`);
			
			// Implémentation de l'envoi de SMS
			// Dans un environnement de production, utiliser Twilio ou AWS SNS
			
		} catch (error) {
			logger.error('Failed to send SMS notification:', error);
			throw error;
		}
	}

	private async sendWebhookNotification(notification: Notification, settings: NotificationSettings): Promise<void> {
		try {
			if (!settings.webhookUrl) {
				throw new Error('No webhook URL configured');
			}

			// Envoyer une notification webhook
			const HTTP = require('meteor/http').HTTP;
			await HTTP.post(settings.webhookUrl, {
				data: {
					notification,
					timestamp: new Date().toISOString(),
				},
			});

			logger.info(`Sent webhook notification to ${settings.webhookUrl}`);
		} catch (error) {
			logger.error('Failed to send webhook notification:', error);
			throw error;
		}
	}

	private async handleNotificationError(notification: Notification, error: any): Promise<void> {
		try {
			const retryCount = notification.retryCount + 1;
			const maxRetries = notification.maxRetries || 3;

			if (retryCount < maxRetries) {
				// Réessayer plus tard
				await SynqNotifications.updateOne(
					{ _id: notification._id },
					{
						$set: {
							retryCount,
							error: error.message,
						},
					}
				);

				logger.info(`Notification ${notification._id} will be retried (attempt ${retryCount}/${maxRetries})`);
			} else {
				// Marquer comme échoué
				await SynqNotifications.updateOne(
					{ _id: notification._id },
					{
						$set: {
							status: 'failed',
							error: error.message,
						},
					}
				);

				logger.error(`Notification ${notification._id} failed after ${maxRetries} attempts`);
			}
		} catch (updateError) {
			logger.error(`Failed to handle notification error for ${notification._id}:`, updateError);
		}
	}

	private isQuietHours(settings: NotificationSettings): boolean {
		if (!settings.quietHours.enabled) {
			return false;
		}

		const now = new Date();
		const currentTime = now.toLocaleTimeString('en-US', {
			hour12: false,
			timeZone: settings.quietHours.timezone,
		});

		const startTime = settings.quietHours.start;
		const endTime = settings.quietHours.end;

		// Logique simple pour les heures silencieuses
		// Dans un environnement de production, utiliser une bibliothèque de gestion du temps
		return currentTime >= startTime && currentTime <= endTime;
	}

	private async getUserNotificationSettings(userId: string): Promise<NotificationSettings | null> {
		try {
			let settings = await SynqNotificationSettings.findOne({ userId });
			
			if (!settings) {
				// Créer des paramètres par défaut
				settings = {
					_id: Random.id(),
					userId,
					channels: {
						email: true,
						push: true,
						inApp: true,
						sms: false,
						webhook: false,
					},
					types: {
						message: true,
						mention: true,
						system: true,
						workflow: true,
						jitsi: true,
						document: true,
						analytics: false,
					},
					quietHours: {
						enabled: false,
						start: '22:00',
						end: '08:00',
						timezone: 'Europe/Paris',
					},
				};

				await SynqNotificationSettings.insert(settings);
			}

			return settings;
		} catch (error) {
			logger.error(`Failed to get notification settings for user ${userId}:`, error);
			return null;
		}
	}

	public async createNotification(
		userId: string,
		type: Notification['type'],
		title: string,
		message: string,
		data: Notification['data'] = {},
		channels: Notification['channels'] = ['inApp'],
		priority: Notification['priority'] = 'normal',
		expiresIn?: number // en heures
	): Promise<Notification> {
		try {
			const notification: Notification = {
				_id: Random.id(),
				userId,
				type,
				title,
				message,
				data,
				channels,
				status: 'pending',
				priority,
				createdAt: new Date(),
				retryCount: 0,
				maxRetries: 3,
			};

			if (expiresIn) {
				notification.expiresAt = new Date(Date.now() + expiresIn * 60 * 60 * 1000);
			}

			await SynqNotifications.insert(notification);
			logger.info(`Created notification ${notification._id} for user ${userId}`);

			return notification;
		} catch (error) {
			logger.error('Failed to create notification:', error);
			throw error;
		}
	}

	public async createNotificationFromTemplate(
		userId: string,
		templateId: string,
		variables: Record<string, any>,
		channels: Notification['channels'] = ['inApp'],
		priority: Notification['priority'] = 'normal'
	): Promise<Notification> {
		try {
			const template = await SynqNotificationTemplates.findOne(templateId);
			if (!template) {
				throw new Error('Template not found');
			}

			// Remplacer les variables dans le template
			const title = this.processTemplate(template.subject, variables);
			const message = this.processTemplate(template.body, variables);

			return await this.createNotification(
				userId,
				template.type,
				title,
				message,
				{ metadata: variables },
				channels,
				priority
			);
		} catch (error) {
			logger.error('Failed to create notification from template:', error);
			throw error;
		}
	}

	private processTemplate(template: string, variables: Record<string, any>): string {
		return template.replace(/\{\{([^}]+)\}\}/g, (match, variable) => {
			const trimmed = variable.trim();
			return variables[trimmed] || match;
		});
	}

	public async markNotificationAsRead(notificationId: string, userId: string): Promise<void> {
		try {
			await SynqNotifications.updateOne(
				{ _id: notificationId, userId },
				{
					$set: {
						status: 'read',
						readAt: new Date(),
					},
				}
			);

			logger.info(`Marked notification ${notificationId} as read for user ${userId}`);
		} catch (error) {
			logger.error(`Failed to mark notification ${notificationId} as read:`, error);
			throw error;
		}
	}

	public async getUserNotifications(userId: string, limit: number = 50): Promise<Notification[]> {
		try {
			return await SynqNotifications.find(
				{ userId },
				{
					sort: { createdAt: -1 },
					limit,
				}
			).fetch();
		} catch (error) {
			logger.error(`Failed to get notifications for user ${userId}:`, error);
			return [];
		}
	}

	public async updateNotificationSettings(userId: string, settings: Partial<NotificationSettings>): Promise<void> {
		try {
			await SynqNotificationSettings.updateOne(
				{ userId },
				{ $set: settings },
				{ upsert: true }
			);

			logger.info(`Updated notification settings for user ${userId}`);
		} catch (error) {
			logger.error(`Failed to update notification settings for user ${userId}:`, error);
			throw error;
		}
	}

	private async cleanupOldNotifications(): Promise<void> {
		try {
			const cutoffDate = new Date();
			cutoffDate.setDate(cutoffDate.getDate() - 30); // Garder 30 jours

			const deletedCount = await SynqNotifications.remove({
				createdAt: { $lt: cutoffDate },
				status: { $in: ['read', 'failed'] },
			});

			logger.info(`Cleaned up ${deletedCount} old notifications`);
		} catch (error) {
			logger.error('Failed to cleanup old notifications:', error);
		}
	}

	public async stopService(): Promise<void> {
		if (this.processingInterval) {
			clearInterval(this.processingInterval);
			this.processingInterval = null;
		}

		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		logger.info('Notification service stopped');
	}
}

// Instance globale du service
let notificationService: SynqNotificationService | null = null;

Meteor.startup(async () => {
	try {
		notificationService = new SynqNotificationService();
	} catch (error) {
		logger.error('Failed to initialize Notification service:', error);
	}
});

// Méthodes Meteor pour l'interface utilisateur
Meteor.methods({
	async 'synq.notifications.create'(userId: string, type: string, title: string, message: string, data: any = {}, channels: string[] = ['inApp'], priority: string = 'normal'): Promise<Notification> {
		if (!notificationService) {
			throw new Meteor.Error('notification-not-initialized', 'Notification service is not initialized');
		}
		return await notificationService.createNotification(userId, type as any, title, message, data, channels as any, priority as any);
	},

	async 'synq.notifications.create-from-template'(userId: string, templateId: string, variables: Record<string, any>, channels: string[] = ['inApp'], priority: string = 'normal'): Promise<Notification> {
		if (!notificationService) {
			throw new Meteor.Error('notification-not-initialized', 'Notification service is not initialized');
		}
		return await notificationService.createNotificationFromTemplate(userId, templateId, variables, channels as any, priority as any);
	},

	async 'synq.notifications.mark-read'(notificationId: string): Promise<void> {
		if (!notificationService) {
			throw new Meteor.Error('notification-not-initialized', 'Notification service is not initialized');
		}
		return await notificationService.markNotificationAsRead(notificationId, this.userId!);
	},

	async 'synq.notifications.get-user-notifications'(limit: number = 50): Promise<Notification[]> {
		if (!notificationService) {
			throw new Meteor.Error('notification-not-initialized', 'Notification service is not initialized');
		}
		return await notificationService.getUserNotifications(this.userId!, limit);
	},

	async 'synq.notifications.update-settings'(settings: Partial<NotificationSettings>): Promise<void> {
		if (!notificationService) {
			throw new Meteor.Error('notification-not-initialized', 'Notification service is not initialized');
		}
		return await notificationService.updateNotificationSettings(this.userId!, settings);
	},

	async 'synq.notifications.get-settings'(): Promise<NotificationSettings | null> {
		if (!notificationService) {
			throw new Meteor.Error('notification-not-initialized', 'Notification service is not initialized');
		}
		return await notificationService.getUserNotificationSettings(this.userId!);
	},
});

// Publication pour les notifications en temps réel
Meteor.publish('synq.userNotifications', function() {
	if (!this.userId) {
		return this.ready();
	}

	return SynqNotifications.find({
		userId: this.userId,
		status: { $in: ['sent', 'delivered'] },
	}, {
		sort: { createdAt: -1 },
		limit: 50,
	});
});

// API REST pour l'intégration externe
api.addRoute('synq/notifications', { authRequired: true }, {
	async get() {
		if (!notificationService) {
			throw new Error('Notification service is not initialized');
		}
		const { limit = 50 } = this.queryParams;
		return await notificationService.getUserNotifications(this.userId!, limit);
	},

	async post() {
		if (!notificationService) {
			throw new Error('Notification service is not initialized');
		}
		const { userId, type, title, message, data, channels, priority } = this.bodyParams;
		return await notificationService.createNotification(userId, type, title, message, data, channels, priority);
	},
});

api.addRoute('synq/notifications/:notificationId/read', { authRequired: true }, {
	async post() {
		if (!notificationService) {
			throw new Error('Notification service is not initialized');
		}
		return await notificationService.markNotificationAsRead(this.urlParams.notificationId, this.userId!);
	},
});

api.addRoute('synq/notifications/settings', { authRequired: true }, {
	async get() {
		if (!notificationService) {
			throw new Error('Notification service is not initialized');
		}
		return await notificationService.getUserNotificationSettings(this.userId!);
	},

	async post() {
		if (!notificationService) {
			throw new Error('Notification service is not initialized');
		}
		return await notificationService.updateNotificationSettings(this.userId!, this.bodyParams);
	},
});

export { SynqNotificationService };
