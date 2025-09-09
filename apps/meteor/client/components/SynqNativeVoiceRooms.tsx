import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Card, CardBody, CardHeader, CardTitle, Button, ButtonGroup, Badge, Icon, Field, FieldGroup, FieldLabel, FieldRow, FieldHint, TextInput, TextArea, Select } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import { useMethod } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';

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

interface SynqNativeVoiceRoomsProps {
	channelId: string;
	rooms: NativeVoiceRoom[];
	onJoinRoom: (roomId: string) => void;
	onLeaveRoom: (roomId: string) => void;
	onCreateRoom: (room: Omit<NativeVoiceRoom, '_id' | 'participants' | 'createdAt' | 'lastActivity' | 'webrtcConfig'>) => void;
	onDeleteRoom: (roomId: string) => void;
	currentRoom?: string;
}

const SynqNativeVoiceRooms = ({
	channelId,
	rooms,
	onJoinRoom,
	onLeaveRoom,
	onCreateRoom,
	onDeleteRoom,
	currentRoom,
}: SynqNativeVoiceRoomsProps): ReactElement => {
	const { t } = useTranslation();
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [editingRoom, setEditingRoom] = useState<string | null>(null);
	const [participants, setParticipants] = useState<Map<string, VoiceParticipant[]>>(new Map());

	const getChannelRooms = useMethod('synq.voice.get-channel-rooms');
	const getRoomParticipants = useMethod('synq.voice.get-room-participants');

	// Charger les participants pour chaque salle
	useEffect(() => {
		const loadParticipants = async () => {
			const participantsMap = new Map<string, VoiceParticipant[]>();
			
			for (const room of rooms) {
				try {
					const roomParticipants = await getRoomParticipants(room._id);
					participantsMap.set(room._id, roomParticipants);
				} catch (error) {
					console.error('Failed to load participants for room:', room._id, error);
				}
			}
			
			setParticipants(participantsMap);
		};

		if (rooms.length > 0) {
			loadParticipants();
		}
	}, [rooms, getRoomParticipants]);

	const handleJoinRoom = useCallback((roomId: string) => {
		if (currentRoom === roomId) {
			onLeaveRoom(roomId);
		} else {
			onJoinRoom(roomId);
		}
	}, [currentRoom, onJoinRoom, onLeaveRoom]);

	const handleCreateRoom = useCallback((roomData: Omit<NativeVoiceRoom, '_id' | 'participants' | 'createdAt' | 'lastActivity' | 'webrtcConfig'>) => {
		onCreateRoom(roomData);
		setShowCreateForm(false);
	}, [onCreateRoom]);

	const handleDeleteRoom = useCallback((roomId: string) => {
		if (confirm(t('Are_you_sure_delete_voice_room'))) {
			onDeleteRoom(roomId);
		}
	}, [onDeleteRoom, t]);

	const getConnectionStateColor = (state: RTCIceConnectionState): string => {
		switch (state) {
			case 'connected':
			case 'completed':
				return '#28a745';
			case 'connecting':
			case 'checking':
				return '#ffc107';
			case 'disconnected':
			case 'failed':
			case 'closed':
				return '#dc3545';
			default:
				return '#6c757d';
		}
	};

	const getConnectionStateText = (state: RTCIceConnectionState): string => {
		switch (state) {
			case 'connected':
			case 'completed':
				return t('Connected');
			case 'connecting':
			case 'checking':
				return t('Connecting');
			case 'disconnected':
				return t('Disconnected');
			case 'failed':
				return t('Failed');
			case 'closed':
				return t('Closed');
			default:
				return t('Unknown');
		}
	};

	return (
		<Box style={{ padding: '1rem' }}>
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>
						<Icon name='microphone' size='x20' style={{ marginRight: '0.5rem' }} />
						{t('Native_Voice_Rooms')}
					</CardTitle>
					<ButtonGroup>
						<Button
							variant='primary'
							icon='plus'
							onClick={() => setShowCreateForm(true)}
						>
							{t('Create_Voice_Room')}
						</Button>
					</ButtonGroup>
				</CardHeader>
				<CardBody>
					<Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1rem' }}>
						{rooms.map((room) => {
							const roomParticipants = participants.get(room._id) || [];
							return (
								<Card
									key={room._id}
									variant={currentRoom === room._id ? 'primary' : 'secondary'}
									style={{
										cursor: 'pointer',
										border: currentRoom === room._id ? '2px solid #1d74f5' : '1px solid #ddd',
										backgroundColor: currentRoom === room._id ? '#1d74f510' : undefined,
									}}
								>
									<CardHeader>
										<CardTitle style={{ display: 'flex', alignItems: 'center' }}>
											<Icon
												name={room.isActive ? 'microphone' : 'microphone-off'}
												size='x20'
												style={{
													marginRight: '0.5rem',
													color: room.isActive ? '#28a745' : '#dc3545',
												}}
											/>
											{room.name}
											<Badge 
												variant='secondary' 
												style={{ marginLeft: '0.5rem' }}
											>
												{room.roomType}
											</Badge>
										</CardTitle>
									</CardHeader>
									<CardBody>
										<p style={{ marginBottom: '1rem', color: '#666' }}>
											{room.description}
										</p>
										
										<Box style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
											<Badge variant='secondary'>
												{t('Participants')}: {roomParticipants.length}/{room.settings.maxParticipants}
											</Badge>
											<Badge variant={room.isActive ? 'success' : 'secondary'}>
												{room.isActive ? t('Active') : t('Inactive')}
											</Badge>
											{room.settings.encryptionEnabled && (
												<Badge variant='info'>
													<Icon name='shield' size='x12' />
													{t('Encrypted')}
												</Badge>
											)}
										</Box>

										<Box style={{ marginBottom: '1rem' }}>
											{roomParticipants.map((participant) => (
												<Box
													key={participant.userId}
													style={{
														display: 'flex',
														alignItems: 'center',
														padding: '0.5rem',
														marginBottom: '0.25rem',
														backgroundColor: participant.isScreenSharing ? '#1d74f520' : undefined,
														borderRadius: '4px',
														border: participant.isSpeaking ? '2px solid #28a745' : '1px solid #e9ecef',
													}}
												>
													<Box
														style={{
															width: '32px',
															height: '32px',
															borderRadius: '50%',
															backgroundColor: '#6c757d',
															display: 'flex',
															alignItems: 'center',
															justifyContent: 'center',
															marginRight: '0.5rem',
															color: 'white',
															fontWeight: 'bold',
														}}
													>
														{participant.username.charAt(0).toUpperCase()}
													</Box>
													<Box style={{ flex: 1 }}>
														<Box style={{ fontWeight: 'bold' }}>
															{participant.username}
															{participant.isModerator && (
																<Icon name='crown' size='x12' color='warning' style={{ marginLeft: '0.25rem' }} />
															)}
														</Box>
														<Box style={{ fontSize: '0.8rem', color: '#666' }}>
															{getConnectionStateText(participant.connectionState)}
														</Box>
													</Box>
													<Box style={{ display: 'flex', gap: '0.25rem' }}>
														{participant.isMuted && (
															<Icon name='microphone-off' size='x16' color='danger' />
														)}
														{participant.isDeafened && (
															<Icon name='volume-off' size='x16' color='warning' />
														)}
														{participant.isVideoEnabled && (
															<Icon name='video' size='x16' color='info' />
														)}
														{participant.isScreenSharing && (
															<Icon name='monitor' size='x16' color='success' />
														)}
														<Box
															style={{
																width: '8px',
																height: '8px',
																borderRadius: '50%',
																backgroundColor: getConnectionStateColor(participant.connectionState),
															}}
														/>
													</Box>
												</Box>
											))}
										</Box>

										<ButtonGroup>
											<Button
												variant={currentRoom === room._id ? 'danger' : 'primary'}
												icon={currentRoom === room._id ? 'phone-off' : 'phone'}
												onClick={() => handleJoinRoom(room._id)}
											>
												{currentRoom === room._id ? t('Leave') : t('Join')}
											</Button>
											<Button
												size='x16'
												icon='edit'
												onClick={() => setEditingRoom(room._id)}
											/>
											<Button
												size='x16'
												icon='trash'
												onClick={() => handleDeleteRoom(room._id)}
											/>
										</ButtonGroup>
									</CardBody>
								</Card>
							);
						})}
					</Box>
				</CardBody>
			</Card>

			{showCreateForm && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>{t('Create_New_Voice_Room')}</CardTitle>
					</CardHeader>
					<CardBody>
						<CreateNativeVoiceRoomForm
							channelId={channelId}
							onCreate={handleCreateRoom}
							onCancel={() => setShowCreateForm(false)}
						/>
					</CardBody>
				</Card>
			)}

			{editingRoom && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>{t('Edit_Voice_Room')}</CardTitle>
					</CardHeader>
					<CardBody>
						<EditNativeVoiceRoomForm
							room={rooms.find(r => r._id === editingRoom)!}
							onUpdate={(roomId, roomData) => {
								// TODO: Implement room update
								setEditingRoom(null);
							}}
							onCancel={() => setEditingRoom(null)}
						/>
					</CardBody>
				</Card>
			)}
		</Box>
	);
};

