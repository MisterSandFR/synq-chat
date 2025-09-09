import { Box, Card, CardBody, CardHeader, CardTitle, Button, ButtonGroup, Badge, Icon, Field, FieldGroup, FieldLabel, FieldRow, FieldHint, Table, TableHead, TableBody, TableRow, TableCell, Callout } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import { useState, useCallback } from 'react';

interface ReadOnlyChannel {
	id: string;
	name: string;
	description: string;
	type: 'announcement' | 'qa' | 'readonly';
	permissions: {
		canWrite: string[];
		canModerate: string[];
		canRead: string[];
	};
	qaSettings?: {
		questionTypes: string[];
		moderation: boolean;
		notifications: boolean;
	};
	announcementSettings?: {
		template: string;
		formatting: boolean;
		autoPin: boolean;
	};
	features: {
		reactions: boolean;
		threads: boolean;
		share: boolean;
		bookmarks: boolean;
	};
	messageCount: number;
	lastActivity: Date;
}

interface Question {
	id: string;
	text: string;
	author: {
		userId: string;
		username: string;
		avatar: string;
	};
	createdAt: Date;
	answers: Array<{
		id: string;
		text: string;
		author: {
			userId: string;
			username: string;
			avatar: string;
		};
		createdAt: Date;
		isAccepted: boolean;
	}>;
	status: 'open' | 'answered' | 'closed';
	tags: string[];
}

interface SynqReadOnlyChannelsProps {
	channels: ReadOnlyChannel[];
	questions: Question[];
	onCreateChannel: (channel: Omit<ReadOnlyChannel, 'id' | 'messageCount' | 'lastActivity'>) => void;
	onUpdateChannel: (channelId: string, channel: Partial<ReadOnlyChannel>) => void;
	onDeleteChannel: (channelId: string) => void;
	onAskQuestion: (channelId: string, question: Omit<Question, 'id' | 'author' | 'createdAt' | 'answers'>) => void;
	onAnswerQuestion: (questionId: string, answer: Omit<Question['answers'][0], 'id' | 'author' | 'createdAt'>) => void;
}

