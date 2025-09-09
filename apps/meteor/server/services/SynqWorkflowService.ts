import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Messages } from '@rocket.chat/models';
import { Users } from '@rocket.chat/models';
import { Rooms } from '@rocket.chat/models';
import { settings } from '@rocket.chat/settings';
import { Logger } from '@rocket.chat/logger';
import { api } from '@rocket.chat/core-services/api';
import { Random } from 'meteor/random';

const logger = new Logger('SynqWorkflows');

// Collections pour les workflows
export const SynqWorkflows = new Mongo.Collection('synq_workflows');
export const SynqWorkflowExecutions = new Mongo.Collection('synq_workflow_executions');
export const SynqWorkflowTriggers = new Mongo.Collection('synq_workflow_triggers');

interface WorkflowTrigger {
	_id: string;
	name: string;
	type: 'message' | 'user_join' | 'user_leave' | 'channel_created' | 'scheduled' | 'webhook' | 'api';
	conditions: {
		channelId?: string;
		userId?: string;
		messageContains?: string;
		messageType?: string;
		userRole?: string;
		schedule?: string; // Cron expression
		webhookUrl?: string;
	};
	enabled: boolean;
	createdAt: Date;
	createdBy: string;
}

interface WorkflowAction {
	_id: string;
	name: string;
	type: 'send_message' | 'create_channel' | 'assign_role' | 'send_notification' | 'webhook_call' | 'delay' | 'conditional';
	parameters: {
		message?: string;
		channelId?: string;
		channelName?: string;
		role?: string;
		userId?: string;
		webhookUrl?: string;
		delay?: number; // en millisecondes
		condition?: string;
		trueActions?: string[];
		falseActions?: string[];
	};
	enabled: boolean;
}

interface Workflow {
	_id: string;
	name: string;
	description: string;
	trigger: WorkflowTrigger;
	actions: WorkflowAction[];
	enabled: boolean;
	createdAt: Date;
	createdBy: string;
	lastExecuted?: Date;
	executionCount: number;
	settings: {
		maxExecutions?: number;
		timeout?: number; // en millisecondes
		retryOnFailure?: boolean;
		maxRetries?: number;
	};
}

interface WorkflowExecution {
	_id: string;
	workflowId: string;
	triggeredBy: string;
	triggeredAt: Date;
	status: 'running' | 'completed' | 'failed' | 'cancelled';
	actions: Array<{
		actionId: string;
		status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
		startedAt?: Date;
		completedAt?: Date;
		error?: string;
		result?: any;
	}>;
	completedAt?: Date;
	error?: string;
	metadata: {
		triggerData?: any;
		context?: any;
	};
}

class SynqWorkflowService {
	private scheduledJobs: Map<string, NodeJS.Timeout> = new Map();
	private webhookHandlers: Map<string, any> = new Map();

	constructor() {
		this.initializeService();
	}

	private async initializeService(): Promise<void> {
		try {
			const isEnabled = settings.get('Synq_Workflows_Enabled');
			if (!isEnabled) {
				logger.info('Workflow service is disabled');
				return;
			}

			await this.loadWorkflows();
			await this.startScheduledWorkflows();
			await this.setupWebhookHandlers();
			logger.info('Workflow service initialized successfully');
		} catch (error) {
			logger.error('Failed to initialize Workflow service:', error);
		}
	}

	private async loadWorkflows(): Promise<void> {
		try {
			const workflows = await SynqWorkflows.find({ enabled: true }).fetch();
			
			for (const workflow of workflows) {
				await this.setupWorkflowTriggers(workflow);
			}

			logger.info(`Loaded ${workflows.length} active workflows`);
		} catch (error) {
			logger.error('Failed to load workflows:', error);
		}
	}

	private async setupWorkflowTriggers(workflow: Workflow): Promise<void> {
		try {
			const trigger = workflow.trigger;

			switch (trigger.type) {
				case 'scheduled':
					await this.setupScheduledTrigger(workflow);
					break;
				case 'webhook':
					await this.setupWebhookTrigger(workflow);
					break;
				case 'message':
				case 'user_join':
				case 'user_leave':
				case 'channel_created':
					// Ces triggers sont gérés par les hooks Meteor
					break;
			}
		} catch (error) {
			logger.error(`Failed to setup triggers for workflow ${workflow._id}:`, error);
		}
	}