interface CreateNativeVoiceRoomFormProps {
	channelId: string;
	onCreate: (room: Omit<NativeVoiceRoom, '_id' | 'participants' | 'createdAt' | 'lastActivity' | 'webrtcConfig'>) => void;
	onCancel: () => void;
}

const CreateNativeVoiceRoomForm = ({ channelId, onCreate, onCancel }: CreateNativeVoiceRoomFormProps): ReactElement => {
	const { t } = useTranslation();
	const [roomData, setRoomData] = useState<Omit<NativeVoiceRoom, '_id' | 'participants' | 'createdAt' | 'lastActivity' | 'webrtcConfig'>>({
		name: '',
		description: '',
		channelId,
		isActive: false,
		roomType: 'voice',
		settings: {
			maxParticipants: 10,
			recordingEnabled: false,
			moderationEnabled: true,
			encryptionEnabled: true,
			persistent: false,
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (roomData.name.trim()) {
			onCreate(roomData);
		}
	};

	return (
		<form onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel>{t('Room_Name')}</FieldLabel>
					<FieldRow>
						<TextInput
							value={roomData.name}
							onChange={(e) => setRoomData(prev => ({ ...prev, name: e.currentTarget.value }))}
							placeholder={t('Enter_room_name')}
							required
						/>
					</FieldRow>
				</Field>

				<Field>
					<FieldLabel>{t('Description')}</FieldLabel>
					<FieldRow>
						<TextArea
							value={roomData.description}
							onChange={(e) => setRoomData(prev => ({ ...prev, description: e.currentTarget.value }))}
							placeholder={t('Enter_room_description')}
							rows={3}
						/>
					</FieldRow>
				</Field>

				<Field>
					<FieldLabel>{t('Room_Type')}</FieldLabel>
					<FieldRow>
						<Select
							value={roomData.roomType}
							onChange={(value) => setRoomData(prev => ({ ...prev, roomType: value as 'voice' | 'video' | 'conference' }))}
							options={[
								{ value: 'voice', label: t('Voice_Only') },
								{ value: 'video', label: t('Video_Call') },
								{ value: 'conference', label: t('Conference') },
							]}
						/>
					</FieldRow>
				</Field>

				<Field>
					<FieldLabel>{t('Max_Participants')}</FieldLabel>
					<FieldRow>
						<TextInput
							type='number'
							value={roomData.settings.maxParticipants}
							onChange={(e) => setRoomData(prev => ({ 
								...prev, 
								settings: { 
									...prev.settings, 
									maxParticipants: parseInt(e.currentTarget.value) || 10 
								}
							}))}
							min='1'
							max='100'
						/>
					</FieldRow>
				</Field>

				<Field>
					<FieldRow>
						<ButtonGroup>
							<Button type='submit' primary>
								{t('Create_Room')}
							</Button>
							<Button onClick={onCancel}>
								{t('Cancel')}
							</Button>
						</ButtonGroup>
					</FieldRow>
				</Field>
			</FieldGroup>
		</form>
	);
};

interface EditNativeVoiceRoomFormProps {
	room: NativeVoiceRoom;
	onUpdate: (roomId: string, room: Partial<NativeVoiceRoom>) => void;
	onCancel: () => void;
}

const EditNativeVoiceRoomForm = ({ room, onUpdate, onCancel }: EditNativeVoiceRoomFormProps): ReactElement => {
	const { t } = useTranslation();
	const [roomData, setRoomData] = useState<Partial<NativeVoiceRoom>>(room);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onUpdate(room._id, roomData);
	};

	return (
		<form onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel>{t('Room_Name')}</FieldLabel>
					<FieldRow>
						<TextInput
							value={roomData.name || ''}
							onChange={(e) => setRoomData(prev => ({ ...prev, name: e.currentTarget.value }))}
							placeholder={t('Enter_room_name')}
							required
						/>
					</FieldRow>
				</Field>

				<Field>
					<FieldLabel>{t('Description')}</FieldLabel>
					<FieldRow>
						<TextArea
							value={roomData.description || ''}
							onChange={(e) => setRoomData(prev => ({ ...prev, description: e.currentTarget.value }))}
							placeholder={t('Enter_room_description')}
							rows={3}
						/>
					</FieldRow>
				</Field>

				<Field>
					<FieldRow>
						<ButtonGroup>
							<Button type='submit' primary>
								{t('Update_Room')}
							</Button>
							<Button onClick={onCancel}>
								{t('Cancel')}
							</Button>
						</ButtonGroup>
					</FieldRow>
				</Field>
			</FieldGroup>
		</form>
	);
};

export default SynqNativeVoiceRooms;
