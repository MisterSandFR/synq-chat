// Configuration d'intégration pour les services vocaux natifs Synq
import { createSynqNativeVoiceSettings } from './server/settings/synq-native-voice';
import { createSynqJitsiSettings } from './server/settings/synq-jitsi';

// Enregistrer les paramètres
Meteor.startup(() => {
	// Paramètres pour le service vocal natif
	createSynqNativeVoiceSettings();
	
	// Paramètres pour l'intégration Jitsi améliorée (optionnel)
	createSynqJitsiSettings();
});

// Configuration des routes pour les salles vocales
import { SynqNativeVoiceService } from './server/services/SynqNativeVoiceService';

// Exporter les services pour utilisation dans d'autres modules
export { SynqNativeVoiceService };

// Configuration des types de messages pour les salles vocales
import { MessageTypes } from '@rocket.chat/core-typings';

// Ajouter les types de messages pour les salles vocales
MessageTypes.registerType('voice_call_started', {
	message: 'Voice call started',
	messageTpl: 'Voice call started',
	data: {
		roomId: String,
		roomName: String,
		roomType: String,
		participantCount: Number,
		actionUrl: String,
	},
});

MessageTypes.registerType('voice_call_ended', {
	message: 'Voice call ended',
	messageTpl: 'Voice call ended',
	data: {
		roomId: String,
		roomName: String,
		roomType: String,
		participantCount: Number,
	},
});

MessageTypes.registerType('voice_participant_joined', {
	message: 'Participant joined voice room',
	messageTpl: 'Participant joined voice room',
	data: {
		roomId: String,
		participantId: String,
		participantName: String,
	},
});

MessageTypes.registerType('voice_participant_left', {
	message: 'Participant left voice room',
	messageTpl: 'Participant left voice room',
	data: {
		roomId: String,
		participantId: String,
		participantName: String,
	},
});

// Configuration des permissions pour les salles vocales
import { Permissions } from '@rocket.chat/core-typings';

Permissions.registerPermission('create-voice-rooms', {
	name: 'Create Voice Rooms',
	description: 'Allow users to create voice rooms',
	roles: ['admin', 'moderator', 'user'],
});

Permissions.registerPermission('join-voice-rooms', {
	name: 'Join Voice Rooms',
	description: 'Allow users to join voice rooms',
	roles: ['admin', 'moderator', 'user'],
});

Permissions.registerPermission('moderate-voice-rooms', {
	name: 'Moderate Voice Rooms',
	description: 'Allow users to moderate voice rooms',
	roles: ['admin', 'moderator'],
});

Permissions.registerPermission('delete-voice-rooms', {
	name: 'Delete Voice Rooms',
	description: 'Allow users to delete voice rooms',
	roles: ['admin', 'moderator'],
});

// Configuration des hooks pour l'intégration
import { Hooks } from '@rocket.chat/core-services';

// Hook pour créer automatiquement des salles vocales par défaut
Hooks.add('afterCreateChannel', async (channel) => {
	const settings = await import('@rocket.chat/settings');
	
	if (settings.get('Synq_Voice_Auto_Create_Default_Rooms')) {
		try {
			const { SynqNativeVoiceService } = await import('./server/services/SynqNativeVoiceService');
			// Créer une salle vocale par défaut pour le nouveau canal
			await SynqNativeVoiceService.createVoiceRoom(channel._id, `${channel.name} - Voice`);
		} catch (error) {
			console.error('Failed to create default voice room:', error);
		}
	}
});

// Hook pour nettoyer les salles vocales inactives
Hooks.add('onServerStartup', async () => {
	const settings = await import('@rocket.chat/settings');
	
	if (settings.get('Synq_Native_Voice_Enabled')) {
		// Démarrer le nettoyage périodique des salles vocales
		setInterval(async () => {
			try {
				const { SynqNativeVoiceService } = await import('./server/services/SynqNativeVoiceService');
				// Le nettoyage est géré automatiquement par le service
			} catch (error) {
				console.error('Voice room cleanup failed:', error);
			}
		}, 5 * 60 * 1000); // Toutes les 5 minutes
	}
});

// Configuration des événements de présence
Hooks.add('onUserStatusChange', async (user, status) => {
	if (status === 'offline') {
		// Retirer l'utilisateur de toutes les salles vocales actives
		try {
			const { SynqNativeVoiceService } = await import('./server/services/SynqNativeVoiceService');
			const activeRooms = await SynqNativeVoiceService.getActiveRooms();
			
			for (const room of activeRooms) {
				if (room.participants.includes(user._id)) {
					await SynqNativeVoiceService.leaveRoom(room._id, user._id);
				}
			}
		} catch (error) {
			console.error('Failed to remove user from voice rooms:', error);
		}
	}
});

// Configuration des statistiques
Hooks.add('onStatisticsRequest', async (stats) => {
	try {
		const { SynqNativeVoiceService } = await import('./server/services/SynqNativeVoiceService');
		const activeRooms = await SynqNativeVoiceService.getActiveRooms();
		
		stats.voiceRooms = {
			total: activeRooms.length,
			active: activeRooms.filter(room => room.isActive).length,
			totalParticipants: activeRooms.reduce((sum, room) => sum + room.participants.length, 0),
		};
	} catch (error) {
		console.error('Failed to get voice room statistics:', error);
	}
});

