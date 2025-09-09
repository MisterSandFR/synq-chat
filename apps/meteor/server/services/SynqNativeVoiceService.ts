import { Meteor } from 'meteor/meteor';
import { Rooms } from '@rocket.chat/models';
import { Users } from '@rocket.chat/models';
import { Messages } from '@rocket.chat/models';
import { settings } from '@rocket.chat/settings';
import { Logger } from '@rocket.chat/logger';
import { api } from '@rocket.chat/core-services/api';
import { Random } from 'meteor/random';

const logger = new Logger('SynqNativeVoice');

interface NativeVoiceRoom {
	_id: string;
	name: string;
	description: string;
	channelId: string;
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
		persistent: boolean;
	};
	webrtcConfig: {
		iceServers: RTCIceServer[];
		enableScreenShare: boolean;
		enableChat: boolean;
	};
}

interface VoiceParticipant {
	userId: string;
	username: string;
	joinedAt: Date;
	isModerator: boolean;
	isMuted: boolean;
	isDeafened: boolean;
	isVideoEnabled: boolean;
	isScreenSharing: boolean;
	connectionState: RTCIceConnectionState;
}

class SynqNativeVoiceService {
	private rooms: Map<string, NativeVoiceRoom> = new Map();
	private participants: Map<string, VoiceParticipant[]> = new Map();
	private activeConnections: Map<string, Map<string, RTCPeerConnection>> = new Map();

	constructor() {
		this.initializeService();
	}

	private async initializeService(): Promise<void> {
		try {
			const isEnabled = settings.get('Synq_Native_Voice_Enabled');
			if (!isEnabled) {
				logger.info('Native voice service is disabled');
				return;
			}

			await this.loadPersistentRooms();
			await this.startRoomCleanup();
			await this.createDefaultVoiceRooms();
			logger.info('Native voice service initialized successfully');
		} catch (error) {
			logger.error('Failed to initialize Native voice service:', error);
		}
	}

	private async loadPersistentRooms(): Promise<void> {
		try {
			const persistentRooms = await Rooms.find({
				t: 'voice',
				'voice.persistent': true,
			}).toArray();

			for (const room of persistentRooms) {
				const voiceRoom: NativeVoiceRoom = {
					_id: room._id,
					name: room.name,
					description: room.description || '',
					channelId: room._id,
					participants: [],
					createdAt: room.ts,
					lastActivity: new Date(),
					isActive: false,
					roomType: room.voice?.roomType || 'voice',
					settings: {
						maxParticipants: room.voice?.maxParticipants || settings.get('Synq_Voice_Max_Participants') || 50,
						recordingEnabled: room.voice?.recordingEnabled || settings.get('Synq_Voice_Recording_Enabled') || false,
						moderationEnabled: room.voice?.moderationEnabled || settings.get('Synq_Voice_Moderation_Enabled') || true,
						encryptionEnabled: room.voice?.encryptionEnabled || settings.get('Synq_Voice_Encryption_Enabled') || true,
						persistent: room.voice?.persistent || true,
					},
					webrtcConfig: {
						iceServers: this.getIceServers(),
						enableScreenShare: settings.get('Synq_Voice_Screen_Share_Enabled') || true,
						enableChat: settings.get('Synq_Voice_Chat_Enabled') || true,
					},
				};

				this.rooms.set(room._id, voiceRoom);
			}

			logger.info(`Loaded ${persistentRooms.length} persistent voice rooms`);
		} catch (error) {
			logger.error('Failed to load persistent rooms:', error);
		}
	}

	private getIceServers(): RTCIceServer[] {
		const servers = settings.get('WebRTC_Servers') || '';
		const iceServers: RTCIceServer[] = [];

		if (servers.trim()) {
			servers.split(',').forEach((server) => {
				const parts = server.split('@');
				const serverConfig: RTCIceServer = {
					urls: parts.pop()!,
				};
				if (parts.length === 1) {
					const [username, credential] = parts[0].split(':');
					serverConfig.username = decodeURIComponent(username);
					serverConfig.credential = decodeURIComponent(credential);
				}
				iceServers.push(serverConfig);
			});
		}

		// Ajouter des serveurs STUN/TURN par défaut si aucun n'est configuré
		if (iceServers.length === 0) {
			iceServers.push(
				{ urls: 'stun:stun.l.google.com:19302' },
				{ urls: 'stun:stun1.l.google.com:19302' }
			);
		}

		return iceServers;
	}

