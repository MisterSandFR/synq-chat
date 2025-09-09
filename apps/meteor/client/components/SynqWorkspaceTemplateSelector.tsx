import { Box, Card, CardBody, CardHeader, CardTitle, Button, ButtonGroup, Badge, Icon, Field, FieldGroup, FieldLabel, FieldRow, FieldHint } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import { useState, useCallback } from 'react';

interface WorkspaceTemplate {
	id: string;
	name: string;
	description: string;
	category: string;
	channels: Array<{
		name: string;
		type: 'c' | 'p';
		description: string;
		permissions: string[];
	}>;
	roles: Array<{
		name: string;
		description: string;
		permissions: string[];
		color: string;
		icon: string;
	}>;
	integrations: Array<{
		name: string;
		type: string;
		enabled: boolean;
		config: Record<string, any>;
	}>;
	icon: string;
	color: string;
	preview: string;
}

interface SynqWorkspaceTemplateSelectorProps {
	templates: WorkspaceTemplate[];
	onTemplateSelect: (templateId: string) => void;
	onTemplateCreate: (template: Omit<WorkspaceTemplate, 'id'>) => void;
	onTemplateEdit: (templateId: string, template: Partial<WorkspaceTemplate>) => void;
	onTemplateDelete: (templateId: string) => void;
	selectedTemplate?: string;
}

const SynqWorkspaceTemplateSelector = ({
	templates,
	onTemplateSelect,
	onTemplateCreate,
	onTemplateEdit,
	onTemplateDelete,
	selectedTemplate,
}: SynqWorkspaceTemplateSelectorProps): ReactElement => {
	const { t } = useTranslation();
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [editingTemplate, setEditingTemplate] = useState<string | null>(null);

	const handleTemplateSelect = useCallback((templateId: string) => {
		onTemplateSelect(templateId);
	}, [onTemplateSelect]);

	const handleCreateTemplate = useCallback((templateData: Omit<WorkspaceTemplate, 'id'>) => {
		onTemplateCreate(templateData);
		setShowCreateForm(false);
	}, [onTemplateCreate]);

	const handleEditTemplate = useCallback((templateId: string, templateData: Partial<WorkspaceTemplate>) => {
		onTemplateEdit(templateId, templateData);
		setEditingTemplate(null);
	}, [onTemplateEdit]);

	const handleDeleteTemplate = useCallback((templateId: string) => {
		if (confirm(t('Are_you_sure_delete_template'))) {
			onTemplateDelete(templateId);
		}
	}, [onTemplateDelete, t]);

	const groupedTemplates = templates.reduce((acc, template) => {
		if (!acc[template.category]) {
			acc[template.category] = [];
		}
		acc[template.category].push(template);
		return acc;
	}, {} as Record<string, WorkspaceTemplate[]>);

	return (
		<Box style={{ padding: '1rem' }}>
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Select_Workspace_Template')}</CardTitle>
					<ButtonGroup>
						<Button
							variant='primary'
							icon='plus'
							onClick={() => setShowCreateForm(true)}
						>
							{t('Create_Template')}
						</Button>
					</ButtonGroup>
				</CardHeader>
				<CardBody>
					{Object.entries(groupedTemplates).map(([category, categoryTemplates]) => (
						<Box key={category} marginBlockEnd={24}>
							<FieldLabel style={{ fontWeight: 'bold', marginBottom: '1rem' }}>
								{t(category)}
							</FieldLabel>
							<Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
								{categoryTemplates.map((template) => (
									<Card
										key={template.id}
										variant={selectedTemplate === template.id ? 'primary' : 'secondary'}
										style={{
											cursor: 'pointer',
											border: selectedTemplate === template.id ? `2px solid ${template.color}` : '1px solid #ddd',
											backgroundColor: selectedTemplate === template.id ? `${template.color}10` : undefined,
										}}
										onClick={() => handleTemplateSelect(template.id)}
									>
										<CardHeader>
											<CardTitle style={{ display: 'flex', alignItems: 'center' }}>
												<Icon
													name={template.icon}
													size='x20'
													style={{
														marginRight: '0.5rem',
														color: template.color,
													}}
												/>
												{template.name}
											</CardTitle>
										</CardHeader>
										<CardBody>
											<p style={{ marginBottom: '1rem', color: '#666' }}>
												{template.description}
											</p>
											<Box style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
												<Badge variant='secondary'>
													{t('Channels')}: {template.channels.length}
												</Badge>
												<Badge variant='secondary'>
													{t('Roles')}: {template.roles.length}
												</Badge>
												<Badge variant='secondary'>
													{t('Integrations')}: {template.integrations.length}
												</Badge>
											</Box>
											<ButtonGroup>
												<Button
													size='x16'
													icon='edit'
													onClick={(e) => {
														e.stopPropagation();
														setEditingTemplate(template.id);
													}}
												/>
												<Button
													size='x16'
													icon='trash'
													onClick={(e) => {
														e.stopPropagation();
														handleDeleteTemplate(template.id);
													}}
												/>
												<Button
													size='x16'
													icon='eye'
													onClick={(e) => {
														e.stopPropagation();
														// TODO: Show template preview
													}}
												/>
											</ButtonGroup>
										</CardBody>
									</Card>
								))}
							</Box>
						</Box>
					))}
				</CardBody>
			</Card>

			{showCreateForm && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>{t('Create_New_Template')}</CardTitle>
					</CardHeader>
					<CardBody>
						<CreateTemplateForm
							onCreate={handleCreateTemplate}
							onCancel={() => setShowCreateForm(false)}
						/>
					</CardBody>
				</Card>
			)}

			{editingTemplate && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>{t('Edit_Template')}</CardTitle>
					</CardHeader>
					<CardBody>
						<EditTemplateForm
							template={templates.find(t => t.id === editingTemplate)!}
							onUpdate={handleEditTemplate}
							onCancel={() => setEditingTemplate(null)}
						/>
					</CardBody>
				</Card>
			)}
		</Box>
	);
};