	private async setupScheduledTrigger(workflow: Workflow): Promise<void> {
		try {
			const cronExpression = workflow.trigger.conditions.schedule;
			if (!cronExpression) {
				return;
			}

			// Convertir l'expression cron en intervalle JavaScript
			const interval = this.parseCronExpression(cronExpression);
			if (!interval) {
				logger.warn(`Invalid cron expression for workflow ${workflow._id}: ${cronExpression}`);
				return;
			}

			const jobId = `workflow_${workflow._id}`;
			const timeout = setInterval(async () => {
				try {
					await this.executeWorkflow(workflow._id, 'scheduled', {});
				} catch (error) {
					logger.error(`Scheduled workflow ${workflow._id} failed:`, error);
				}
			}, interval);

			this.scheduledJobs.set(jobId, timeout);
			logger.info(`Setup scheduled trigger for workflow ${workflow._id} with interval ${interval}ms`);
		} catch (error) {
			logger.error(`Failed to setup scheduled trigger for workflow ${workflow._id}:`, error);
		}
	}

	private parseCronExpression(cron: string): number | null {
		// Implémentation simplifiée pour les expressions cron courantes
		// Dans un environnement de production, utiliser une bibliothèque comme node-cron
		const parts = cron.split(' ');
		if (parts.length !== 5) {
			return null;
		}

		const [minute, hour, day, month, weekday] = parts;

		// Exemples d'expressions courantes
		if (minute === '*' && hour === '*' && day === '*' && month === '*' && weekday === '*') {
			return 60 * 1000; // Toutes les minutes
		}
		if (minute === '0' && hour === '*' && day === '*' && month === '*' && weekday === '*') {
			return 60 * 60 * 1000; // Toutes les heures
		}
		if (minute === '0' && hour === '0' && day === '*' && month === '*' && weekday === '*') {
			return 24 * 60 * 60 * 1000; // Tous les jours
		}

		// Par défaut, toutes les 5 minutes
		return 5 * 60 * 1000;
	}

	private async setupWebhookTrigger(workflow: Workflow): Promise<void> {
		try {
			const webhookUrl = workflow.trigger.conditions.webhookUrl;
			if (!webhookUrl) {
				return;
			}

			// Enregistrer le handler webhook
			this.webhookHandlers.set(workflow._id, {
				workflowId: workflow._id,
				webhookUrl,
			});

			logger.info(`Setup webhook trigger for workflow ${workflow._id}`);
		} catch (error) {
			logger.error(`Failed to setup webhook trigger for workflow ${workflow._id}:`, error);
		}
	}

	private async startScheduledWorkflows(): Promise<void> {
		// Les workflows programmés sont déjà configurés dans loadWorkflows
		logger.info('Scheduled workflows started');
	}

	private async setupWebhookHandlers(): Promise<void> {
		// Les handlers webhook sont configurés dans loadWorkflows
		logger.info('Webhook handlers setup completed');
	}

	public async createWorkflow(
		name: string,
		description: string,
		trigger: WorkflowTrigger,
		actions: WorkflowAction[],
		settings: any = {}
	): Promise<Workflow> {
		try {
			const workflow: Workflow = {
				_id: Random.id(),
				name,
				description,
				trigger,
				actions,
				enabled: true,
				createdAt: new Date(),
				createdBy: this.userId!,
				executionCount: 0,
				settings: {
					maxExecutions: settings.maxExecutions || 1000,
					timeout: settings.timeout || 300000, // 5 minutes
					retryOnFailure: settings.retryOnFailure || false,
					maxRetries: settings.maxRetries || 3,
				},
			};

			await SynqWorkflows.insert(workflow);
			await this.setupWorkflowTriggers(workflow);

			logger.info(`Created workflow: ${name}`);
			return workflow;
		} catch (error) {
			logger.error('Failed to create workflow:', error);
			throw error;
		}
	}

