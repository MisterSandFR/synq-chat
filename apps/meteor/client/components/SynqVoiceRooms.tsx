import { Box, Card, CardBody, CardHeader, CardTitle, Button, ButtonGroup, Badge, Icon, Field, FieldGroup, FieldLabel, FieldRow, FieldHint } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import { useState, useCallback, useEffect } from 'react';

interface VoiceRoom {
	id: string;
	name: string;
	description: string;
	channelId?: string;
	participants: Array<{
		userId: string;
		username: string;
		avatar: string;
		isMuted: boolean;
		isDeafened: boolean;
		isSpeaking: boolean;
	}>;
	isActive: boolean;
	userLimit: number;
	createdAt: Date;
	lastActivity: Date;
}

interface SynqVoiceRoomsProps {
	rooms: VoiceRoom[];
	onJoinRoom: (roomId: string) => void;
	onLeaveRoom: (roomId: string) => void;
	onCreateRoom: (room: Omit<VoiceRoom, 'id' | 'participants' | 'createdAt' | 'lastActivity'>) => void;
	onDeleteRoom: (roomId: string) => void;
	currentRoom?: string;
}

const SynqVoiceRooms = ({
	rooms,
	onJoinRoom,
	onLeaveRoom,
	onCreateRoom,
	onDeleteRoom,
	currentRoom,
}: SynqVoiceRoomsProps): ReactElement => {
	const { t } = useTranslation();
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [editingRoom, setEditingRoom] = useState<string | null>(null);

	const handleJoinRoom = useCallback((roomId: string) => {
		if (currentRoom === roomId) {
			onLeaveRoom(roomId);
		} else {
			onJoinRoom(roomId);
		}
	}, [currentRoom, onJoinRoom, onLeaveRoom]);

	const handleCreateRoom = useCallback((roomData: Omit<VoiceRoom, 'id' | 'participants' | 'createdAt' | 'lastActivity'>) => {
		onCreateRoom(roomData);
		setShowCreateForm(false);
	}, [onCreateRoom]);

	const handleDeleteRoom = useCallback((roomId: string) => {
		if (confirm(t('Are_you_sure_delete_voice_room'))) {
			onDeleteRoom(roomId);
		}
	}, [onDeleteRoom, t]);

	return (
		<Box style={{ padding: '1rem' }}>
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Voice_Rooms')}</CardTitle>
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
					<Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
						{rooms.map((room) => (
							<Card
								key={room.id}
								variant={currentRoom === room.id ? 'primary' : 'secondary'}
								style={{
									cursor: 'pointer',
									border: currentRoom === room.id ? '2px solid #1d74f5' : '1px solid #ddd',
									backgroundColor: currentRoom === room.id ? '#1d74f510' : undefined,
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
									</CardTitle>
								</CardHeader>
								<CardBody>
									<p style={{ marginBottom: '1rem', color: '#666' }}>
										{room.description}
									</p>
									<Box style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
										<Badge variant='secondary'>
											{t('Participants')}: {room.participants.length}/{room.userLimit}
										</Badge>
										<Badge variant={room.isActive ? 'success' : 'secondary'}>
											{room.isActive ? t('Active') : t('Inactive')}
										</Badge>
									</Box>
									<Box style={{ marginBottom: '1rem' }}>
										{room.participants.map((participant) => (
											<Box
												key={participant.userId}
												style={{
													display: 'flex',
													alignItems: 'center',
													padding: '0.25rem',
													marginBottom: '0.25rem',
													backgroundColor: participant.isSpeaking ? '#1d74f520' : undefined,
													borderRadius: '4px',
												}}
											>
												<img
													src={participant.avatar}
													alt={participant.username}
													style={{
														width: '24px',
														height: '24px',
														borderRadius: '50%',
														marginRight: '0.5rem',
													}}
												/>
												<Box style={{ flex: 1 }}>
													{participant.username}
												</Box>
												<Box style={{ display: 'flex', gap: '0.25rem' }}>
													{participant.isMuted && (
														<Icon name='microphone-off' size='x16' color='danger' />
													)}
													{participant.isDeafened && (
														<Icon name='volume-off' size='x16' color='warning' />
													)}
													{participant.isSpeaking && (
														<Icon name='microphone' size='x16' color='success' />
													)}
												</Box>
											</Box>
										))}
									</Box>
									<ButtonGroup>
										<Button
											variant={currentRoom === room.id ? 'danger' : 'primary'}
											icon={currentRoom === room.id ? 'phone-off' : 'phone'}
											onClick={() => handleJoinRoom(room.id)}
										>
											{currentRoom === room.id ? t('Leave') : t('Join')}
										</Button>
										<Button
											size='x16'
											icon='edit'
											onClick={() => setEditingRoom(room.id)}
										/>
										<Button
											size='x16'
											icon='trash'
											onClick={() => handleDeleteRoom(room.id)}
										/>
									</ButtonGroup>
								</CardBody>
							</Card>
						))}
					</Box>
				</CardBody>
			</Card>

			{showCreateForm && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>{t('Create_New_Voice_Room')}</CardTitle>
					</CardHeader>
					<CardBody>
						<CreateVoiceRoomForm
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
						<EditVoiceRoomForm
							room={rooms.find(r => r.id === editingRoom)!}
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

interface CreateVoiceRoomFormProps {
	onCreate: (room: Omit<VoiceRoom, 'id' | 'participants' | 'createdAt' | 'lastActivity'>) => void;
	onCancel: () => void;
}

const CreateVoiceRoomForm = ({ onCreate, onCancel }: CreateVoiceRoomFormProps): ReactElement => {
	const { t } = useTranslation();
	const [roomData, setRoomData] = useState<Omit<VoiceRoom, 'id' | 'participants' | 'createdAt' | 'lastActivity'>>({
		name: '',
		description: '',
		channelId: undefined,
		isActive: false,
		userLimit: 10,
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
						<input
							type='text'
							value={roomData.name}
							onChange={(e) => setRoomData(prev => ({ ...prev, name: e.target.value }))}
							placeholder={t('Enter_room_name')}
							required
							style={{
								width: '100%',
								padding: '0.5rem',
								border: '1px solid #ddd',
								borderRadius: '4px',
							}}
						/>
					</FieldRow>
				</Field>

				<Field>
					<FieldLabel>{t('Description')}</FieldLabel>
					<FieldRow>
						<textarea
							value={roomData.description}
							onChange={(e) => setRoomData(prev => ({ ...prev, description: e.target.value }))}
							placeholder={t('Enter_room_description')}
							style={{
								width: '100%',
								padding: '0.5rem',
								border: '1px solid #ddd',
								borderRadius: '4px',
								minHeight: '60px',
							}}
						/>
					</FieldRow>
				</Field>

				<Field>
					<FieldLabel>{t('User_Limit')}</FieldLabel>
					<FieldRow>
						<input
							type='number'
							value={roomData.userLimit}
							onChange={(e) => setRoomData(prev => ({ ...prev, userLimit: parseInt(e.target.value) || 10 }))}
							min='1'
							max='50'
							style={{
								width: '100%',
								padding: '0.5rem',
								border: '1px solid #ddd',
								borderRadius: '4px',
							}}
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

interface EditVoiceRoomFormProps {
	room: VoiceRoom;
	onUpdate: (roomId: string, room: Partial<VoiceRoom>) => void;
	onCancel: () => void;
}

const EditVoiceRoomForm = ({ room, onUpdate, onCancel }: EditVoiceRoomFormProps): ReactElement => {
	const { t } = useTranslation();
	const [roomData, setRoomData] = useState<Partial<VoiceRoom>>(room);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onUpdate(room.id, roomData);
	};

	return (
		<form onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel>{t('Room_Name')}</FieldLabel>
					<FieldRow>
						<input
							type='text'
							value={roomData.name || ''}
							onChange={(e) => setRoomData(prev => ({ ...prev, name: e.target.value }))}
							placeholder={t('Enter_room_name')}
							required
							style={{
								width: '100%',
								padding: '0.5rem',
								border: '1px solid #ddd',
								borderRadius: '4px',
							}}
						/>
					</FieldRow>
				</Field>

				<Field>
					<FieldLabel>{t('Description')}</FieldLabel>
					<FieldRow>
						<textarea
							value={roomData.description || ''}
							onChange={(e) => setRoomData(prev => ({ ...prev, description: e.target.value }))}
							placeholder={t('Enter_room_description')}
							style={{
								width: '100%',
								padding: '0.5rem',
								border: '1px solid #ddd',
								borderRadius: '4px',
								minHeight: '60px',
							}}
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

export default SynqVoiceRooms;