interface CreateTemplateFormProps {
	onCreate: (template: Omit<WorkspaceTemplate, 'id'>) => void;
	onCancel: () => void;
}

const CreateTemplateForm = ({ onCreate, onCancel }: CreateTemplateFormProps): ReactElement => {
	const { t } = useTranslation();
	const [templateData, setTemplateData] = useState<Omit<WorkspaceTemplate, 'id'>>({
		name: '',
		description: '',
		category: 'custom',
		channels: [],
		roles: [],
		integrations: [],
		icon: 'rocket',
		color: '#1d74f5',
		preview: '',
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (templateData.name.trim()) {
			onCreate(templateData);
		}
	};

	return (
		<form onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel>{t('Template_Name')}</FieldLabel>
					<FieldRow>
						<input
							type='text'
							value={templateData.name}
							onChange={(e) => setTemplateData(prev => ({ ...prev, name: e.target.value }))}
							placeholder={t('Enter_template_name')}
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
							value={templateData.description}
							onChange={(e) => setTemplateData(prev => ({ ...prev, description: e.target.value }))}
							placeholder={t('Enter_template_description')}
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
					<FieldLabel>{t('Category')}</FieldLabel>
					<FieldRow>
						<select
							value={templateData.category}
							onChange={(e) => setTemplateData(prev => ({ ...prev, category: e.target.value }))}
							style={{
								width: '100%',
								padding: '0.5rem',
								border: '1px solid #ddd',
								borderRadius: '4px',
							}}
						>
							<option value='startup'>{t('Startup')}</option>
							<option value='enterprise'>{t('Enterprise')}</option>
							<option value='community'>{t('Community')}</option>
							<option value='education'>{t('Education')}</option>
							<option value='custom'>{t('Custom')}</option>
						</select>
					</FieldRow>
				</Field>

				<Field>
					<FieldLabel>{t('Color')}</FieldLabel>
					<FieldRow>
						<input
							type='color'
							value={templateData.color}
							onChange={(e) => setTemplateData(prev => ({ ...prev, color: e.target.value }))}
							style={{
								width: '60px',
								height: '40px',
								border: 'none',
								borderRadius: '4px',
							}}
						/>
					</FieldRow>
				</Field>

				<Field>
					<FieldLabel>{t('Icon')}</FieldLabel>
					<FieldRow>
						<select
							value={templateData.icon}
							onChange={(e) => setTemplateData(prev => ({ ...prev, icon: e.target.value }))}
							style={{
								width: '100%',
								padding: '0.5rem',
								border: '1px solid #ddd',
								borderRadius: '4px',
							}}
						>
							<option value='rocket'>{t('Rocket')}</option>
							<option value='building'>{t('Building')}</option>
							<option value='users'>{t('Users')}</option>
							<option value='graduation-cap'>{t('Education')}</option>
							<option value='heart'>{t('Community')}</option>
						</select>
					</FieldRow>
				</Field>

				<Field>
					<FieldRow>
						<ButtonGroup>
							<Button type='submit' primary>
								{t('Create_Template')}
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

interface EditTemplateFormProps {
	template: WorkspaceTemplate;
	onUpdate: (templateId: string, template: Partial<WorkspaceTemplate>) => void;
	onCancel: () => void;
}

const EditTemplateForm = ({ template, onUpdate, onCancel }: EditTemplateFormProps): ReactElement => {
	const { t } = useTranslation();
	const [templateData, setTemplateData] = useState<Partial<WorkspaceTemplate>>(template);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onUpdate(template.id, templateData);
	};

	return (
		<form onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel>{t('Template_Name')}</FieldLabel>
					<FieldRow>
						<input
							type='text'
							value={templateData.name || ''}
							onChange={(e) => setTemplateData(prev => ({ ...prev, name: e.target.value }))}
							placeholder={t('Enter_template_name')}
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
							value={templateData.description || ''}
							onChange={(e) => setTemplateData(prev => ({ ...prev, description: e.target.value }))}
							placeholder={t('Enter_template_description')}
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
								{t('Update_Template')}
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

export default SynqWorkspaceTemplateSelector;