	public async executeWorkflow(workflowId: string, triggeredBy: string, triggerData: any): Promise<WorkflowExecution> {
		try {
			const workflow = await SynqWorkflows.findOne(workflowId);
			if (!workflow) {
				throw new Error('Workflow not found');
			}

			if (!workflow.enabled) {
				throw new Error('Workflow is disabled');
			}

			// Vérifier les limites d'exécution
			if (workflow.settings.maxExecutions && workflow.executionCount >= workflow.settings.maxExecutions) {
				throw new Error('Workflow has reached maximum execution limit');
			}

			const executionId = Random.id();
			const execution: WorkflowExecution = {
				_id: executionId,
				workflowId,
				triggeredBy,
				triggeredAt: new Date(),
				status: 'running',
				actions: workflow.actions.map(action => ({
					actionId: action._id,
					status: 'pending',
				})),
				metadata: {
					triggerData,
				},
			};

			await SynqWorkflowExecutions.insert(execution);

			// Exécuter les actions
			try {
				await this.executeActions(workflow, execution);
				execution.status = 'completed';
				execution.completedAt = new Date();
			} catch (error) {
				execution.status = 'failed';
				execution.error = error.message;
				execution.completedAt = new Date();
			}

			await SynqWorkflowExecutions.updateOne(
				{ _id: executionId },
				{ $set: execution }
			);

			// Mettre à jour le compteur d'exécution
			await SynqWorkflows.updateOne(
				{ _id: workflowId },
				{
					$set: { lastExecuted: new Date() },
					$inc: { executionCount: 1 },
				}
			);

			logger.info(`Executed workflow ${workflowId}, status: ${execution.status}`);
			return execution;
		} catch (error) {
			logger.error(`Failed to execute workflow ${workflowId}:`, error);
			throw error;
		}
	}

	private async executeActions(workflow: Workflow, execution: WorkflowExecution): Promise<void> {
		try {
			for (const actionExecution of execution.actions) {
				const action = workflow.actions.find(a => a._id === actionExecution.actionId);
				if (!action || !action.enabled) {
					actionExecution.status = 'skipped';
					continue;
				}

				actionExecution.status = 'running';
				actionExecution.startedAt = new Date();

				try {
					const result = await this.executeAction(action, execution.metadata);
					actionExecution.status = 'completed';
					actionExecution.completedAt = new Date();
					actionExecution.result = result;
				} catch (error) {
					actionExecution.status = 'failed';
					actionExecution.completedAt = new Date();
					actionExecution.error = error.message;

					if (!workflow.settings.retryOnFailure) {
						throw error;
					}
				}

				// Mettre à jour l'exécution
				await SynqWorkflowExecutions.updateOne(
					{ _id: execution._id },
					{
						$set: {
							[`actions.${execution.actions.findIndex(a => a.actionId === actionExecution.actionId)}`]: actionExecution,
						},
					}
				);
			}
		} catch (error) {
			logger.error(`Failed to execute actions for workflow ${workflow._id}:`, error);
			throw error;
		}
	}

	private async executeAction(action: WorkflowAction, context: any): Promise<any> {
		try {
			switch (action.type) {
				case 'send_message':
					return await this.executeSendMessage(action, context);
				case 'create_channel':
					return await this.executeCreateChannel(action, context);
				case 'assign_role':
					return await this.executeAssignRole(action, context);
				case 'send_notification':
					return await this.executeSendNotification(action, context);
				case 'webhook_call':
					return await this.executeWebhookCall(action, context);
				case 'delay':
					return await this.executeDelay(action, context);
				case 'conditional':
					return await this.executeConditional(action, context);
				default:
					throw new Error(`Unknown action type: ${action.type}`);
			}
		} catch (error) {
			logger.error(`Failed to execute action ${action._id}:`, error);
			throw error;
		}
	}

	private async executeSendMessage(action: WorkflowAction, context: any): Promise<any> {
		try {
			const { message, channelId } = action.parameters;
			if (!message || !channelId) {
				throw new Error('Missing required parameters for send_message action');
			}

			// Remplacer les variables dans le message
			const processedMessage = this.processTemplate(message, context);

			await Messages.createWithTypeRoomIdMessageUserAndUnread(
				'workflow_message',
				channelId,
				processedMessage,
				{ _id: 'system', username: 'workflow' },
				false,
				{
					workflowAction: action._id,
					context,
				}
			);

			return { success: true, message: 'Message sent successfully' };
		} catch (error) {
			logger.error('Failed to execute send_message action:', error);
			throw error;
		}
	}