const SynqReadOnlyChannels = ({
	channels,
	questions,
	onCreateChannel,
	onUpdateChannel,
	onDeleteChannel,
	onAskQuestion,
	onAnswerQuestion,
}: SynqReadOnlyChannelsProps): ReactElement => {
	const { t } = useTranslation();
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [editingChannel, setEditingChannel] = useState<string | null>(null);
	const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
	const [showQuestionForm, setShowQuestionForm] = useState(false);

	const handleCreateChannel = useCallback((channelData: Omit<ReadOnlyChannel, 'id' | 'messageCount' | 'lastActivity'>) => {
		onCreateChannel(channelData);
		setShowCreateForm(false);
	}, [onCreateChannel]);

	const handleDeleteChannel = useCallback((channelId: string) => {
		if (confirm(t('Are_you_sure_delete_channel'))) {
			onDeleteChannel(channelId);
		}
	}, [onDeleteChannel, t]);

	const handleAskQuestion = useCallback((questionData: Omit<Question, 'id' | 'author' | 'createdAt' | 'answers'>) => {
		if (selectedChannel) {
			onAskQuestion(selectedChannel, questionData);
			setShowQuestionForm(false);
		}
	}, [selectedChannel, onAskQuestion]);

	const channelQuestions = selectedChannel ? questions.filter(q => q.id.startsWith(selectedChannel)) : [];

	return (
		<Box style={{ padding: '1rem' }}>
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Read_Only_Channels')}</CardTitle>
					<ButtonGroup>
						<Button
							variant='primary'
							icon='plus'
							onClick={() => setShowCreateForm(true)}
						>
							{t('Create_Channel')}
						</Button>
					</ButtonGroup>
				</CardHeader>
				<CardBody>
					<Table>
						<TableHead>
							<TableRow>
								<TableCell>{t('Name')}</TableCell>
								<TableCell>{t('Type')}</TableCell>
								<TableCell>{t('Permissions')}</TableCell>
								<TableCell>{t('Messages')}</TableCell>
								<TableCell>{t('Last_Activity')}</TableCell>
								<TableCell>{t('Actions')}</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{channels.map((channel) => (
								<TableRow key={channel.id}>
									<TableCell>
										<Box style={{ display: 'flex', alignItems: 'center' }}>
											<Icon name='lock' size='x16' style={{ marginRight: '0.5rem' }} />
											<Box>
												<Box style={{ fontWeight: 'bold' }}>{channel.name}</Box>
												<Box style={{ fontSize: '0.875rem', color: '#666' }}>
													{channel.description}
												</Box>
											</Box>
										</Box>
									</TableCell>
									<TableCell>
										<Badge variant='secondary'>
											{t(channel.type)}
										</Badge>
									</TableCell>
									<TableCell>
										<Box style={{ fontSize: '0.875rem' }}>
											{t('Write')}: {channel.permissions.canWrite.length}
										</Box>
										<Box style={{ fontSize: '0.875rem' }}>
											{t('Moderate')}: {channel.permissions.canModerate.length}
										</Box>
									</TableCell>
									<TableCell>
										<Badge variant='primary'>
											{channel.messageCount}
										</Badge>
									</TableCell>
									<TableCell>
										<Box style={{ fontSize: '0.875rem' }}>
											{new Date(channel.lastActivity).toLocaleDateString()}
										</Box>
									</TableCell>
									<TableCell>
										<ButtonGroup>
											<Button
												size='x16'
												icon='eye'
												onClick={() => setSelectedChannel(channel.id)}
											/>
											<Button
												size='x16'
												icon='edit'
												onClick={() => setEditingChannel(channel.id)}
											/>
											<Button
												size='x16'
												icon='trash'
												onClick={() => handleDeleteChannel(channel.id)}
											/>
										</ButtonGroup>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardBody>
			</Card>

			{selectedChannel && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>
							{t('Channel')}: {channels.find(c => c.id === selectedChannel)?.name}
						</CardTitle>
						<ButtonGroup>
							<Button
								variant='primary'
								icon='plus'
								onClick={() => setShowQuestionForm(true)}
							>
								{t('Ask_Question')}
							</Button>
						</ButtonGroup>
					</CardHeader>
					<CardBody>
						{channelQuestions.length === 0 ? (
							<Callout type='info'>
								{t('No_questions_yet')}
							</Callout>
						) : (
							<Box>
								{channelQuestions.map((question) => (
									<Card key={question.id} marginBlockEnd={16}>
										<CardBody>
											<Box marginBlockEnd={8}>
												<Box style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
													{question.text}
												</Box>
												<Box style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
													<img
														src={question.author.avatar}
														alt={question.author.username}
														style={{
															width: '20px',
															height: '20px',
															borderRadius: '50%',
															marginRight: '0.5rem',
														}}
													/>
													<Box style={{ fontSize: '0.875rem', color: '#666' }}>
														{question.author.username} • {new Date(question.createdAt).toLocaleDateString()}
													</Box>
												</Box>
												<Box style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
													{question.tags.map((tag) => (
														<Badge key={tag} variant='secondary'>
															{tag}
														</Badge>
													))}
												</Box>
											</Box>
											{question.answers.length > 0 && (
												<Box marginBlockStart={16}>
													<FieldLabel>{t('Answers')}</FieldLabel>
													{question.answers.map((answer) => (
														<Box key={answer.id} marginBlockEnd={8} style={{ padding: '0.5rem', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
															<Box style={{ display: 'flex', alignItems: 'center', marginBottom: '0.5rem' }}>
																<img
																	src={answer.author.avatar}
																	alt={answer.author.username}
																	style={{
																		width: '20px',
																		height: '20px',
																		borderRadius: '50%',
																		marginRight: '0.5rem',
																	}}
																/>
																<Box style={{ fontSize: '0.875rem', color: '#666' }}>
																	{answer.author.username} • {new Date(answer.createdAt).toLocaleDateString()}
																	{answer.isAccepted && (
																		<Badge variant='success' style={{ marginLeft: '0.5rem' }}>
																			{t('Accepted')}
																		</Badge>
																	)}
																</Box>
															</Box>
															<Box>{answer.text}</Box>
														</Box>
													))}
												</Box>
											)}
										</CardBody>
									</Card>
								))}
							</Box>
						)}
					</CardBody>
				</Card>
			)}

			{showCreateForm && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>{t('Create_New_Channel')}</CardTitle>
					</CardHeader>
					<CardBody>
						<CreateChannelForm
							onCreate={handleCreateChannel}
							onCancel={() => setShowCreateForm(false)}
						/>
					</CardBody>
				</Card>
			)}

			{showQuestionForm && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>{t('Ask_Question')}</CardTitle>
					</CardHeader>
					<CardBody>
						<AskQuestionForm
							onAsk={handleAskQuestion}
							onCancel={() => setShowQuestionForm(false)}
						/>
					</CardBody>
				</Card>
			)}
		</Box>
	);
};

interface CreateChannelFormProps {
	onCreate: (channel: Omit<ReadOnlyChannel, 'id' | 'messageCount' | 'lastActivity'>) => void;
	onCancel: () => void;
}

const CreateChannelForm = ({ onCreate, onCancel }: CreateChannelFormProps): ReactElement => {
	const { t } = useTranslation();
	const [channelData, setChannelData] = useState<Omit<ReadOnlyChannel, 'id' | 'messageCount' | 'lastActivity'>>({
		name: '',
		description: '',
		type: 'readonly',
		permissions: {
			canWrite: [],
			canModerate: [],
			canRead: [],
		},
		features: {
			reactions: true,
			threads: true,
			share: true,
			bookmarks: true,
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (channelData.name.trim()) {
			onCreate(channelData);
		}
	};

	return (
		<form onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel>{t('Channel_Name')}</FieldLabel>
					<FieldRow>
						<input
							type='text'
							value={channelData.name}
							onChange={(e) => setChannelData(prev => ({ ...prev, name: e.target.value }))}
							placeholder={t('Enter_channel_name')}
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
							value={channelData.description}
							onChange={(e) => setChannelData(prev => ({ ...prev, description: e.target.value }))}
							placeholder={t('Enter_channel_description')}
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
					<FieldLabel>{t('Channel_Type')}</FieldLabel>
					<FieldRow>
						<select
							value={channelData.type}
							onChange={(e) => setChannelData(prev => ({ ...prev, type: e.target.value as ReadOnlyChannel['type'] }))}
							style={{
								width: '100%',
								padding: '0.5rem',
								border: '1px solid #ddd',
								borderRadius: '4px',
							}}
						>
							<option value='readonly'>{t('Read_Only')}</option>
							<option value='announcement'>{t('Announcement')}</option>
							<option value='qa'>{t('Q_A')}</option>
						</select>
					</FieldRow>
				</Field>

				<Field>
					<FieldRow>
						<ButtonGroup>
							<Button type='submit' primary>
								{t('Create_Channel')}
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

interface AskQuestionFormProps {
	onAsk: (question: Omit<Question, 'id' | 'author' | 'createdAt' | 'answers'>) => void;
	onCancel: () => void;
}

const AskQuestionForm = ({ onAsk, onCancel }: AskQuestionFormProps): ReactElement => {
	const { t } = useTranslation();
	const [questionData, setQuestionData] = useState<Omit<Question, 'id' | 'author' | 'createdAt' | 'answers'>>({
		text: '',
		status: 'open',
		tags: [],
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (questionData.text.trim()) {
			onAsk(questionData);
		}
	};

	return (
		<form onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel>{t('Question')}</FieldLabel>
					<FieldRow>
						<textarea
							value={questionData.text}
							onChange={(e) => setQuestionData(prev => ({ ...prev, text: e.target.value }))}
							placeholder={t('Enter_your_question')}
							required
							style={{
								width: '100%',
								padding: '0.5rem',
								border: '1px solid #ddd',
								borderRadius: '4px',
								minHeight: '100px',
							}}
						/>
					</FieldRow>
				</Field>

				<Field>
					<FieldLabel>{t('Tags')}</FieldLabel>
					<FieldRow>
						<input
							type='text'
							value={questionData.tags.join(', ')}
							onChange={(e) => setQuestionData(prev => ({ ...prev, tags: e.target.value.split(',').map(tag => tag.trim()).filter(tag => tag) }))}
							placeholder={t('Enter_tags_separated_by_commas')}
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
								{t('Ask_Question')}
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

export default SynqReadOnlyChannels;