	private async startRoomCleanup(): Promise<void> {
		setInterval(async () => {
			try {
				await this.cleanupInactiveRooms();
			} catch (error) {
				logger.error('Room cleanup failed:', error);
			}
		}, 5 * 60 * 1000); // Toutes les 5 minutes
	}

	private async cleanupInactiveRooms(): Promise<void> {
		const lifetime = settings.get('Synq_Voice_Room_Lifetime') || 60;
		const cutoffTime = new Date(Date.now() - lifetime * 60 * 1000);

		for (const [roomId, room] of this.rooms) {
			if (!room.isActive && room.lastActivity < cutoffTime && !room.settings.persistent) {
				await this.destroyRoom(roomId);
			}
		}
	}

	public async createVoiceRoom(
		channelId: string, 
		roomName?: string, 
		roomType: 'voice' | 'video' | 'conference' = 'voice'
	): Promise<NativeVoiceRoom> {
		try {
			const channel = await Rooms.findOneById(channelId);
			if (!channel) {
				throw new Error('Channel not found');
			}

			const roomId = Random.id();
			const voiceRoom: NativeVoiceRoom = {
				_id: roomId,
				name: roomName || `${channel.name} - Voice Room`,
				description: `Salle vocale pour ${channel.name}`,
				channelId,
				participants: [],
				createdAt: new Date(),
				lastActivity: new Date(),
				isActive: false,
				roomType,
				settings: {
					maxParticipants: settings.get('Synq_Voice_Max_Participants') || 50,
					recordingEnabled: settings.get('Synq_Voice_Recording_Enabled') || false,
					moderationEnabled: settings.get('Synq_Voice_Moderation_Enabled') || true,
					encryptionEnabled: settings.get('Synq_Voice_Encryption_Enabled') || true,
					persistent: settings.get('Synq_Voice_Persistent_Rooms') || false,
				},
				webrtcConfig: {
					iceServers: this.getIceServers(),
					enableScreenShare: settings.get('Synq_Voice_Screen_Share_Enabled') || true,
					enableChat: settings.get('Synq_Voice_Chat_Enabled') || true,
				},
			};

			this.rooms.set(roomId, voiceRoom);

			// Créer une entrée dans la base de données
			await Rooms.updateOne(
				{ _id: channelId },
				{
					$set: {
						'voice.rooms': {
							[roomId]: {
								name: voiceRoom.name,
								description: voiceRoom.description,
								roomType: voiceRoom.roomType,
								persistent: voiceRoom.settings.persistent,
								createdAt: voiceRoom.createdAt,
								settings: voiceRoom.settings,
								webrtcConfig: voiceRoom.webrtcConfig,
							},
						},
					},
				}
			);

			logger.info(`Created voice room: ${voiceRoom.name} for channel: ${channel.name}`);
			return voiceRoom;
		} catch (error) {
			logger.error('Failed to create voice room:', error);
			throw error;
		}
	}