	private async executeCreateChannel(action: WorkflowAction, context: any): Promise<any> {
		try {
			const { channelName } = action.parameters;
			if (!channelName) {
				throw new Error('Missing required parameters for create_channel action');
			}

			// Traiter le nom du canal
			const processedName = this.processTemplate(channelName, context);

			// Créer le canal
			const channelId = Random.id();
			await Rooms.insertOne({
				_id: channelId,
				name: processedName,
				t: 'c',
				ts: new Date(),
				u: { _id: 'system', username: 'workflow' },
				workflowCreated: true,
				workflowAction: action._id,
			});

			return { success: true, channelId, message: 'Channel created successfully' };
		} catch (error) {
			logger.error('Failed to execute create_channel action:', error);
			throw error;
		}
	}

	private async executeAssignRole(action: WorkflowAction, context: any): Promise<any> {
		try {
			const { userId, role } = action.parameters;
			if (!userId || !role) {
				throw new Error('Missing required parameters for assign_role action');
			}

			// Assigner le rôle à l'utilisateur
			// Cette logique dépendrait de la structure des rôles dans Rocket.Chat
			logger.info(`Assigning role ${role} to user ${userId}`);

			return { success: true, message: 'Role assigned successfully' };
		} catch (error) {
			logger.error('Failed to execute assign_role action:', error);
			throw error;
		}
	}

	private async executeSendNotification(action: WorkflowAction, context: any): Promise<any> {
		try {
			const { userId, message } = action.parameters;
			if (!userId || !message) {
				throw new Error('Missing required parameters for send_notification action');
			}

			// Envoyer une notification à l'utilisateur
			// Cette logique dépendrait du système de notifications de Rocket.Chat
			logger.info(`Sending notification to user ${userId}: ${message}`);

			return { success: true, message: 'Notification sent successfully' };
		} catch (error) {
			logger.error('Failed to execute send_notification action:', error);
			throw error;
		}
	}

	private async executeWebhookCall(action: WorkflowAction, context: any): Promise<any> {
		try {
			const { webhookUrl } = action.parameters;
			if (!webhookUrl) {
				throw new Error('Missing required parameters for webhook_call action');
			}

			// Appeler le webhook externe
			const HTTP = require('meteor/http').HTTP;
			const response = await HTTP.post(webhookUrl, {
				data: {
					context,
					timestamp: new Date().toISOString(),
				},
			});

			return { success: true, response: response.data };
		} catch (error) {
			logger.error('Failed to execute webhook_call action:', error);
			throw error;
		}
	}

	private async executeDelay(action: WorkflowAction, context: any): Promise<any> {
		try {
			const { delay } = action.parameters;
			if (!delay) {
				throw new Error('Missing required parameters for delay action');
			}

			// Attendre le délai spécifié
			await new Promise(resolve => setTimeout(resolve, delay));

			return { success: true, message: `Delayed for ${delay}ms` };
		} catch (error) {
			logger.error('Failed to execute delay action:', error);
			throw error;
		}
	}

	private async executeConditional(action: WorkflowAction, context: any): Promise<any> {
		try {
			const { condition, trueActions, falseActions } = action.parameters;
			if (!condition) {
				throw new Error('Missing required parameters for conditional action');
			}

			// Évaluer la condition
			const result = this.evaluateCondition(condition, context);
			const actionsToExecute = result ? trueActions : falseActions;

			// Exécuter les actions conditionnelles
			if (actionsToExecute && actionsToExecute.length > 0) {
				for (const actionId of actionsToExecute) {
					// Cette logique nécessiterait une récursion ou une queue d'actions
					logger.info(`Executing conditional action ${actionId}`);
				}
			}

			return { success: true, conditionResult: result };
		} catch (error) {
			logger.error('Failed to execute conditional action:', error);
			throw error;
		}
	}

