import { Meteor } from 'meteor/meteor';
import { Rooms } from '@rocket.chat/models';
import { Users } from '@rocket.chat/models';
import { Messages } from '@rocket.chat/models';
import { settings } from '@rocket.chat/settings';
import { Logger } from '@rocket.chat/logger';
import { api } from '@rocket.chat/core-services/api';
import { Random } from 'meteor/random';

const logger = new Logger('SynqJitsi');

interface JitsiRoom {
	_id: string;
	name: string;
	roomId: string;
	jitsiRoomName: string;
	participants: string[];
	createdAt: Date;
	lastActivity: Date;
	isActive: boolean;
	roomType: 'voice' | 'video' | 'conference';
	settings: {
		maxParticipants: number;
		recordingEnabled: boolean;
		moderationEnabled: boolean;
		encryptionEnabled: boolean;
	};
}

interface JitsiParticipant {
	userId: string;
	username: string;
	joinedAt: Date;
	isModerator: boolean;
	isMuted: boolean;
	isVideoEnabled: boolean;
}

class SynqJitsiService {
	private rooms: Map<string, JitsiRoom> = new Map();
	private participants: Map<string, JitsiParticipant[]> = new Map();

	constructor() {
		this.initializeService();
	}

	private async initializeService(): Promise<void> {
		try {
			const isEnabled = settings.get('Synq_Jitsi_Enhanced_Enabled');
			if (!isEnabled) {
				logger.info('Enhanced Jitsi integration is disabled');
				return;
			}

			await this.loadPersistentRooms();
			await this.startRoomCleanup();
			logger.info('Enhanced Jitsi service initialized successfully');
		} catch (error) {
			logger.error('Failed to initialize Enhanced Jitsi service:', error);
		}
	}

	private async loadPersistentRooms(): Promise<void> {
		try {
			// Charger les salles persistantes depuis la base de données
			const persistentRooms = await Rooms.find({
				t: 'jitsi',
				'jitsi.persistent': true,
			}).toArray();

			for (const room of persistentRooms) {
				const jitsiRoom: JitsiRoom = {
					_id: room._id,
					name: room.name,
					roomId: room._id,
					jitsiRoomName: room.jitsi?.roomName || this.generateRoomName(room.name),
					participants: [],
					createdAt: room.ts,
					lastActivity: new Date(),
					isActive: false,
					roomType: room.jitsi?.roomType || 'voice',
					settings: {
						maxParticipants: room.jitsi?.maxParticipants || settings.get('Synq_Jitsi_Room_User_Limit') || 50,
						recordingEnabled: room.jitsi?.recordingEnabled || settings.get('Synq_Jitsi_Recording_Enabled') || false,
						moderationEnabled: room.jitsi?.moderationEnabled || settings.get('Synq_Jitsi_Room_Moderation') || true,
						encryptionEnabled: room.jitsi?.encryptionEnabled || settings.get('Synq_Jitsi_Encryption_Enabled') || true,
					},
				};

				this.rooms.set(room._id, jitsiRoom);
			}

			logger.info(`Loaded ${persistentRooms.length} persistent Jitsi rooms`);
		} catch (error) {
			logger.error('Failed to load persistent rooms:', error);
		}
	}

	private generateRoomName(roomName: string): string {
		// Générer un nom de salle Jitsi unique basé sur le nom du canal
		const sanitized = roomName.toLowerCase().replace(/[^a-z0-9]/g, '-');
		const timestamp = Date.now().toString(36);
		return `synq-${sanitized}-${timestamp}`;
	}

	private async startRoomCleanup(): Promise<void> {
		// Nettoyer les salles inactives toutes les 5 minutes
		setInterval(async () => {
			try {
				await this.cleanupInactiveRooms();
			} catch (error) {
				logger.error('Room cleanup failed:', error);
			}
		}, 5 * 60 * 1000);
	}

	private async cleanupInactiveRooms(): Promise<void> {
		const lifetime = settings.get('Synq_Jitsi_Room_Lifetime') || 60;
		const cutoffTime = new Date(Date.now() - lifetime * 60 * 1000);

		for (const [roomId, room] of this.rooms) {
			if (!room.isActive && room.lastActivity < cutoffTime) {
				await this.destroyRoom(roomId);
			}
		}
	}