	public async joinRoom(roomId: string, userId: string): Promise<{ 
		roomUrl: string; 
		participantId: string; 
		webrtcConfig: any;
	}> {
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
			const participant: VoiceParticipant = {
				userId,
				username: user.username || user.name,
				joinedAt: new Date(),
				isModerator: room.participants.length === 1,
				isMuted: false,
				isDeafened: false,
				isVideoEnabled: room.roomType !== 'voice',
				isScreenSharing: false,
				connectionState: 'new',
			};

			if (!this.participants.has(roomId)) {
				this.participants.set(roomId, []);
			}
			this.participants.get(roomId)!.push(participant);

			// Générer l'URL de la salle native
			const roomUrl = this.generateNativeRoomUrl(roomId, participantId, user);

			// Envoyer une notification au canal
			await this.notifyChannelJoin(room.channelId, user, room);

			logger.info(`User ${user.username} joined room ${room.name}`);
			return { 
				roomUrl, 
				participantId,
				webrtcConfig: room.webrtcConfig
			};
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

			// Fermer les connexions WebRTC
			if (this.activeConnections.has(roomId)) {
				const connections = this.activeConnections.get(roomId)!;
				if (connections.has(userId)) {
					const connection = connections.get(userId)!;
					connection.close();
					connections.delete(userId);
				}
			}

			// Si plus de participants, marquer comme inactif
			if (room.participants.length === 0) {
				room.isActive = false;
			}

			const user = await Users.findOneById(userId);
			if (user) {
				await this.notifyChannelLeave(room.channelId, user, room);
			}

			logger.info(`User ${userId} left room ${room.name}`);
		} catch (error) {
			logger.error('Failed to leave room:', error);
		}
	}

	private generateNativeRoomUrl(roomId: string, participantId: string, user: any): string {
		const baseUrl = settings.get('ROOT_URL') || 'http://localhost:3000';
		const params = new URLSearchParams();

		params.append('roomId', roomId);
		params.append('participantId', participantId);
		params.append('userInfo', JSON.stringify({
			displayName: user.name || user.username,
			email: user.emails?.[0]?.address,
			avatar: user.avatarUrl,
		}));

		return `${baseUrl}/voice/${roomId}?${params.toString()}`;
	}

	private async notifyChannelJoin(channelId: string, user: any, room: NativeVoiceRoom): Promise<void> {
		try {
			await Messages.createWithTypeRoomIdMessageUserAndUnread(
				'voice_call_started',
				channelId,
				`${user.name || user.username} a rejoint la salle vocale "${room.name}"`,
				user,
				false,
				{
					roomId: room._id,
					roomName: room.name,
					roomType: room.roomType,
					participantCount: room.participants.length,
					actionUrl: `/voice/${room._id}`,
				}
			);
		} catch (error) {
			logger.error('Failed to send join notification:', error);
		}
	}

	private async notifyChannelLeave(channelId: string, user: any, room: NativeVoiceRoom): Promise<void> {
		try {
			await Messages.createWithTypeRoomIdMessageUserAndUnread(
				'voice_call_ended',
				channelId,
				`${user.name || user.username} a quitté la salle vocale "${room.name}"`,
				user,
				false,
				{
					roomId: room._id,
					roomName: room.name,
					roomType: room.roomType,
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
				{ _id: room.channelId },
				{
					$unset: {
						[`voice.rooms.${roomId}`]: 1,
					},
				}
			);

			// Supprimer des collections locales
			this.rooms.delete(roomId);
			this.participants.delete(roomId);
			this.activeConnections.delete(roomId);

			logger.info(`Destroyed room: ${room.name}`);
		} catch (error) {
			logger.error('Failed to destroy room:', error);
		}
	}

	public async getRoomInfo(roomId: string): Promise<NativeVoiceRoom | null> {
		return this.rooms.get(roomId) || null;
	}

	public async getRoomParticipants(roomId: string): Promise<VoiceParticipant[]> {
		return this.participants.get(roomId) || [];
	}

	public async getActiveRooms(): Promise<NativeVoiceRoom[]> {
		return Array.from(this.rooms.values()).filter(room => room.isActive);
	}

	public async getChannelRooms(channelId: string): Promise<NativeVoiceRoom[]> {
		return Array.from(this.rooms.values()).filter(room => room.channelId === channelId);
	}

	public async createDefaultVoiceRooms(): Promise<void> {
		try {
			const defaultRooms = JSON.parse(settings.get('Synq_Voice_Default_Rooms') || '[]');
			
			for (const roomConfig of defaultRooms) {
				if (roomConfig.channelId) {
					await this.createVoiceRoom(
						roomConfig.channelId, 
						roomConfig.name, 
						roomConfig.roomType || 'voice'
					);
				}
			}

			logger.info('Created default voice rooms');
		} catch (error) {
			logger.error('Failed to create default voice rooms:', error);
		}
	}

	// Méthodes pour la gestion WebRTC
	public async createPeerConnection(roomId: string, userId: string): Promise<RTCPeerConnection> {
		const room = this.rooms.get(roomId);
		if (!room) {
			throw new Error('Room not found');
		}

		const peerConnection = new RTCPeerConnection(room.webrtcConfig);
		
		if (!this.activeConnections.has(roomId)) {
			this.activeConnections.set(roomId, new Map());
		}
		this.activeConnections.get(roomId)!.set(userId, peerConnection);

		// Gérer les événements de connexion
		peerConnection.oniceconnectionstatechange = () => {
			this.updateParticipantConnectionState(roomId, userId, peerConnection.iceConnectionState);
		};

		peerConnection.onconnectionstatechange = () => {
			logger.info(`Connection state changed for user ${userId}: ${peerConnection.connectionState}`);
		};

		return peerConnection;
	}

	private updateParticipantConnectionState(roomId: string, userId: string, state: RTCIceConnectionState): void {
		if (this.participants.has(roomId)) {
			const participants = this.participants.get(roomId)!;
			const participant = participants.find(p => p.userId === userId);
			if (participant) {
				participant.connectionState = state;
			}
		}
	}

	public async toggleParticipantMute(roomId: string, userId: string, muted: boolean): Promise<void> {
		if (this.participants.has(roomId)) {
			const participants = this.participants.get(roomId)!;
			const participant = participants.find(p => p.userId === userId);
			if (participant) {
				participant.isMuted = muted;
			}
		}
	}

	public async toggleParticipantVideo(roomId: string, userId: string, enabled: boolean): Promise<void> {
		if (this.participants.has(roomId)) {
			const participants = this.participants.get(roomId)!;
			const participant = participants.find(p => p.userId === userId);
			if (participant) {
				participant.isVideoEnabled = enabled;
			}
		}
	}

	public async toggleScreenShare(roomId: string, userId: string, sharing: boolean): Promise<void> {
		if (this.participants.has(roomId)) {
			const participants = this.participants.get(roomId)!;
			const participant = participants.find(p => p.userId === userId);
			if (participant) {
				participant.isScreenSharing = sharing;
			}
		}
	}
}

