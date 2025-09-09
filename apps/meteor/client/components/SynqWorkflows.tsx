import { Box, Card, CardBody, CardHeader, CardTitle, Button, ButtonGroup, Badge, Icon, Field, FieldGroup, FieldLabel, FieldRow, FieldHint, Table, TableHead, TableBody, TableRow, TableCell, ProgressBar } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import { useState, useCallback } from 'react';

interface Workflow {
	id: string;
	name: string;
	description: string;
	trigger: {
		type: 'message' | 'user' | 'channel' | 'time';
		condition: string;
		value: any;
	};
	actions: Array<{
		type: string;
		config: any;
		order: number;
	}>;
	status: 'active' | 'inactive' | 'error';
	lastRun: Date;
	runCount: number;
	successRate: number;
	createdBy: {
		userId: string;
		username: string;
		avatar: string;
	};
	createdAt: Date;
}

interface SlashCommand {
	id: string;
	command: string;
	description: string;
	action: {
		type: string;
		config: any;
	};
	permissions: string[];
	usage: number;
	lastUsed: Date;
}

interface SynqApp {
	id: string;
	name: string;
	description: string;
	version: string;
	author: string;
	category: string;
	icon: string;
	permissions: string[];
	workflows: string[];
	installs: number;
	rating: number;
	status: 'installed' | 'available' | 'error';
}

interface SynqWorkflowsProps {
	workflows: Workflow[];
	slashCommands: SlashCommand[];
	synqApps: SynqApp[];
	onCreateWorkflow: (workflow: Omit<Workflow, 'id' | 'createdBy' | 'createdAt' | 'lastRun' | 'runCount' | 'successRate'>) => void;
	onUpdateWorkflow: (workflowId: string, workflow: Partial<Workflow>) => void;
	onDeleteWorkflow: (workflowId: string) => void;
	onCreateSlashCommand: (command: Omit<SlashCommand, 'id' | 'usage' | 'lastUsed'>) => void;
	onUpdateSlashCommand: (commandId: string, command: Partial<SlashCommand>) => void;
	onDeleteSlashCommand: (commandId: string) => void;
	onInstallApp: (appId: string) => void;
	onUninstallApp: (appId: string) => void;
}