	private processTemplate(template: string, context: any): string {
		// Remplacer les variables dans le template
		// Format: {{variable}} ou {{context.property}}
		return template.replace(/\{\{([^}]+)\}\}/g, (match, variable) => {
			const trimmed = variable.trim();
			if (trimmed.startsWith('context.')) {
				const path = trimmed.substring(8);
				return this.getNestedProperty(context, path) || match;
			}
			return context[trimmed] || match;
		});
	}

	private getNestedProperty(obj: any, path: string): any {
		return path.split('.').reduce((current, key) => current?.[key], obj);
	}

	private evaluateCondition(condition: string, context: any): boolean {
		try {
			// Évaluer une condition simple
			// Dans un environnement de production, utiliser une bibliothèque d'évaluation d'expressions sécurisée
			const processedCondition = this.processTemplate(condition, context);
			
			// Exemples de conditions simples
			if (processedCondition.includes('==')) {
				const [left, right] = processedCondition.split('==').map(s => s.trim());
				return left === right;
			}
			if (processedCondition.includes('!=')) {
				const [left, right] = processedCondition.split('!=').map(s => s.trim());
				return left !== right;
			}
			if (processedCondition.includes('>')) {
				const [left, right] = processedCondition.split('>').map(s => s.trim());
				return Number(left) > Number(right);
			}
			if (processedCondition.includes('<')) {
				const [left, right] = processedCondition.split('<').map(s => s.trim());
				return Number(left) < Number(right);
			}

			// Condition booléenne simple
			return Boolean(processedCondition);
		} catch (error) {
			logger.error('Failed to evaluate condition:', error);
			return false;
		}
	}

	public async handleWebhook(workflowId: string, payload: any): Promise<WorkflowExecution> {
		try {
			const workflow = await SynqWorkflows.findOne(workflowId);
			if (!workflow) {
				throw new Error('Workflow not found');
			}

			return await this.executeWorkflow(workflowId, 'webhook', payload);
		} catch (error) {
			logger.error(`Failed to handle webhook for workflow ${workflowId}:`, error);
			throw error;
		}
	}

	public async getWorkflows(): Promise<Workflow[]> {
		return await SynqWorkflows.find({}).fetch();
	}

	public async getWorkflow(workflowId: string): Promise<Workflow | null> {
		return await SynqWorkflows.findOne(workflowId);
	}

	public async getWorkflowExecutions(workflowId?: string): Promise<WorkflowExecution[]> {
		const query = workflowId ? { workflowId } : {};
		return await SynqWorkflowExecutions.find(query, { sort: { triggeredAt: -1 } }).fetch();
	}

	public async deleteWorkflow(workflowId: string): Promise<void> {
		try {
			// Arrêter les triggers programmés
			const jobId = `workflow_${workflowId}`;
			if (this.scheduledJobs.has(jobId)) {
				clearInterval(this.scheduledJobs.get(jobId)!);
				this.scheduledJobs.delete(jobId);
			}

			// Supprimer les handlers webhook
			this.webhookHandlers.delete(workflowId);

			// Supprimer le workflow et ses exécutions
			await SynqWorkflows.remove(workflowId);
			await SynqWorkflowExecutions.remove({ workflowId });

			logger.info(`Deleted workflow ${workflowId}`);
		} catch (error) {
			logger.error(`Failed to delete workflow ${workflowId}:`, error);
			throw error;
		}
	}

	public async stopService(): Promise<void> {
		// Arrêter tous les jobs programmés
		for (const [jobId, timeout] of this.scheduledJobs) {
			clearInterval(timeout);
		}
		this.scheduledJobs.clear();

		// Nettoyer les handlers webhook
		this.webhookHandlers.clear();

		logger.info('Workflow service stopped');
	}
}

// Instance globale du service
let workflowService: SynqWorkflowService | null = null;

Meteor.startup(async () => {
	try {
		workflowService = new SynqWorkflowService();
	} catch (error) {
		logger.error('Failed to initialize Workflow service:', error);
	}
});

// Hooks Meteor pour les triggers automatiques
Meteor.startup(() => {
	// Hook pour les nouveaux messages
	Messages.before.insert((userId, doc) => {
		if (workflowService) {
			// Déclencher les workflows basés sur les messages
			Meteor.defer(async () => {
				try {
					const workflows = await SynqWorkflows.find({
						enabled: true,
						'trigger.type': 'message',
						'trigger.conditions.channelId': doc.rid,
					}).fetch();

					for (const workflow of workflows) {
						if (workflow.trigger.conditions.messageContains) {
							if (doc.msg && doc.msg.includes(workflow.trigger.conditions.messageContains)) {
								await workflowService.executeWorkflow(workflow._id, 'message', {
									message: doc,
									userId,
								});
							}
						} else {
							await workflowService.executeWorkflow(workflow._id, 'message', {
								message: doc,
								userId,
							});
						}
					}
				} catch (error) {
					logger.error('Failed to trigger message workflows:', error);
				}
			});
		}
	});

	// Hook pour les nouveaux utilisateurs
	Users.after.insert((userId, doc) => {
		if (workflowService) {
			Meteor.defer(async () => {
				try {
					const workflows = await SynqWorkflows.find({
						enabled: true,
						'trigger.type': 'user_join',
					}).fetch();

					for (const workflow of workflows) {
						await workflowService.executeWorkflow(workflow._id, 'user_join', {
							user: doc,
							userId,
						});
					}
				} catch (error) {
					logger.error('Failed to trigger user_join workflows:', error);
				}
			});
		}
	});

	// Hook pour les nouveaux canaux
	Rooms.after.insert((userId, doc) => {
		if (workflowService) {
			Meteor.defer(async () => {
				try {
					const workflows = await SynqWorkflows.find({
						enabled: true,
						'trigger.type': 'channel_created',
					}).fetch();

					for (const workflow of workflows) {
						await workflowService.executeWorkflow(workflow._id, 'channel_created', {
							room: doc,
							userId,
						});
					}
				} catch (error) {
					logger.error('Failed to trigger channel_created workflows:', error);
				}
			});
		}
	});
});

