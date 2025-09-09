import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Messages } from '@rocket.chat/models';
import { Users } from '@rocket.chat/models';
import { Rooms } from '@rocket.chat/models';
import { settings } from '@rocket.chat/settings';
import { Logger } from '@rocket.chat/logger';
import { api } from '@rocket.chat/core-services/api';

const logger = new Logger('SynqAnalytics');

// Collections pour les analytics
export const SynqAnalyticsData = new Mongo.Collection('synq_analytics_data');
export const SynqAnalyticsReports = new Mongo.Collection('synq_analytics_reports');
export const SynqAnalyticsMetrics = new Mongo.Collection('synq_analytics_metrics');

interface AnalyticsDataPoint {
	_id: string;
	timestamp: Date;
	metric: string;
	value: number;
	metadata: {
		userId?: string;
		roomId?: string;
		channelType?: string;
		messageType?: string;
		userAgent?: string;
		ipAddress?: string;
	};
}

interface AnalyticsReport {
	_id: string;
	name: string;
	type: 'daily' | 'weekly' | 'monthly' | 'custom';
	period: {
		start: Date;
		end: Date;
	};
	metrics: {
		messagesPerDay: number[];
		activeUsers: number;
		topChannels: Array<{ channelId: string; name: string; messageCount: number }>;
		topUsers: Array<{ userId: string; username: string; messageCount: number }>;
		peakHours: Array<{ hour: number; messageCount: number }>;
		peakDays: Array<{ day: number; messageCount: number }>;
		messageTypes: Array<{ type: string; count: number }>;
		responseTime: number;
	};
	generatedAt: Date;
	generatedBy: string;
}

interface AnalyticsMetric {
	_id: string;
	name: string;
	description: string;
	category: 'activity' | 'user_behavior' | 'performance' | 'engagement';
	enabled: boolean;
	collectionInterval: number; // en minutes
	lastCollected: Date;
	aggregationMethod: 'sum' | 'avg' | 'count' | 'max' | 'min';
}

class SynqAnalyticsService {
	private collectionInterval: NodeJS.Timeout | null = null;
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor() {
		this.initializeService();
	}

	private async initializeService(): Promise<void> {
		try {
			const isEnabled = settings.get('Synq_Analytics_Enabled');
			if (!isEnabled) {
				logger.info('Analytics service is disabled');
				return;
			}

			await this.initializeMetrics();
			await this.startDataCollection();
			await this.startDataCleanup();
			logger.info('Analytics service initialized successfully');
		} catch (error) {
			logger.error('Failed to initialize Analytics service:', error);
		}
	}

	private async initializeMetrics(): Promise<void> {
		try {
			const defaultMetrics: AnalyticsMetric[] = [
				{
					_id: 'messages_per_day',
					name: 'Messages per Day',
					description: 'Number of messages sent per day',
					category: 'activity',
					enabled: settings.get('Synq_Analytics_Messages_Per_Day') || true,
					collectionInterval: 60, // 1 hour
					lastCollected: new Date(),
					aggregationMethod: 'count',
				},
				{
					_id: 'active_users',
					name: 'Active Users',
					description: 'Number of active users',
					category: 'activity',
					enabled: settings.get('Synq_Analytics_Active_Users') || true,
					collectionInterval: 60,
					lastCollected: new Date(),
					aggregationMethod: 'count',
				},
				{
					_id: 'top_channels',
					name: 'Top Channels',
					description: 'Most active channels',
					category: 'activity',
					enabled: settings.get('Synq_Analytics_Top_Channels') || true,
					collectionInterval: 60,
					lastCollected: new Date(),
					aggregationMethod: 'count',
				},
				{
					_id: 'response_time',
					name: 'Response Time',
					description: 'Average response time',
					category: 'performance',
					enabled: settings.get('Synq_Analytics_Response_Time') || true,
					collectionInterval: 60,
					lastCollected: new Date(),
					aggregationMethod: 'avg',
				},
				{
					_id: 'peak_hours',
					name: 'Peak Hours',
					description: 'Most active hours of the day',
					category: 'user_behavior',
					enabled: settings.get('Synq_Analytics_Peak_Hours') || true,
					collectionInterval: 60,
					lastCollected: new Date(),
					aggregationMethod: 'count',
				},
				{
					_id: 'peak_days',
					name: 'Peak Days',
					description: 'Most active days of the week',
					category: 'user_behavior',
					enabled: settings.get('Synq_Analytics_Peak_Days') || true,
					collectionInterval: 60,
					lastCollected: new Date(),
					aggregationMethod: 'count',
				},
				{
					_id: 'top_users',
					name: 'Top Users',
					description: 'Most active users',
					category: 'user_behavior',
					enabled: settings.get('Synq_Analytics_Top_Users') || true,
					collectionInterval: 60,
					lastCollected: new Date(),
					aggregationMethod: 'count',
				},
				{
					_id: 'message_types',
					name: 'Message Types',
					description: 'Distribution of message types',
					category: 'engagement',
					enabled: settings.get('Synq_Analytics_Message_Types') || true,
					collectionInterval: 60,
					lastCollected: new Date(),
					aggregationMethod: 'count',
				},
			];

			for (const metric of defaultMetrics) {
				await SynqAnalyticsMetrics.upsert(
					{ _id: metric._id },
					{ $set: metric }
				);
			}

			logger.info(`Initialized ${defaultMetrics.length} analytics metrics`);
		} catch (error) {
			logger.error('Failed to initialize metrics:', error);
		}
	}