const SynqWorkflows = ({
	workflows,
	slashCommands,
	synqApps,
	onCreateWorkflow,
	onUpdateWorkflow,
	onDeleteWorkflow,
	onCreateSlashCommand,
	onUpdateSlashCommand,
	onDeleteSlashCommand,
	onInstallApp,
	onUninstallApp,
}: SynqWorkflowsProps): ReactElement => {
	const { t } = useTranslation();
	const [activeTab, setActiveTab] = useState<'workflows' | 'commands' | 'apps'>('workflows');
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [editingItem, setEditingItem] = useState<string | null>(null);

	const handleCreateWorkflow = useCallback((workflowData: Omit<Workflow, 'id' | 'createdBy' | 'createdAt' | 'lastRun' | 'runCount' | 'successRate'>) => {
		onCreateWorkflow(workflowData);
		setShowCreateForm(false);
	}, [onCreateWorkflow]);

	const handleDeleteWorkflow = useCallback((workflowId: string) => {
		if (confirm(t('Are_you_sure_delete_workflow'))) {
			onDeleteWorkflow(workflowId);
		}
	}, [onDeleteWorkflow, t]);

	const handleCreateSlashCommand = useCallback((commandData: Omit<SlashCommand, 'id' | 'usage' | 'lastUsed'>) => {
		onCreateSlashCommand(commandData);
		setShowCreateForm(false);
	}, [onCreateSlashCommand]);

	const handleDeleteSlashCommand = useCallback((commandId: string) => {
		if (confirm(t('Are_you_sure_delete_command'))) {
			onDeleteSlashCommand(commandId);
		}
	}, [onDeleteSlashCommand, t]);

	const handleInstallApp = useCallback((appId: string) => {
		onInstallApp(appId);
	}, [onInstallApp]);

	const handleUninstallApp = useCallback((appId: string) => {
		if (confirm(t('Are_you_sure_uninstall_app'))) {
			onUninstallApp(appId);
		}
	}, [onUninstallApp, t]);

	return (
		<Box style={{ padding: '1rem' }}>
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Workflows_and_Automation')}</CardTitle>
					<ButtonGroup>
						<Button
							variant={activeTab === 'workflows' ? 'primary' : 'secondary'}
							onClick={() => setActiveTab('workflows')}
						>
							{t('Workflows')}
						</Button>
						<Button
							variant={activeTab === 'commands' ? 'primary' : 'secondary'}
							onClick={() => setActiveTab('commands')}
						>
							{t('Slash_Commands')}
						</Button>
						<Button
							variant={activeTab === 'apps' ? 'primary' : 'secondary'}
							onClick={() => setActiveTab('apps')}
						>
							{t('Synq_Apps')}
						</Button>
					</ButtonGroup>
				</CardHeader>
				<CardBody>
					{activeTab === 'workflows' && (
						<Box>
							<Box marginBlockEnd={16}>
								<Button
									variant='primary'
									icon='plus'
									onClick={() => setShowCreateForm(true)}
								>
									{t('Create_Workflow')}
								</Button>
							</Box>
							<Table>
								<TableHead>
									<TableRow>
										<TableCell>{t('Name')}</TableCell>
										<TableCell>{t('Trigger')}</TableCell>
										<TableCell>{t('Actions')}</TableCell>
										<TableCell>{t('Status')}</TableCell>
										<TableCell>{t('Success_Rate')}</TableCell>
										<TableCell>{t('Actions')}</TableCell>
									</TableRow>
								</TableHead>
								<TableBody>
									{workflows.map((workflow) => (
										<TableRow key={workflow.id}>
											<TableCell>
												<Box>
													<Box style={{ fontWeight: 'bold' }}>{workflow.name}</Box>
													<Box style={{ fontSize: '0.875rem', color: '#666' }}>
														{workflow.description}
													</Box>
												</Box>
											</TableCell>
											<TableCell>
												<Badge variant='secondary'>
													{t(workflow.trigger.type)}
												</Badge>
											</TableCell>
											<TableCell>
												<Badge variant='primary'>
													{workflow.actions.length}
												</Badge>
											</TableCell>
											<TableCell>
												<Badge variant={workflow.status === 'active' ? 'success' : workflow.status === 'error' ? 'danger' : 'secondary'}>
													{t(workflow.status)}
												</Badge>
											</TableCell>
											<TableCell>
												<Box style={{ display: 'flex', alignItems: 'center' }}>
													<Box style={{ marginRight: '0.5rem' }}>
														{workflow.successRate}%
													</Box>
													<ProgressBar percentage={workflow.successRate} />
												</Box>
											</TableCell>
											<TableCell>
												<ButtonGroup>
													<Button
														size='x16'
														icon='edit'
														onClick={() => setEditingItem(workflow.id)}
													/>
													<Button
														size='x16'
														icon='trash'
														onClick={() => handleDeleteWorkflow(workflow.id)}
													/>
												</ButtonGroup>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</Box>
					)}

					{activeTab === 'commands' && (
						<Box>
							<Box marginBlockEnd={16}>
								<Button
									variant='primary'
									icon='plus'
									onClick={() => setShowCreateForm(true)}
								>
									{t('Create_Command')}
								</Button>
							</Box>
							<Table>
								<TableHead>
									<TableRow>
										<TableCell>{t('Command')}</TableCell>
										<TableCell>{t('Description')}</TableCell>
										<TableCell>{t('Action')}</TableCell>
										<TableCell>{t('Usage')}</TableCell>
										<TableCell>{t('Last_Used')}</TableCell>
										<TableCell>{t('Actions')}</TableCell>
									</TableRow>
								</TableHead>
								<TableBody>
									{slashCommands.map((command) => (
										<TableRow key={command.id}>
											<TableCell>
												<Box style={{ display: 'flex', alignItems: 'center' }}>
													<Icon name='slash' size='x16' style={{ marginRight: '0.5rem' }} />
													<Box style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
														/{command.command}
													</Box>
												</Box>
											</TableCell>
											<TableCell>{command.description}</TableCell>
											<TableCell>
												<Badge variant='secondary'>
													{t(command.action.type)}
												</Badge>
											</TableCell>
											<TableCell>
												<Badge variant='primary'>
													{command.usage}
												</Badge>
											</TableCell>
											<TableCell>
												<Box style={{ fontSize: '0.875rem' }}>
													{new Date(command.lastUsed).toLocaleDateString()}
												</Box>
											</TableCell>
											<TableCell>
												<ButtonGroup>
													<Button
														size='x16'
														icon='edit'
														onClick={() => setEditingItem(command.id)}
													/>
													<Button
														size='x16'
														icon='trash'
														onClick={() => handleDeleteSlashCommand(command.id)}
													/>
												</ButtonGroup>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</Box>
					)}

					{activeTab === 'apps' && (
						<Box>
							<Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
								{synqApps.map((app) => (
									<Card key={app.id}>
										<CardHeader>
											<CardTitle style={{ display: 'flex', alignItems: 'center' }}>
												<Icon name={app.icon} size='x20' style={{ marginRight: '0.5rem' }} />
												{app.name}
											</CardTitle>
										</CardHeader>
										<CardBody>
											<Box marginBlockEnd={8}>
												<p style={{ marginBottom: '1rem', color: '#666' }}>
													{app.description}
												</p>
												<Box style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
													<Badge variant='secondary'>
														{t('Version')}: {app.version}
													</Badge>
													<Badge variant='secondary'>
														{t('Category')}: {t(app.category)}
													</Badge>
													<Badge variant='secondary'>
														{t('Installs')}: {app.installs}
													</Badge>
												</Box>
												<Box style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
													<Box style={{ marginRight: '0.5rem' }}>
														{t('Rating')}: {app.rating}/5
													</Box>
													<ProgressBar percentage={(app.rating / 5) * 100} />
												</Box>
											</Box>
											<ButtonGroup>
												{app.status === 'installed' ? (
													<Button
														variant='danger'
														icon='trash'
														onClick={() => handleUninstallApp(app.id)}
													>
														{t('Uninstall')}
													</Button>
												) : (
													<Button
														variant='primary'
														icon='download'
														onClick={() => handleInstallApp(app.id)}
													>
														{t('Install')}
													</Button>
												)}
												<Button
													variant='secondary'
													icon='eye'
													onClick={() => {/* TODO: Show app details */}}
												>
													{t('Details')}
												</Button>
											</ButtonGroup>
										</CardBody>
									</Card>
								))}
							</Box>
						</Box>
					)}
				</CardBody>
			</Card>

			{showCreateForm && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>
							{activeTab === 'workflows' ? t('Create_New_Workflow') : t('Create_New_Command')}
						</CardTitle>
					</CardHeader>
					<CardBody>
						{activeTab === 'workflows' ? (
							<CreateWorkflowForm
								onCreate={handleCreateWorkflow}
								onCancel={() => setShowCreateForm(false)}
							/>
						) : (
							<CreateSlashCommandForm
								onCreate={handleCreateSlashCommand}
								onCancel={() => setShowCreateForm(false)}
							/>
						)}
					</CardBody>
				</Card>
			)}
		</Box>
	);
};

interface CreateWorkflowFormProps {
	onCreate: (workflow: Omit<Workflow, 'id' | 'createdBy' | 'createdAt' | 'lastRun' | 'runCount' | 'successRate'>) => void;
	onCancel: () => void;
}

const CreateWorkflowForm = ({ onCreate, onCancel }: CreateWorkflowFormProps): ReactElement => {
	const { t } = useTranslation();
	const [workflowData, setWorkflowData] = useState<Omit<Workflow, 'id' | 'createdBy' | 'createdAt' | 'lastRun' | 'runCount' | 'successRate'>>({
		name: '',
		description: '',
		trigger: {
			type: 'message',
			condition: '',
			value: '',
		},
		actions: [],
		status: 'inactive',
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (workflowData.name.trim()) {
			onCreate(workflowData);
		}
	};

	return (
		<form onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel>{t('Workflow_Name')}</FieldLabel>
					<FieldRow>
						<input
							type='text'
							value={workflowData.name}
							onChange={(e) => setWorkflowData(prev => ({ ...prev, name: e.target.value }))}
							placeholder={t('Enter_workflow_name')}
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
							value={workflowData.description}
							onChange={(e) => setWorkflowData(prev => ({ ...prev, description: e.target.value }))}
							placeholder={t('Enter_workflow_description')}
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
					<FieldLabel>{t('Trigger_Type')}</FieldLabel>
					<FieldRow>
						<select
							value={workflowData.trigger.type}
							onChange={(e) => setWorkflowData(prev => ({ ...prev, trigger: { ...prev.trigger, type: e.target.value as any } }))}
							style={{
								width: '100%',
								padding: '0.5rem',
								border: '1px solid #ddd',
								borderRadius: '4px',
							}}
						>
							<option value='message'>{t('Message')}</option>
							<option value='user'>{t('User')}</option>
							<option value='channel'>{t('Channel')}</option>
							<option value='time'>{t('Time')}</option>
						</select>
					</FieldRow>
				</Field>

				<Field>
					<FieldRow>
						<ButtonGroup>
							<Button type='submit' primary>
								{t('Create_Workflow')}
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

interface CreateSlashCommandFormProps {
	onCreate: (command: Omit<SlashCommand, 'id' | 'usage' | 'lastUsed'>) => void;
	onCancel: () => void;
}

const CreateSlashCommandForm = ({ onCreate, onCancel }: CreateSlashCommandFormProps): ReactElement => {
	const { t } = useTranslation();
	const [commandData, setCommandData] = useState<Omit<SlashCommand, 'id' | 'usage' | 'lastUsed'>>({
		command: '',
		description: '',
		action: {
			type: 'message',
			config: {},
		},
		permissions: [],
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (commandData.command.trim()) {
			onCreate(commandData);
		}
	};

	return (
		<form onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel>{t('Command')}</FieldLabel>
					<FieldRow>
						<input
							type='text'
							value={commandData.command}
							onChange={(e) => setCommandData(prev => ({ ...prev, command: e.target.value }))}
							placeholder={t('Enter_command_name')}
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
							value={commandData.description}
							onChange={(e) => setCommandData(prev => ({ ...prev, description: e.target.value }))}
							placeholder={t('Enter_command_description')}
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
					<FieldLabel>{t('Action_Type')}</FieldLabel>
					<FieldRow>
						<select
							value={commandData.action.type}
							onChange={(e) => setCommandData(prev => ({ ...prev, action: { ...prev.action, type: e.target.value } }))}
							style={{
								width: '100%',
								padding: '0.5rem',
								border: '1px solid #ddd',
								borderRadius: '4px',
							}}
						>
							<option value='message'>{t('Send_Message')}</option>
							<option value='workflow'>{t('Run_Workflow')}</option>
							<option value='webhook'>{t('Call_Webhook')}</option>
							<option value='app'>{t('Run_App')}</option>
						</select>
					</FieldRow>
				</Field>

				<Field>
					<FieldRow>
						<ButtonGroup>
							<Button type='submit' primary>
								{t('Create_Command')}
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

export default SynqWorkflows;