	public async createVoiceRoom(channelId: string, roomName?: string): Promise<JitsiRoom> {
		try {
			const channel = await Rooms.findOneById(channelId);
			if (!channel) {
				throw new Error('Channel not found');
			}

			const jitsiRoomName = roomName || this.generateRoomName(channel.name);
			const roomId = Random.id();

			const jitsiRoom: JitsiRoom = {
				_id: roomId,
				name: roomName || `${channel.name} - Voice Room`,
				roomId: channelId,
				jitsiRoomName,
				participants: [],
				createdAt: new Date(),
				lastActivity: new Date(),
				isActive: false,
				roomType: 'voice',
				settings: {
					maxParticipants: settings.get('Synq_Jitsi_Room_User_Limit') || 50,
					recordingEnabled: settings.get('Synq_Jitsi_Recording_Enabled') || false,
					moderationEnabled: settings.get('Synq_Jitsi_Room_Moderation') || true,
					encryptionEnabled: settings.get('Synq_Jitsi_Encryption_Enabled') || true,
				},
			};

			this.rooms.set(roomId, jitsiRoom);

			// Créer une entrée dans la base de données
			await Rooms.updateOne(
				{ _id: channelId },
				{
					$set: {
						'jitsi.rooms': {
							[roomId]: {
								name: jitsiRoom.name,
								roomName: jitsiRoomName,
								roomType: 'voice',
								persistent: settings.get('Synq_Jitsi_Persistent_Rooms') || false,
								createdAt: jitsiRoom.createdAt,
								settings: jitsiRoom.settings,
							},
						},
					},
				}
			);

			logger.info(`Created voice room: ${jitsiRoomName} for channel: ${channel.name}`);
			return jitsiRoom;
		} catch (error) {
			logger.error('Failed to create voice room:', error);
			throw error;
		}
	}

	public async joinRoom(roomId: string, userId: string): Promise<{ roomUrl: string; participantId: string }> {
		try {
			const room = this.rooms.get(roomId);
			if (!room) {
				throw new Error('Room not found');
			}

			const user = await Users.findOneById(userId);
			if (!user) {
				throw new Error('User not found');
			}

			// Vérifier la limite de participants
			if (room.participants.length >= room.settings.maxParticipants) {
				throw new Error('Room is full');
			}

			// Ajouter le participant
			if (!room.participants.includes(userId)) {
				room.participants.push(userId);
				room.isActive = true;
				room.lastActivity = new Date();
			}

			const participantId = Random.id();
			const participant: JitsiParticipant = {
				userId,
				username: user.username || user.name,
				joinedAt: new Date(),
				isModerator: room.participants.length === 1, // Premier participant = modérateur
				isMuted: false,
				isVideoEnabled: room.roomType !== 'voice',
			};

			if (!this.participants.has(roomId)) {
				this.participants.set(roomId, []);
			}
			this.participants.get(roomId)!.push(participant);

			// Générer l'URL de la salle Jitsi
			const roomUrl = this.generateJitsiUrl(room.jitsiRoomName, participantId, user);

			// Envoyer une notification au canal
			await this.notifyChannelJoin(room.roomId, user, room);

			logger.info(`User ${user.username} joined room ${room.jitsiRoomName}`);
			return { roomUrl, participantId };
		} catch (error) {
			logger.error('Failed to join room:', error);
			throw error;
		}
	}

	public async leaveRoom(roomId: string, userId: string): Promise<void> {
		try {
			const room = this.rooms.get(roomId);
			if (!room) {
				return;
			}

			// Retirer le participant
			room.participants = room.participants.filter(id => id !== userId);
			room.lastActivity = new Date();

			// Retirer de la liste des participants
			if (this.participants.has(roomId)) {
				const participants = this.participants.get(roomId)!;
				const participantIndex = participants.findIndex(p => p.userId === userId);
				if (participantIndex !== -1) {
					participants.splice(participantIndex, 1);
				}
			}

			// Si plus de participants, marquer comme inactif
			if (room.participants.length === 0) {
				room.isActive = false;
			}

			const user = await Users.findOneById(userId);
			if (user) {
				await this.notifyChannelLeave(room.roomId, user, room);
			}

			logger.info(`User ${userId} left room ${room.jitsiRoomName}`);
		} catch (error) {
			logger.error('Failed to leave room:', error);
		}
	}