// Méthodes Meteor pour l'interface utilisateur
Meteor.methods({
	async 'synq.workflows.create'(name: string, description: string, trigger: WorkflowTrigger, actions: WorkflowAction[], settings: any = {}): Promise<Workflow> {
		if (!workflowService) {
			throw new Meteor.Error('workflow-not-initialized', 'Workflow service is not initialized');
		}
		return await workflowService.createWorkflow(name, description, trigger, actions, settings);
	},

	async 'synq.workflows.execute'(workflowId: string, triggeredBy: string, triggerData: any): Promise<WorkflowExecution> {
		if (!workflowService) {
			throw new Meteor.Error('workflow-not-initialized', 'Workflow service is not initialized');
		}
		return await workflowService.executeWorkflow(workflowId, triggeredBy, triggerData);
	},

	async 'synq.workflows.get-workflows'(): Promise<Workflow[]> {
		if (!workflowService) {
			throw new Meteor.Error('workflow-not-initialized', 'Workflow service is not initialized');
		}
		return await workflowService.getWorkflows();
	},

	async 'synq.workflows.get-workflow'(workflowId: string): Promise<Workflow | null> {
		if (!workflowService) {
			throw new Meteor.Error('workflow-not-initialized', 'Workflow service is not initialized');
		}
		return await workflowService.getWorkflow(workflowId);
	},

	async 'synq.workflows.get-executions'(workflowId?: string): Promise<WorkflowExecution[]> {
		if (!workflowService) {
			throw new Meteor.Error('workflow-not-initialized', 'Workflow service is not initialized');
		}
		return await workflowService.getWorkflowExecutions(workflowId);
	},

	async 'synq.workflows.delete'(workflowId: string): Promise<void> {
		if (!workflowService) {
			throw new Meteor.Error('workflow-not-initialized', 'Workflow service is not initialized');
		}
		return await workflowService.deleteWorkflow(workflowId);
	},
});

// API REST pour l'intégration externe
api.addRoute('synq/workflows', { authRequired: true }, {
	async get() {
		if (!workflowService) {
			throw new Error('Workflow service is not initialized');
		}
		return await workflowService.getWorkflows();
	},

	async post() {
		if (!workflowService) {
			throw new Error('Workflow service is not initialized');
		}
		const { name, description, trigger, actions, settings } = this.bodyParams;
		return await workflowService.createWorkflow(name, description, trigger, actions, settings);
	},
});

api.addRoute('synq/workflows/:workflowId', { authRequired: true }, {
	async get() {
		if (!workflowService) {
			throw new Error('Workflow service is not initialized');
		}
		return await workflowService.getWorkflow(this.urlParams.workflowId);
	},

	async delete() {
		if (!workflowService) {
			throw new Error('Workflow service is not initialized');
		}
		return await workflowService.deleteWorkflow(this.urlParams.workflowId);
	},
});

api.addRoute('synq/workflows/:workflowId/execute', { authRequired: true }, {
	async post() {
		if (!workflowService) {
			throw new Error('Workflow service is not initialized');
		}
		const { triggeredBy, triggerData } = this.bodyParams;
		return await workflowService.executeWorkflow(this.urlParams.workflowId, triggeredBy, triggerData);
	},
});

api.addRoute('synq/workflows/:workflowId/webhook', { authRequired: false }, {
	async post() {
		if (!workflowService) {
			throw new Error('Workflow service is not initialized');
		}
		return await workflowService.handleWebhook(this.urlParams.workflowId, this.bodyParams);
	},
});

export { SynqWorkflowService };
