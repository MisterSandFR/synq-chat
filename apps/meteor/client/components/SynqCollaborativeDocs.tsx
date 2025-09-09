import { Box, Card, CardBody, CardHeader, CardTitle, Button, ButtonGroup, Badge, Icon, Field, FieldGroup, FieldLabel, FieldRow, FieldHint, Table, TableHead, TableBody, TableRow, TableCell } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import { useState, useCallback, useEffect } from 'react';

interface CollaborativeDoc {
	id: string;
	title: string;
	description: string;
	channelId?: string;
	author: {
		userId: string;
		username: string;
		avatar: string;
	};
	createdAt: Date;
	lastModified: Date;
	participants: Array<{
		userId: string;
		username: string;
		avatar: string;
		isOnline: boolean;
	}>;
	template: string;
	permissions: {
		canEdit: string[];
		canView: string[];
		canComment: string[];
	};
	version: number;
	isActive: boolean;
}

interface SynqCollaborativeDocsProps {
	docs: CollaborativeDoc[];
	onCreateDoc: (doc: Omit<CollaborativeDoc, 'id' | 'author' | 'createdAt' | 'lastModified' | 'participants' | 'version'>) => void;
	onEditDoc: (docId: string) => void;
	onDeleteDoc: (docId: string) => void;
	onShareDoc: (docId: string) => void;
	onExportDoc: (docId: string, format: string) => void;
}