	private generateJitsiUrl(roomName: string, participantId: string, user: any): string {
		const serverUrl = settings.get('Synq_Jitsi_Server_URL') || 'https://meet.jit.si';
		const params = new URLSearchParams();

		// Configuration de base
		params.append('roomName', roomName);
		params.append('userInfo', JSON.stringify({
			displayName: user.name || user.username,
			email: user.emails?.[0]?.address,
		}));

		// Configuration des fonctionnalités
		const config = JSON.parse(settings.get('Synq_Jitsi_Default_Room_Config') || '{}');
		if (config.startWithAudioMuted) {
			params.append('config.startWithAudioMuted', 'true');
		}
		if (config.startWithVideoMuted) {
			params.append('config.startWithVideoMuted', 'true');
		}

		// Interface utilisateur
		params.append('interfaceConfig', JSON.stringify({
			SHOW_JITSI_WATERMARK: false,
			SHOW_WATERMARK_FOR_GUESTS: false,
			SHOW_POWERED_BY: false,
			APP_NAME: 'Synq',
			LANG_DETECTION: true,
			DEFAULT_LOGO_URL: '/images/synq/logo.svg',
		}));

		return `${serverUrl}/${roomName}?${params.toString()}`;
	}

	private async notifyChannelJoin(channelId: string, user: any, room: JitsiRoom): Promise<void> {
		try {
			await Messages.createWithTypeRoomIdMessageUserAndUnread(
				'jitsi_call_started',
				channelId,
				`${user.name || user.username} a rejoint la salle vocale "${room.name}"`,
				user,
				false,
				{
					roomId: room._id,
					roomName: room.name,
					jitsiRoomName: room.jitsiRoomName,
					participantCount: room.participants.length,
				}
			);
		} catch (error) {
			logger.error('Failed to send join notification:', error);
		}
	}

	private async notifyChannelLeave(channelId: string, user: any, room: JitsiRoom): Promise<void> {
		try {
			await Messages.createWithTypeRoomIdMessageUserAndUnread(
				'jitsi_call_ended',
				channelId,
				`${user.name || user.username} a quitté la salle vocale "${room.name}"`,
				user,
				false,
				{
					roomId: room._id,
					roomName: room.name,
					jitsiRoomName: room.jitsiRoomName,
					participantCount: room.participants.length,
				}
			);
		} catch (error) {
			logger.error('Failed to send leave notification:', error);
		}
	}

	public async destroyRoom(roomId: string): Promise<void> {
		try {
			const room = this.rooms.get(roomId);
			if (!room) {
				return;
			}

			// Notifier tous les participants
			for (const userId of room.participants) {
				await this.leaveRoom(roomId, userId);
			}

			// Supprimer de la base de données
			await Rooms.updateOne(
				{ _id: room.roomId },
				{
					$unset: {
						[`jitsi.rooms.${roomId}`]: 1,
					},
				}
			);

			// Supprimer des collections locales
			this.rooms.delete(roomId);
			this.participants.delete(roomId);

			logger.info(`Destroyed room: ${room.jitsiRoomName}`);
		} catch (error) {
			logger.error('Failed to destroy room:', error);
		}
	}

	public async getRoomInfo(roomId: string): Promise<JitsiRoom | null> {
		return this.rooms.get(roomId) || null;
	}

	public async getRoomParticipants(roomId: string): Promise<JitsiParticipant[]> {
		return this.participants.get(roomId) || [];
	}

	public async getActiveRooms(): Promise<JitsiRoom[]> {
		return Array.from(this.rooms.values()).filter(room => room.isActive);
	}

	public async getChannelRooms(channelId: string): Promise<JitsiRoom[]> {
		return Array.from(this.rooms.values()).filter(room => room.roomId === channelId);
	}