// Instance globale du service
let nativeVoiceService: SynqNativeVoiceService | null = null;

Meteor.startup(async () => {
	try {
		nativeVoiceService = new SynqNativeVoiceService();
	} catch (error) {
		logger.error('Failed to initialize Native voice service:', error);
	}
});

// Méthodes Meteor pour l'interface utilisateur
Meteor.methods({
	async 'synq.voice.create-room'(channelId: string, roomName?: string, roomType?: 'voice' | 'video' | 'conference'): Promise<NativeVoiceRoom> {
		if (!nativeVoiceService) {
			throw new Meteor.Error('voice-not-initialized', 'Native voice service is not initialized');
		}
		return await nativeVoiceService.createVoiceRoom(channelId, roomName, roomType);
	},

	async 'synq.voice.join-room'(roomId: string): Promise<{ roomUrl: string; participantId: string; webrtcConfig: any }> {
		if (!nativeVoiceService) {
			throw new Meteor.Error('voice-not-initialized', 'Native voice service is not initialized');
		}
		return await nativeVoiceService.joinRoom(roomId, this.userId!);
	},

	async 'synq.voice.leave-room'(roomId: string): Promise<void> {
		if (!nativeVoiceService) {
			throw new Meteor.Error('voice-not-initialized', 'Native voice service is not initialized');
		}
		return await nativeVoiceService.leaveRoom(roomId, this.userId!);
	},

	async 'synq.voice.get-room-info'(roomId: string): Promise<NativeVoiceRoom | null> {
		if (!nativeVoiceService) {
			throw new Meteor.Error('voice-not-initialized', 'Native voice service is not initialized');
		}
		return await nativeVoiceService.getRoomInfo(roomId);
	},

	async 'synq.voice.get-room-participants'(roomId: string): Promise<VoiceParticipant[]> {
		if (!nativeVoiceService) {
			throw new Meteor.Error('voice-not-initialized', 'Native voice service is not initialized');
		}
		return await nativeVoiceService.getRoomParticipants(roomId);
	},

	async 'synq.voice.get-active-rooms'(): Promise<NativeVoiceRoom[]> {
		if (!nativeVoiceService) {
			throw new Meteor.Error('voice-not-initialized', 'Native voice service is not initialized');
		}
		return await nativeVoiceService.getActiveRooms();
	},

	async 'synq.voice.get-channel-rooms'(channelId: string): Promise<NativeVoiceRoom[]> {
		if (!nativeVoiceService) {
			throw new Meteor.Error('voice-not-initialized', 'Native voice service is not initialized');
		}
		return await nativeVoiceService.getChannelRooms(channelId);
	},

	async 'synq.voice.toggle-mute'(roomId: string, userId: string, muted: boolean): Promise<void> {
		if (!nativeVoiceService) {
			throw new Meteor.Error('voice-not-initialized', 'Native voice service is not initialized');
		}
		return await nativeVoiceService.toggleParticipantMute(roomId, userId, muted);
	},

	async 'synq.voice.toggle-video'(roomId: string, userId: string, enabled: boolean): Promise<void> {
		if (!nativeVoiceService) {
			throw new Meteor.Error('voice-not-initialized', 'Native voice service is not initialized');
		}
		return await nativeVoiceService.toggleParticipantVideo(roomId, userId, enabled);
	},

	async 'synq.voice.toggle-screen-share'(roomId: string, userId: string, sharing: boolean): Promise<void> {
		if (!nativeVoiceService) {
			throw new Meteor.Error('voice-not-initialized', 'Native voice service is not initialized');
		}
		return await nativeVoiceService.toggleScreenShare(roomId, userId, sharing);
	},
});