	private async startDataCollection(): Promise<void> {
		const interval = settings.get('Synq_Analytics_Collection_Interval') || 5;
		
		this.collectionInterval = setInterval(async () => {
			try {
				await this.collectMetrics();
			} catch (error) {
				logger.error('Data collection failed:', error);
			}
		}, interval * 60 * 1000);

		logger.info(`Started data collection with ${interval} minute interval`);
	}

	private async startDataCleanup(): Promise<void> {
		// Nettoyer les données anciennes toutes les 24 heures
		this.cleanupInterval = setInterval(async () => {
			try {
				await this.cleanupOldData();
			} catch (error) {
				logger.error('Data cleanup failed:', error);
			}
		}, 24 * 60 * 60 * 1000);

		logger.info('Started data cleanup process');
	}

	private async collectMetrics(): Promise<void> {
		try {
			const metrics = await SynqAnalyticsMetrics.find({ enabled: true }).fetch();
			const now = new Date();

			for (const metric of metrics) {
				// Vérifier si le métrique doit être collecté
				const timeSinceLastCollection = now.getTime() - metric.lastCollected.getTime();
				if (timeSinceLastCollection < metric.collectionInterval * 60 * 1000) {
					continue;
				}

				await this.collectMetric(metric);
				
				// Mettre à jour le timestamp de dernière collecte
				await SynqAnalyticsMetrics.updateOne(
					{ _id: metric._id },
					{ $set: { lastCollected: now } }
				);
			}
		} catch (error) {
			logger.error('Failed to collect metrics:', error);
		}
	}

	private async collectMetric(metric: AnalyticsMetric): Promise<void> {
		try {
			let dataPoints: AnalyticsDataPoint[] = [];

			switch (metric._id) {
				case 'messages_per_day':
					dataPoints = await this.collectMessagesPerDay();
					break;
				case 'active_users':
					dataPoints = await this.collectActiveUsers();
					break;
				case 'top_channels':
					dataPoints = await this.collectTopChannels();
					break;
				case 'response_time':
					dataPoints = await this.collectResponseTime();
					break;
				case 'peak_hours':
					dataPoints = await this.collectPeakHours();
					break;
				case 'peak_days':
					dataPoints = await this.collectPeakDays();
					break;
				case 'top_users':
					dataPoints = await this.collectTopUsers();
					break;
				case 'message_types':
					dataPoints = await this.collectMessageTypes();
					break;
			}

			// Insérer les points de données
			if (dataPoints.length > 0) {
				await SynqAnalyticsData.insertMany(dataPoints);
				logger.info(`Collected ${dataPoints.length} data points for metric: ${metric.name}`);
			}
		} catch (error) {
			logger.error(`Failed to collect metric ${metric._id}:`, error);
		}
	}

	private async collectMessagesPerDay(): Promise<AnalyticsDataPoint[]> {
		try {
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			const messageCount = await Messages.countDocuments({
				ts: { $gte: today, $lt: tomorrow },
			});

			return [{
				_id: `messages_per_day_${today.getTime()}`,
				timestamp: today,
				metric: 'messages_per_day',
				value: messageCount,
				metadata: {},
			}];
		} catch (error) {
			logger.error('Failed to collect messages per day:', error);
			return [];
		}
	}

	private async collectActiveUsers(): Promise<AnalyticsDataPoint[]> {
		try {
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			const activeUsers = await Messages.distinct('u._id', {
				ts: { $gte: today, $lt: tomorrow },
			});

			return [{
				_id: `active_users_${today.getTime()}`,
				timestamp: today,
				metric: 'active_users',
				value: activeUsers.length,
				metadata: {},
			}];
		} catch (error) {
			logger.error('Failed to collect active users:', error);
			return [];
		}
	}