const SynqCollaborativeDocs = ({
	docs,
	onCreateDoc,
	onEditDoc,
	onDeleteDoc,
	onShareDoc,
	onExportDoc,
}: SynqCollaborativeDocsProps): ReactElement => {
	const { t } = useTranslation();
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [editingDoc, setEditingDoc] = useState<string | null>(null);
	const [filter, setFilter] = useState('all');

	const handleCreateDoc = useCallback((docData: Omit<CollaborativeDoc, 'id' | 'author' | 'createdAt' | 'lastModified' | 'participants' | 'version'>) => {
		onCreateDoc(docData);
		setShowCreateForm(false);
	}, [onCreateDoc]);

	const handleDeleteDoc = useCallback((docId: string) => {
		if (confirm(t('Are_you_sure_delete_doc'))) {
			onDeleteDoc(docId);
		}
	}, [onDeleteDoc, t]);

	const filteredDocs = docs.filter(doc => {
		if (filter === 'all') return true;
		if (filter === 'active') return doc.isActive;
		if (filter === 'mine') return doc.author.userId === 'current-user'; // TODO: Get current user
		return true;
	});

	return (
		<Box style={{ padding: '1rem' }}>
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Collaborative_Documents')}</CardTitle>
					<ButtonGroup>
						<Button
							variant='primary'
							icon='plus'
							onClick={() => setShowCreateForm(true)}
						>
							{t('Create_Document')}
						</Button>
					</ButtonGroup>
				</CardHeader>
				<CardBody>
					<Box marginBlockEnd={16}>
						<ButtonGroup>
							<Button
								variant={filter === 'all' ? 'primary' : 'secondary'}
								onClick={() => setFilter('all')}
							>
								{t('All')}
							</Button>
							<Button
								variant={filter === 'active' ? 'primary' : 'secondary'}
								onClick={() => setFilter('active')}
							>
								{t('Active')}
							</Button>
							<Button
								variant={filter === 'mine' ? 'primary' : 'secondary'}
								onClick={() => setFilter('mine')}
							>
								{t('My_Documents')}
							</Button>
						</ButtonGroup>
					</Box>

					<Table>
						<TableHead>
							<TableRow>
								<TableCell>{t('Title')}</TableCell>
								<TableCell>{t('Author')}</TableCell>
								<TableCell>{t('Participants')}</TableCell>
								<TableCell>{t('Last_Modified')}</TableCell>
								<TableCell>{t('Status')}</TableCell>
								<TableCell>{t('Actions')}</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{filteredDocs.map((doc) => (
								<TableRow key={doc.id}>
									<TableCell>
										<Box style={{ display: 'flex', alignItems: 'center' }}>
											<Icon name='document' size='x16' style={{ marginRight: '0.5rem' }} />
											<Box>
												<Box style={{ fontWeight: 'bold' }}>{doc.title}</Box>
												<Box style={{ fontSize: '0.875rem', color: '#666' }}>
													{doc.description}
												</Box>
											</Box>
										</Box>
									</TableCell>
									<TableCell>
										<Box style={{ display: 'flex', alignItems: 'center' }}>
											<img
												src={doc.author.avatar}
												alt={doc.author.username}
												style={{
													width: '24px',
													height: '24px',
													borderRadius: '50%',
													marginRight: '0.5rem',
												}}
											/>
											{doc.author.username}
										</Box>
									</TableCell>
									<TableCell>
										<Box style={{ display: 'flex', alignItems: 'center' }}>
											{doc.participants.slice(0, 3).map((participant) => (
												<img
													key={participant.userId}
													src={participant.avatar}
													alt={participant.username}
													style={{
														width: '20px',
														height: '20px',
														borderRadius: '50%',
														marginRight: '0.25rem',
														border: participant.isOnline ? '2px solid #28a745' : '1px solid #ddd',
													}}
													title={participant.username}
												/>
											))}
											{doc.participants.length > 3 && (
												<Badge variant='secondary'>+{doc.participants.length - 3}</Badge>
											)}
										</Box>
									</TableCell>
									<TableCell>
										<Box style={{ fontSize: '0.875rem' }}>
											{t('Version')} {doc.version}
										</Box>
										<Box style={{ fontSize: '0.75rem', color: '#666' }}>
											{new Date(doc.lastModified).toLocaleDateString()}
										</Box>
									</TableCell>
									<TableCell>
										<Badge variant={doc.isActive ? 'success' : 'secondary'}>
											{doc.isActive ? t('Active') : t('Inactive')}
										</Badge>
									</TableCell>
									<TableCell>
										<ButtonGroup>
											<Button
												size='x16'
												icon='edit'
												onClick={() => onEditDoc(doc.id)}
											/>
											<Button
												size='x16'
												icon='share'
												onClick={() => onShareDoc(doc.id)}
											/>
											<Button
												size='x16'
												icon='download'
												onClick={() => onExportDoc(doc.id, 'pdf')}
											/>
											<Button
												size='x16'
												icon='trash'
												onClick={() => handleDeleteDoc(doc.id)}
											/>
										</ButtonGroup>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardBody>
			</Card>

			{showCreateForm && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>{t('Create_New_Document')}</CardTitle>
					</CardHeader>
					<CardBody>
						<CreateDocForm
							onCreate={handleCreateDoc}
							onCancel={() => setShowCreateForm(false)}
						/>
					</CardBody>
				</Card>
			)}

			{editingDoc && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>{t('Edit_Document')}</CardTitle>
					</CardHeader>
					<CardBody>
						<EditDocForm
							doc={docs.find(d => d.id === editingDoc)!}
							onUpdate={(docId, docData) => {
								// TODO: Implement doc update
								setEditingDoc(null);
							}}
							onCancel={() => setEditingDoc(null)}
						/>
					</CardBody>
				</Card>
			)}
		</Box>
	);
};

interface CreateDocFormProps {
	onCreate: (doc: Omit<CollaborativeDoc, 'id' | 'author' | 'createdAt' | 'lastModified' | 'participants' | 'version'>) => void;
	onCancel: () => void;
}

const CreateDocForm = ({ onCreate, onCancel }: CreateDocFormProps): ReactElement => {
	const { t } = useTranslation();
	const [docData, setDocData] = useState<Omit<CollaborativeDoc, 'id' | 'author' | 'createdAt' | 'lastModified' | 'participants' | 'version'>>({
		title: '',
		description: '',
		channelId: undefined,
		template: 'blank',
		permissions: {
			canEdit: [],
			canView: [],
			canComment: [],
		},
		isActive: true,
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (docData.title.trim()) {
			onCreate(docData);
		}
	};

	return (
		<form onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel>{t('Document_Title')}</FieldLabel>
					<FieldRow>
						<input
							type='text'
							value={docData.title}
							onChange={(e) => setDocData(prev => ({ ...prev, title: e.target.value }))}
							placeholder={t('Enter_document_title')}
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
							value={docData.description}
							onChange={(e) => setDocData(prev => ({ ...prev, description: e.target.value }))}
							placeholder={t('Enter_document_description')}
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
					<FieldLabel>{t('Template')}</FieldLabel>
					<FieldRow>
						<select
							value={docData.template}
							onChange={(e) => setDocData(prev => ({ ...prev, template: e.target.value }))}
							style={{
								width: '100%',
								padding: '0.5rem',
								border: '1px solid #ddd',
								borderRadius: '4px',
							}}
						>
							<option value='blank'>{t('Blank_Document')}</option>
							<option value='meeting'>{t('Meeting_Notes')}</option>
							<option value='brainstorming'>{t('Brainstorming')}</option>
							<option value='project'>{t('Project_Plan')}</option>
						</select>
					</FieldRow>
				</Field>

				<Field>
					<FieldRow>
						<ButtonGroup>
							<Button type='submit' primary>
								{t('Create_Document')}
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

interface EditDocFormProps {
	doc: CollaborativeDoc;
	onUpdate: (docId: string, doc: Partial<CollaborativeDoc>) => void;
	onCancel: () => void;
}

const EditDocForm = ({ doc, onUpdate, onCancel }: EditDocFormProps): ReactElement => {
	const { t } = useTranslation();
	const [docData, setDocData] = useState<Partial<CollaborativeDoc>>(doc);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onUpdate(doc.id, docData);
	};

	return (
		<form onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel>{t('Document_Title')}</FieldLabel>
					<FieldRow>
						<input
							type='text'
							value={docData.title || ''}
							onChange={(e) => setDocData(prev => ({ ...prev, title: e.target.value }))}
							placeholder={t('Enter_document_title')}
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
							value={docData.description || ''}
							onChange={(e) => setDocData(prev => ({ ...prev, description: e.target.value }))}
							placeholder={t('Enter_document_description')}
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
								{t('Update_Document')}
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

export default SynqCollaborativeDocs;