	public async createDefaultVoiceRooms(): Promise<void> {
		try {
			const defaultRooms = JSON.parse(settings.get('Synq_Jitsi_Default_Voice_Rooms') || '[]');
			
			for (const roomConfig of defaultRooms) {
				// Créer des salles vocales par défaut pour les canaux spécifiés
				if (roomConfig.channelId) {
					await this.createVoiceRoom(roomConfig.channelId, roomConfig.name);
				}
			}

			logger.info('Created default voice rooms');
		} catch (error) {
			logger.error('Failed to create default voice rooms:', error);
		}
	}
}

// Instance globale du service
let jitsiService: SynqJitsiService | null = null;

Meteor.startup(async () => {
	try {
		jitsiService = new SynqJitsiService();
		await jitsiService.createDefaultVoiceRooms();
	} catch (error) {
		logger.error('Failed to initialize Jitsi service:', error);
	}
});

// Méthodes Meteor pour l'interface utilisateur
Meteor.methods({
	async 'synq.jitsi.create-voice-room'(channelId: string, roomName?: string): Promise<JitsiRoom> {
		if (!jitsiService) {
			throw new Meteor.Error('jitsi-not-initialized', 'Jitsi service is not initialized');
		}
		return await jitsiService.createVoiceRoom(channelId, roomName);
	},

	async 'synq.jitsi.join-room'(roomId: string): Promise<{ roomUrl: string; participantId: string }> {
		if (!jitsiService) {
			throw new Meteor.Error('jitsi-not-initialized', 'Jitsi service is not initialized');
		}
		return await jitsiService.joinRoom(roomId, this.userId!);
	},

	async 'synq.jitsi.leave-room'(roomId: string): Promise<void> {
		if (!jitsiService) {
			throw new Meteor.Error('jitsi-not-initialized', 'Jitsi service is not initialized');
		}
		return await jitsiService.leaveRoom(roomId, this.userId!);
	},

	async 'synq.jitsi.get-room-info'(roomId: string): Promise<JitsiRoom | null> {
		if (!jitsiService) {
			throw new Meteor.Error('jitsi-not-initialized', 'Jitsi service is not initialized');
		}
		return await jitsiService.getRoomInfo(roomId);
	},

	async 'synq.jitsi.get-room-participants'(roomId: string): Promise<JitsiParticipant[]> {
		if (!jitsiService) {
			throw new Meteor.Error('jitsi-not-initialized', 'Jitsi service is not initialized');
		}
		return await jitsiService.getRoomParticipants(roomId);
	},

	async 'synq.jitsi.get-active-rooms'(): Promise<JitsiRoom[]> {
		if (!jitsiService) {
			throw new Meteor.Error('jitsi-not-initialized', 'Jitsi service is not initialized');
		}
		return await jitsiService.getActiveRooms();
	},

	async 'synq.jitsi.get-channel-rooms'(channelId: string): Promise<JitsiRoom[]> {
		if (!jitsiService) {
			throw new Meteor.Error('jitsi-not-initialized', 'Jitsi service is not initialized');
		}
		return await jitsiService.getChannelRooms(channelId);
	},
});

// API REST pour l'intégration externe
api.addRoute('synq/jitsi/rooms', { authRequired: true }, {
	async get() {
		if (!jitsiService) {
			throw new Error('Jitsi service is not initialized');
		}
		return await jitsiService.getActiveRooms();
	},

	async post() {
		if (!jitsiService) {
			throw new Error('Jitsi service is not initialized');
		}
		const { channelId, roomName } = this.bodyParams;
		return await jitsiService.createVoiceRoom(channelId, roomName);
	},
});

api.addRoute('synq/jitsi/rooms/:roomId', { authRequired: true }, {
	async get() {
		if (!jitsiService) {
			throw new Error('Jitsi service is not initialized');
		}
		return await jitsiService.getRoomInfo(this.urlParams.roomId);
	},

	async delete() {
		if (!jitsiService) {
			throw new Error('Jitsi service is not initialized');
		}
		return await jitsiService.destroyRoom(this.urlParams.roomId);
	},
});

export { SynqJitsiService };
