import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Card, CardBody, CardHeader, CardTitle, Button, ButtonGroup, Badge, Icon, Field, FieldGroup, FieldLabel, FieldRow, TextInput, TextArea } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import { useMethod } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';

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

interface NativeVoiceRoomInterfaceProps {
	roomId: string;
	participantId: string;
	userInfo: {
		displayName: string;
		email?: string;
		avatar?: string;
	};
	webrtcConfig: {
		iceServers: RTCIceServer[];
		enableScreenShare: boolean;
		enableChat: boolean;
	};
	onLeaveRoom: () => void;
}

const NativeVoiceRoomInterface = ({
	roomId,
	participantId,
	userInfo,
	webrtcConfig,
	onLeaveRoom,
}: NativeVoiceRoomInterfaceProps): ReactElement => {
	const { t } = useTranslation();
	
	// États locaux
	const [isConnected, setIsConnected] = useState(false);
	const [isMuted, setIsMuted] = useState(false);
	const [isDeafened, setIsDeafened] = useState(false);
	const [isVideoEnabled, setIsVideoEnabled] = useState(false);
	const [isScreenSharing, setIsScreenSharing] = useState(false);
	const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
	const [chatMessages, setChatMessages] = useState<Array<{ id: string; user: string; message: string; timestamp: Date }>>([]);
	const [newMessage, setNewMessage] = useState('');
	const [showChat, setShowChat] = useState(true);
	const [connectionQuality, setConnectionQuality] = useState<'excellent' | 'good' | 'fair' | 'poor'>('excellent');

	// Références pour les éléments média
	const localVideoRef = useRef<HTMLVideoElement>(null);
	const localAudioRef = useRef<HTMLAudioElement>(null);
	const remoteVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
	const remoteAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());

	// Références WebRTC
	const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
	const localStreamRef = useRef<MediaStream | null>(null);
	const screenStreamRef = useRef<MediaStream | null>(null);

	// Méthodes Meteor
	const getRoomParticipants = useMethod('synq.voice.get-room-participants');
	const toggleMute = useMethod('synq.voice.toggle-mute');
	const toggleVideo = useMethod('synq.voice.toggle-video');
	const toggleScreenShare = useMethod('synq.voice.toggle-screen-share');

	// Initialisation de la connexion WebRTC
	useEffect(() => {
		initializeWebRTC();
		return () => {
			cleanup();
		};
	}, []);

	const initializeWebRTC = async () => {
		try {
			// Obtenir le flux média local
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: true,
				video: true,
			});

			localStreamRef.current = stream;

			// Configurer l'élément vidéo local
			if (localVideoRef.current) {
				localVideoRef.current.srcObject = stream;
			}

			// Configurer l'élément audio local
			if (localAudioRef.current) {
				localAudioRef.current.srcObject = stream;
			}

			setIsConnected(true);
			await loadParticipants();

			// Démarrer la surveillance de la qualité de connexion
			startConnectionQualityMonitoring();

		} catch (error) {
			console.error('Failed to initialize WebRTC:', error);
		}
	};

	const cleanup = () => {
		// Arrêter tous les flux média
		if (localStreamRef.current) {
			localStreamRef.current.getTracks().forEach(track => track.stop());
		}
		if (screenStreamRef.current) {
			screenStreamRef.current.getTracks().forEach(track => track.stop());
		}

		// Fermer toutes les connexions peer
		peerConnectionsRef.current.forEach(connection => {
			connection.close();
		});
		peerConnectionsRef.current.clear();
	};

	const loadParticipants = async () => {
		try {
			const roomParticipants = await getRoomParticipants(roomId);
			setParticipants(roomParticipants);
		} catch (error) {
			console.error('Failed to load participants:', error);
		}
	};

	const startConnectionQualityMonitoring = () => {
		const monitor = setInterval(() => {
			// Simuler la surveillance de la qualité de connexion
			// Dans une implémentation réelle, cela utiliserait les statistiques WebRTC
			const quality = Math.random();
			if (quality > 0.8) {
				setConnectionQuality('excellent');
			} else if (quality > 0.6) {
				setConnectionQuality('good');
			} else if (quality > 0.4) {
				setConnectionQuality('fair');
			} else {
				setConnectionQuality('poor');
			}
		}, 5000);

		return () => clearInterval(monitor);
	};

	const handleToggleMute = async () => {
		try {
			const newMutedState = !isMuted;
			setIsMuted(newMutedState);

			// Mettre à jour le flux local
			if (localStreamRef.current) {
				localStreamRef.current.getAudioTracks().forEach(track => {
					track.enabled = !newMutedState;
				});
			}

			// Notifier le serveur
			await toggleMute(roomId, participantId, newMutedState);
		} catch (error) {
			console.error('Failed to toggle mute:', error);
		}
	};

	const handleToggleVideo = async () => {
		try {
			const newVideoState = !isVideoEnabled;
			setIsVideoEnabled(newVideoState);

			// Mettre à jour le flux local
			if (localStreamRef.current) {
				localStreamRef.current.getVideoTracks().forEach(track => {
					track.enabled = newVideoState;
				});
			}

			// Notifier le serveur
			await toggleVideo(roomId, participantId, newVideoState);
		} catch (error) {
			console.error('Failed to toggle video:', error);
		}
	};

	const handleToggleScreenShare = async () => {
		try {
			if (isScreenSharing) {
				// Arrêter le partage d'écran
				if (screenStreamRef.current) {
					screenStreamRef.current.getTracks().forEach(track => track.stop());
					screenStreamRef.current = null;
				}
				setIsScreenSharing(false);
			} else {
				// Démarrer le partage d'écran
				const screenStream = await navigator.mediaDevices.getDisplayMedia({
					video: true,
					audio: true,
				});

				screenStreamRef.current = screenStream;

				// Remplacer le flux vidéo par le flux d'écran
				if (localVideoRef.current) {
					localVideoRef.current.srcObject = screenStream;
				}

				setIsScreenSharing(true);

				// Gérer l'arrêt du partage d'écran
				screenStream.getVideoTracks()[0].onended = () => {
					handleToggleScreenShare();
				};
			}

			// Notifier le serveur
			await toggleScreenShare(roomId, participantId, !isScreenSharing);
		} catch (error) {
			console.error('Failed to toggle screen share:', error);
		}
	};

	const handleSendMessage = () => {
		if (newMessage.trim()) {
			const message = {
				id: Date.now().toString(),
				user: userInfo.displayName,
				message: newMessage.trim(),
				timestamp: new Date(),
			};

			setChatMessages(prev => [...prev, message]);
			setNewMessage('');
		}
	};

	const getConnectionQualityColor = (quality: string): string => {
		switch (quality) {
			case 'excellent':
				return '#28a745';
			case 'good':
				return '#17a2b8';
			case 'fair':
				return '#ffc107';
			case 'poor':
				return '#dc3545';
			default:
				return '#6c757d';
		}
	};

	return (
		<Box style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
			{/* En-tête */}
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle style={{ display: 'flex', alignItems: 'center' }}>
						<Icon name='microphone' size='x20' style={{ marginRight: '0.5rem' }} />
						{t('Voice_Room')}
						<Badge 
							variant='success' 
							style={{ marginLeft: '0.5rem' }}
						>
							{participants.length} {t('participants')}
						</Badge>
						<Box
							style={{
								width: '8px',
								height: '8px',
								borderRadius: '50%',
								backgroundColor: getConnectionQualityColor(connectionQuality),
								marginLeft: '0.5rem',
							}}
							title={t('Connection_Quality') + ': ' + connectionQuality}
						/>
					</CardTitle>
					<ButtonGroup>
						<Button
							variant='danger'
							icon='phone-off'
							onClick={onLeaveRoom}
						>
							{t('Leave_Room')}
						</Button>
					</ButtonGroup>
				</CardHeader>
			</Card>

			<Box style={{ display: 'flex', flex: 1, gap: '1rem' }}>
				{/* Zone principale - Vidéos */}
				<Box style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
					<Card style={{ flex: 1 }}>
						<CardBody>
							<Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', height: '100%' }}>
								{/* Vidéo locale */}
								<Box style={{ position: 'relative' }}>
									<video
										ref={localVideoRef}
										autoPlay
										muted
										style={{
											width: '100%',
											height: '150px',
											objectFit: 'cover',
											borderRadius: '8px',
											backgroundColor: '#000',
										}}
									/>
									<Box style={{ 
										position: 'absolute', 
										bottom: '0.5rem', 
										left: '0.5rem',
										backgroundColor: 'rgba(0,0,0,0.7)',
										color: 'white',
										padding: '0.25rem 0.5rem',
										borderRadius: '4px',
										fontSize: '0.8rem',
									}}>
										{userInfo.displayName} {t('(You)')}
									</Box>
									{isMuted && (
										<Icon 
											name='microphone-off' 
											size='x20' 
											color='danger'
											style={{ 
												position: 'absolute', 
												top: '0.5rem', 
												right: '0.5rem',
												backgroundColor: 'rgba(0,0,0,0.7)',
												borderRadius: '50%',
												padding: '0.25rem',
											}}
										/>
									)}
									{isScreenSharing && (
										<Icon 
											name='monitor' 
											size='x20' 
											color='success'
											style={{ 
												position: 'absolute', 
												top: '0.5rem', 
												left: '0.5rem',
												backgroundColor: 'rgba(0,0,0,0.7)',
												borderRadius: '50%',
												padding: '0.25rem',
											}}
										/>
									)}
								</Box>

								{/* Vidéos des participants */}
								{participants.map((participant) => (
									<Box key={participant.userId} style={{ position: 'relative' }}>
										<video
											ref={(el) => {
												if (el) {
													remoteVideosRef.current.set(participant.userId, el);
												}
											}}
											autoPlay
											style={{
												width: '100%',
												height: '150px',
												objectFit: 'cover',
												borderRadius: '8px',
												backgroundColor: '#000',
											}}
										/>
										<Box style={{ 
											position: 'absolute', 
											bottom: '0.5rem', 
											left: '0.5rem',
											backgroundColor: 'rgba(0,0,0,0.7)',
											color: 'white',
											padding: '0.25rem 0.5rem',
											borderRadius: '4px',
											fontSize: '0.8rem',
										}}>
											{participant.username}
											{participant.isModerator && (
												<Icon name='crown' size='x12' color='warning' style={{ marginLeft: '0.25rem' }} />
											)}
										</Box>
										{participant.isMuted && (
											<Icon 
												name='microphone-off' 
												size='x20' 
												color='danger'
												style={{ 
													position: 'absolute', 
													top: '0.5rem', 
													right: '0.5rem',
													backgroundColor: 'rgba(0,0,0,0.7)',
													borderRadius: '50%',
													padding: '0.25rem',
												}}
											/>
										)}
										{participant.isScreenSharing && (
											<Icon 
												name='monitor' 
												size='x20' 
												color='success'
												style={{ 
													position: 'absolute', 
													top: '0.5rem', 
													left: '0.5rem',
													backgroundColor: 'rgba(0,0,0,0.7)',
													borderRadius: '50%',
													padding: '0.25rem',
												}}
											/>
										)}
									</Box>
								))}
							</Box>
						</CardBody>
					</Card>

					{/* Contrôles */}
					<Card marginBlockStart={16}>
						<CardBody>
							<Box style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
								<Button
									variant={isMuted ? 'danger' : 'secondary'}
									icon={isMuted ? 'microphone-off' : 'microphone'}
									onClick={handleToggleMute}
									size='large'
								>
									{isMuted ? t('Unmute') : t('Mute')}
								</Button>

								<Button
									variant={isVideoEnabled ? 'secondary' : 'danger'}
									icon={isVideoEnabled ? 'video' : 'video-off'}
									onClick={handleToggleVideo}
									size='large'
								>
									{isVideoEnabled ? t('Turn_Off_Video') : t('Turn_On_Video')}
								</Button>

								{webrtcConfig.enableScreenShare && (
									<Button
										variant={isScreenSharing ? 'success' : 'secondary'}
										icon='monitor'
										onClick={handleToggleScreenShare}
										size='large'
									>
										{isScreenSharing ? t('Stop_Sharing') : t('Share_Screen')}
									</Button>
								)}

								<Button
									variant='secondary'
									icon={showChat ? 'chat' : 'chat-off'}
									onClick={() => setShowChat(!showChat)}
									size='large'
								>
									{showChat ? t('Hide_Chat') : t('Show_Chat')}
								</Button>
							</Box>
						</CardBody>
					</Card>
				</Box>

				{/* Chat latéral */}
				{showChat && webrtcConfig.enableChat && (
					<Box style={{ width: '300px' }}>
						<Card style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
							<CardHeader>
								<CardTitle>{t('Chat')}</CardTitle>
							</CardHeader>
							<CardBody style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
								{/* Messages */}
								<Box style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem' }}>
									{chatMessages.map((message) => (
										<Box key={message.id} style={{ marginBottom: '0.5rem' }}>
											<Box style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>
												{message.user}
											</Box>
											<Box style={{ fontSize: '0.8rem', color: '#666' }}>
												{message.message}
											</Box>
										</Box>
									))}
								</Box>

								{/* Input de message */}
								<FieldGroup>
									<Field>
										<FieldRow>
											<TextInput
												value={newMessage}
												onChange={(e) => setNewMessage(e.currentTarget.value)}
												placeholder={t('Type_a_message')}
												onKeyPress={(e) => {
													if (e.key === 'Enter') {
														handleSendMessage();
													}
												}}
											/>
										</FieldRow>
									</Field>
									<Field>
										<FieldRow>
											<Button onClick={handleSendMessage} primary>
												{t('Send')}
											</Button>
										</FieldRow>
									</Field>
								</FieldGroup>
							</CardBody>
						</Card>
					</Box>
				)}
			</Box>
		</Box>
	);
};

export default NativeVoiceRoomInterface;