// API REST pour l'intégration externe
api.addRoute('synq/voice/rooms', { authRequired: true }, {
	async get() {
		if (!nativeVoiceService) {
			throw new Error('Native voice service is not initialized');
		}
		return await nativeVoiceService.getActiveRooms();
	},

	async post() {
		if (!nativeVoiceService) {
			throw new Error('Native voice service is not initialized');
		}
		const { channelId, roomName, roomType } = this.bodyParams;
		return await nativeVoiceService.createVoiceRoom(channelId, roomName, roomType);
	},
});

api.addRoute('synq/voice/rooms/:roomId', { authRequired: true }, {
	async get() {
		if (!nativeVoiceService) {
			throw new Error('Native voice service is not initialized');
		}
		return await nativeVoiceService.getRoomInfo(this.urlParams.roomId);
	},

	async delete() {
		if (!nativeVoiceService) {
			throw new Error('Native voice service is not initialized');
		}
		return await nativeVoiceService.destroyRoom(this.urlParams.roomId);
	},
});

api.addRoute('synq/voice/rooms/:roomId/join', { authRequired: true }, {
	async post() {
		if (!nativeVoiceService) {
			throw new Error('Native voice service is not initialized');
		}
		return await nativeVoiceService.joinRoom(this.urlParams.roomId, this.userId!);
	},
});

api.addRoute('synq/voice/rooms/:roomId/leave', { authRequired: true }, {
	async post() {
		if (!nativeVoiceService) {
			throw new Error('Native voice service is not initialized');
		}
		return await nativeVoiceService.leaveRoom(this.urlParams.roomId, this.userId!);
	},
});

api.addRoute('synq/voice/rooms/:roomId/participants', { authRequired: true }, {
	async get() {
		if (!nativeVoiceService) {
			throw new Error('Native voice service is not initialized');
		}
		return await nativeVoiceService.getRoomParticipants(this.urlParams.roomId);
	},
});

export { SynqNativeVoiceService };