	private async collectTopChannels(): Promise<AnalyticsDataPoint[]> {
		try {
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			const channelStats = await Messages.aggregate([
				{
					$match: {
						ts: { $gte: today, $lt: tomorrow },
						rid: { $exists: true },
					},
				},
				{
					$group: {
						_id: '$rid',
						messageCount: { $sum: 1 },
					},
				},
				{
					$sort: { messageCount: -1 },
				},
				{
					$limit: 10,
				},
			]).toArray();

			const dataPoints: AnalyticsDataPoint[] = [];
			for (const stat of channelStats) {
				dataPoints.push({
					_id: `top_channels_${stat._id}_${today.getTime()}`,
					timestamp: today,
					metric: 'top_channels',
					value: stat.messageCount,
					metadata: {
						roomId: stat._id,
					},
				});
			}

			return dataPoints;
		} catch (error) {
			logger.error('Failed to collect top channels:', error);
			return [];
		}
	}

	private async collectResponseTime(): Promise<AnalyticsDataPoint[]> {
		try {
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			// Calculer le temps de réponse moyen basé sur les réponses aux messages
			const responseTime = await Messages.aggregate([
				{
					$match: {
						ts: { $gte: today, $lt: tomorrow },
						'msg': { $regex: /^@/ }, // Messages de réponse
					},
				},
				{
					$group: {
						_id: null,
						avgResponseTime: { $avg: '$ts' },
					},
				},
			]).toArray();

			const avgTime = responseTime.length > 0 ? responseTime[0].avgResponseTime : 0;

			return [{
				_id: `response_time_${today.getTime()}`,
				timestamp: today,
				metric: 'response_time',
				value: avgTime,
				metadata: {},
			}];
		} catch (error) {
			logger.error('Failed to collect response time:', error);
			return [];
		}
	}

	private async collectPeakHours(): Promise<AnalyticsDataPoint[]> {
		try {
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			const hourStats = await Messages.aggregate([
				{
					$match: {
						ts: { $gte: today, $lt: tomorrow },
					},
				},
				{
					$group: {
						_id: { $hour: '$ts' },
						messageCount: { $sum: 1 },
					},
				},
				{
					$sort: { messageCount: -1 },
				},
			]).toArray();

			const dataPoints: AnalyticsDataPoint[] = [];
			for (const stat of hourStats) {
				dataPoints.push({
					_id: `peak_hours_${stat._id}_${today.getTime()}`,
					timestamp: today,
					metric: 'peak_hours',
					value: stat.messageCount,
					metadata: {
						hour: stat._id,
					},
				});
			}

			return dataPoints;
		} catch (error) {
			logger.error('Failed to collect peak hours:', error);
			return [];
		}
	}

	private async collectPeakDays(): Promise<AnalyticsDataPoint[]> {
		try {
			const weekAgo = new Date();
			weekAgo.setDate(weekAgo.getDate() - 7);
			weekAgo.setHours(0, 0, 0, 0);

			const dayStats = await Messages.aggregate([
				{
					$match: {
						ts: { $gte: weekAgo },
					},
				},
				{
					$group: {
						_id: { $dayOfWeek: '$ts' },
						messageCount: { $sum: 1 },
					},
				},
				{
					$sort: { messageCount: -1 },
				},
			]).toArray();

			const dataPoints: AnalyticsDataPoint[] = [];
			for (const stat of dayStats) {
				dataPoints.push({
					_id: `peak_days_${stat._id}_${weekAgo.getTime()}`,
					timestamp: weekAgo,
					metric: 'peak_days',
					value: stat.messageCount,
					metadata: {
						day: stat._id,
					},
				});
			}

			return dataPoints;
		} catch (error) {
			logger.error('Failed to collect peak days:', error);
			return [];
		}
	}

	private async collectTopUsers(): Promise<AnalyticsDataPoint[]> {
		try {
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			const userStats = await Messages.aggregate([
				{
					$match: {
						ts: { $gte: today, $lt: tomorrow },
						'u._id': { $exists: true },
					},
				},
				{
					$group: {
						_id: '$u._id',
						messageCount: { $sum: 1 },
					},
				},
				{
					$sort: { messageCount: -1 },
				},
				{
					$limit: 10,
				},
			]).toArray();

			const dataPoints: AnalyticsDataPoint[] = [];
			for (const stat of userStats) {
				dataPoints.push({
					_id: `top_users_${stat._id}_${today.getTime()}`,
					timestamp: today,
					metric: 'top_users',
					value: stat.messageCount,
					metadata: {
						userId: stat._id,
					},
				});
			}

			return dataPoints;
		} catch (error) {
			logger.error('Failed to collect top users:', error);
			return [];
		}
	}