// Configuration des notifications push pour les salles vocales
Hooks.add('onPushNotification', async (notification, user) => {
	// Ajouter des notifications pour les événements de salles vocales
	if (notification.type === 'voice_call_started') {
		notification.title = 'Appel vocal démarré';
		notification.body = `${notification.data.roomName} - ${notification.data.participantCount} participants`;
	}
	
	if (notification.type === 'voice_call_ended') {
		notification.title = 'Appel vocal terminé';
		notification.body = `${notification.data.roomName}`;
	}
});

// Configuration des webhooks pour l'intégration externe
Hooks.add('onWebhookRequest', async (webhook, request) => {
	if (webhook.url.includes('/synq/voice/')) {
		// Traiter les webhooks pour les salles vocales
		const { SynqNativeVoiceService } = await import('./server/services/SynqNativeVoiceService');
		
		switch (webhook.event) {
			case 'voice.room.created':
				// Notifier les systèmes externes qu'une salle vocale a été créée
				break;
			case 'voice.room.destroyed':
				// Notifier les systèmes externes qu'une salle vocale a été supprimée
				break;
			case 'voice.participant.joined':
				// Notifier les systèmes externes qu'un participant a rejoint
				break;
			case 'voice.participant.left':
				// Notifier les systèmes externes qu'un participant a quitté
				break;
		}
	}
});

// Configuration des métriques pour le monitoring
Hooks.add('onMetricsRequest', async (metrics) => {
	try {
		const { SynqNativeVoiceService } = await import('./server/services/SynqNativeVoiceService');
		const activeRooms = await SynqNativeVoiceService.getActiveRooms();
		
		metrics.voiceRooms = {
			activeRooms: activeRooms.length,
			totalParticipants: activeRooms.reduce((sum, room) => sum + room.participants.length, 0),
			averageParticipantsPerRoom: activeRooms.length > 0 
				? activeRooms.reduce((sum, room) => sum + room.participants.length, 0) / activeRooms.length 
				: 0,
		};
	} catch (error) {
		console.error('Failed to get voice room metrics:', error);
	}
});

// Configuration des logs
Hooks.add('onLogRequest', async (log) => {
	// Ajouter des logs spécifiques pour les salles vocales
	if (log.level === 'info' && log.message.includes('voice room')) {
		log.category = 'voice-rooms';
	}
});

// Configuration des sauvegardes
Hooks.add('onBackupRequest', async (backup) => {
	// Inclure les données des salles vocales dans les sauvegardes
	try {
		const { SynqNativeVoiceService } = await import('./server/services/SynqNativeVoiceService');
		const activeRooms = await SynqNativeVoiceService.getActiveRooms();
		
		backup.voiceRooms = activeRooms.map(room => ({
			_id: room._id,
			name: room.name,
			description: room.description,
			channelId: room.channelId,
			roomType: room.roomType,
			settings: room.settings,
			createdAt: room.createdAt,
		}));
	} catch (error) {
		console.error('Failed to backup voice rooms:', error);
	}
});

// Configuration des restaurations
Hooks.add('onRestoreRequest', async (backup) => {
	// Restaurer les salles vocales depuis les sauvegardes
	if (backup.voiceRooms) {
		try {
			const { SynqNativeVoiceService } = await import('./server/services/SynqNativeVoiceService');
			
			for (const roomData of backup.voiceRooms) {
				await SynqNativeVoiceService.createVoiceRoom(
					roomData.channelId,
					roomData.name,
					roomData.roomType
				);
			}
		} catch (error) {
			console.error('Failed to restore voice rooms:', error);
		}
	}
});

// Configuration des migrations
Hooks.add('onMigrationRequest', async (migration) => {
	// Migrer les anciennes salles Jitsi vers les nouvelles salles vocales natives
	if (migration.from === 'jitsi' && migration.to === 'native-voice') {
		try {
			const { SynqNativeVoiceService } = await import('./server/services/SynqNativeVoiceService');
			const { Rooms } = await import('@rocket.chat/models');
			
			// Trouver toutes les salles avec des données Jitsi
			const jitsiRooms = await Rooms.find({
				'jitsi.rooms': { $exists: true }
			}).toArray();
			
			// Migrer vers les salles vocales natives
			for (const room of jitsiRooms) {
				if (room.jitsi?.rooms) {
					for (const [roomId, jitsiRoom] of Object.entries(room.jitsi.rooms)) {
						await SynqNativeVoiceService.createVoiceRoom(
							room._id,
							jitsiRoom.name,
							jitsiRoom.roomType || 'voice'
						);
					}
				}
			}
			
			migration.status = 'completed';
		} catch (error) {
			console.error('Failed to migrate Jitsi rooms:', error);
			migration.status = 'failed';
			migration.error = error.message;
		}
	}
});

export default {
	SynqNativeVoiceService,
	createSynqNativeVoiceSettings,
	createSynqJitsiSettings,
};