	private async collectMessageTypes(): Promise<AnalyticsDataPoint[]> {
		try {
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const tomorrow = new Date(today);
			tomorrow.setDate(tomorrow.getDate() + 1);

			const typeStats = await Messages.aggregate([
				{
					$match: {
						ts: { $gte: today, $lt: tomorrow },
					},
				},
				{
					$group: {
						_id: '$t',
						messageCount: { $sum: 1 },
					},
				},
				{
					$sort: { messageCount: -1 },
				},
			]).toArray();

			const dataPoints: AnalyticsDataPoint[] = [];
			for (const stat of typeStats) {
				dataPoints.push({
					_id: `message_types_${stat._id || 'text'}_${today.getTime()}`,
					timestamp: today,
					metric: 'message_types',
					value: stat.messageCount,
					metadata: {
						messageType: stat._id || 'text',
					},
				});
			}

			return dataPoints;
		} catch (error) {
			logger.error('Failed to collect message types:', error);
			return [];
		}
	}

	private async cleanupOldData(): Promise<void> {
		try {
			const retentionDays = settings.get('Synq_Analytics_Data_Retention') || 90;
			const cutoffDate = new Date();
			cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

			// Supprimer les anciennes données
			const deletedData = await SynqAnalyticsData.remove({
				timestamp: { $lt: cutoffDate },
			});

			// Supprimer les anciens rapports
			const deletedReports = await SynqAnalyticsReports.remove({
				generatedAt: { $lt: cutoffDate },
			});

			logger.info(`Cleaned up ${deletedData} data points and ${deletedReports} reports older than ${retentionDays} days`);
		} catch (error) {
			logger.error('Failed to cleanup old data:', error);
		}
	}

	public async generateReport(
		name: string,
		type: 'daily' | 'weekly' | 'monthly' | 'custom',
		startDate: Date,
		endDate: Date
	): Promise<AnalyticsReport> {
		try {
			const reportId = `report_${Date.now()}`;
			
			// Collecter les métriques pour la période
			const metrics = await this.aggregateMetricsForPeriod(startDate, endDate);

			const report: AnalyticsReport = {
				_id: reportId,
				name,
				type,
				period: { start: startDate, end: endDate },
				metrics,
				generatedAt: new Date(),
				generatedBy: this.userId!,
			};

			await SynqAnalyticsReports.insert(report);
			logger.info(`Generated report: ${name} for period ${startDate.toISOString()} to ${endDate.toISOString()}`);

			return report;
		} catch (error) {
			logger.error('Failed to generate report:', error);
			throw error;
		}
	}

	private async aggregateMetricsForPeriod(startDate: Date, endDate: Date): Promise<any> {
		try {
			const data = await SynqAnalyticsData.find({
				timestamp: { $gte: startDate, $lte: endDate },
			}).fetch();

			// Agréger les données par métrique
			const aggregated: any = {
				messagesPerDay: [],
				activeUsers: 0,
				topChannels: [],
				topUsers: [],
				peakHours: [],
				peakDays: [],
				messageTypes: [],
				responseTime: 0,
			};

			// Traiter chaque métrique
			for (const dataPoint of data) {
				switch (dataPoint.metric) {
					case 'messages_per_day':
						aggregated.messagesPerDay.push(dataPoint.value);
						break;
					case 'active_users':
						aggregated.activeUsers = Math.max(aggregated.activeUsers, dataPoint.value);
						break;
					case 'top_channels':
						// Agréger par channel
						break;
					case 'top_users':
						// Agréger par utilisateur
						break;
					case 'peak_hours':
						// Agréger par heure
						break;
					case 'peak_days':
						// Agréger par jour
						break;
					case 'message_types':
						// Agréger par type
						break;
					case 'response_time':
						aggregated.responseTime = dataPoint.value;
						break;
				}
			}

			return aggregated;
		} catch (error) {
			logger.error('Failed to aggregate metrics:', error);
			return {};
		}
	}

	public async getDashboardData(period: 'day' | 'week' | 'month' = 'day'): Promise<any> {
		try {
			const endDate = new Date();
			const startDate = new Date();

			switch (period) {
				case 'day':
					startDate.setDate(startDate.getDate() - 1);
					break;
				case 'week':
					startDate.setDate(startDate.getDate() - 7);
					break;
				case 'month':
					startDate.setMonth(startDate.getMonth() - 1);
					break;
			}

			return await this.aggregateMetricsForPeriod(startDate, endDate);
		} catch (error) {
			logger.error('Failed to get dashboard data:', error);
			throw error;
		}
	}

	public async exportData(format: 'json' | 'csv' | 'xlsx', startDate: Date, endDate: Date): Promise<string> {
		try {
			const data = await SynqAnalyticsData.find({
				timestamp: { $gte: startDate, $lte: endDate },
			}).fetch();

			switch (format) {
				case 'json':
					return JSON.stringify(data, null, 2);
				case 'csv':
					return this.convertToCSV(data);
				case 'xlsx':
					// Implémentation pour Excel serait nécessaire
					throw new Error('XLSX export not implemented');
				default:
					throw new Error(`Unsupported format: ${format}`);
			}
		} catch (error) {
			logger.error('Failed to export data:', error);
			throw error;
		}
	}

	private convertToCSV(data: AnalyticsDataPoint[]): string {
		const headers = ['timestamp', 'metric', 'value', 'metadata'];
		const rows = data.map(point => [
			point.timestamp.toISOString(),
			point.metric,
			point.value.toString(),
			JSON.stringify(point.metadata),
		]);

		return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
	}

	public async stopService(): Promise<void> {
		if (this.collectionInterval) {
			clearInterval(this.collectionInterval);
			this.collectionInterval = null;
		}

		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		logger.info('Analytics service stopped');
	}
}

// Instance globale du service
let analyticsService: SynqAnalyticsService | null = null;

Meteor.startup(async () => {
	try {
		analyticsService = new SynqAnalyticsService();
	} catch (error) {
		logger.error('Failed to initialize Analytics service:', error);
	}
});

// Méthodes Meteor pour l'interface utilisateur
Meteor.methods({
	async 'synq.analytics.get-dashboard-data'(period: 'day' | 'week' | 'month' = 'day'): Promise<any> {
		if (!analyticsService) {
			throw new Meteor.Error('analytics-not-initialized', 'Analytics service is not initialized');
		}
		return await analyticsService.getDashboardData(period);
	},

	async 'synq.analytics.generate-report'(name: string, type: 'daily' | 'weekly' | 'monthly' | 'custom', startDate: Date, endDate: Date): Promise<AnalyticsReport> {
		if (!analyticsService) {
			throw new Meteor.Error('analytics-not-initialized', 'Analytics service is not initialized');
		}
		return await analyticsService.generateReport(name, type, startDate, endDate);
	},

	async 'synq.analytics.export-data'(format: 'json' | 'csv' | 'xlsx', startDate: Date, endDate: Date): Promise<string> {
		if (!analyticsService) {
			throw new Meteor.Error('analytics-not-initialized', 'Analytics service is not initialized');
		}
		return await analyticsService.exportData(format, startDate, endDate);
	},

	async 'synq.analytics.get-metrics'(): Promise<AnalyticsMetric[]> {
		return await SynqAnalyticsMetrics.find({ enabled: true }).fetch();
	},

	async 'synq.analytics.get-reports'(): Promise<AnalyticsReport[]> {
		return await SynqAnalyticsReports.find({}, { sort: { generatedAt: -1 } }).fetch();
	},
});

// API REST pour l'intégration externe
api.addRoute('synq/analytics/dashboard', { authRequired: true }, {
	async get() {
		if (!analyticsService) {
			throw new Error('Analytics service is not initialized');
		}
		const { period = 'day' } = this.queryParams;
		return await analyticsService.getDashboardData(period);
	},
});

api.addRoute('synq/analytics/reports', { authRequired: true }, {
	async get() {
		return await SynqAnalyticsReports.find({}, { sort: { generatedAt: -1 } }).fetch();
	},

	async post() {
		if (!analyticsService) {
			throw new Error('Analytics service is not initialized');
		}
		const { name, type, startDate, endDate } = this.bodyParams;
		return await analyticsService.generateReport(name, type, new Date(startDate), new Date(endDate));
	},
});

api.addRoute('synq/analytics/export', { authRequired: true }, {
	async get() {
		if (!analyticsService) {
			throw new Error('Analytics service is not initialized');
		}
		const { format = 'json', startDate, endDate } = this.queryParams;
		return await analyticsService.exportData(format, new Date(startDate), new Date(endDate));
	},
});

export { SynqAnalyticsService };
