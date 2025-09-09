import { Box, Card, CardBody, CardHeader, CardTitle, Field, FieldGroup, FieldLabel, FieldRow, FieldHint, Button, ButtonGroup, Badge, Icon, Table, TableHead, TableBody, TableRow, TableCell } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import { useState, useCallback } from 'react';

interface RoleTemplate {
	id: string;
	name: string;
	description: string;
	permissions: string[];
	color: string;
	icon: string;
	category: string;
}

interface SynqRoleTemplatesProps {
	templates: RoleTemplate[];
	permissions: Array<{ id: string; name: string; description: string; category: string }>;
	onTemplateCreate: (template: Omit<RoleTemplate, 'id'>) => void;
	onTemplateUpdate: (templateId: string, template: Partial<RoleTemplate>) => void;
	onTemplateDelete: (templateId: string) => void;
	onTemplateApply: (templateId: string, channelId: string) => void;
}

const SynqRoleTemplates = ({
	templates,
	permissions,
	onTemplateCreate,
	onTemplateUpdate,
	onTemplateDelete,
	onTemplateApply,
}: SynqRoleTemplatesProps): ReactElement => {
	const { t } = useTranslation();
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [editingTemplate, setEditingTemplate] = useState<string | null>(null);

	const handleCreateTemplate = useCallback((templateData: Omit<RoleTemplate, 'id'>) => {
		onTemplateCreate(templateData);
		setShowCreateForm(false);
	}, [onTemplateCreate]);

	const handleUpdateTemplate = useCallback((templateId: string, templateData: Partial<RoleTemplate>) => {
		onTemplateUpdate(templateId, templateData);
		setEditingTemplate(null);
	}, [onTemplateUpdate]);

	const handleDeleteTemplate = useCallback((templateId: string) => {
		if (confirm(t('Are_you_sure_delete_template'))) {
			onTemplateDelete(templateId);
		}
	}, [onTemplateDelete, t]);

	return (
		<Box style={{ padding: '1rem' }}>
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Role_Templates')}</CardTitle>
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
					<Table>
						<TableHead>
							<TableRow>
								<TableCell>{t('Name')}</TableCell>
								<TableCell>{t('Description')}</TableCell>
								<TableCell>{t('Category')}</TableCell>
								<TableCell>{t('Permissions_Count')}</TableCell>
								<TableCell>{t('Actions')}</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{templates.map((template) => (
								<TableRow key={template.id}>
									<TableCell>
										<Box style={{ display: 'flex', alignItems: 'center' }}>
											<Icon
												name={template.icon}
												size='x16'
												style={{
													marginRight: '0.5rem',
													color: template.color,
												}}
											/>
											<Badge
												variant='secondary'
												style={{
													backgroundColor: template.color,
													color: 'white',
												}}
											>
												{template.name}
											</Badge>
										</Box>
									</TableCell>
									<TableCell>{template.description}</TableCell>
									<TableCell>{t(template.category)}</TableCell>
									<TableCell>
										<Badge variant='primary'>
											{template.permissions.length}
										</Badge>
									</TableCell>
									<TableCell>
										<ButtonGroup>
											<Button
												size='x16'
												icon='edit'
												onClick={() => setEditingTemplate(template.id)}
											/>
											<Button
												size='x16'
												icon='trash'
												onClick={() => handleDeleteTemplate(template.id)}
											/>
											<Button
												size='x16'
												icon='check'
												onClick={() => onTemplateApply(template.id, 'current-channel')}
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
						<CardTitle>{t('Create_New_Template')}</CardTitle>
					</CardHeader>
					<CardBody>
						<CreateTemplateForm
							permissions={permissions}
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
							permissions={permissions}
							onUpdate={handleUpdateTemplate}
							onCancel={() => setEditingTemplate(null)}
						/>
					</CardBody>
				</Card>
			)}
		</Box>
	);
};

interface CreateTemplateFormProps {
	permissions: Array<{ id: string; name: string; description: string; category: string }>;
	onCreate: (template: Omit<RoleTemplate, 'id'>) => void;
	onCancel: () => void;
}

const CreateTemplateForm = ({ permissions, onCreate, onCancel }: CreateTemplateFormProps): ReactElement => {
	const { t } = useTranslation();
	const [templateData, setTemplateData] = useState<Omit<RoleTemplate, 'id'>>({
		name: '',
		description: '',
		permissions: [],
		color: '#1d74f5',
		icon: 'user',
		category: 'custom',
	});

	const groupedPermissions = permissions.reduce((acc, permission) => {
		if (!acc[permission.category]) {
			acc[permission.category] = [];
		}
		acc[permission.category].push(permission);
		return acc;
	}, {} as Record<string, typeof permissions>);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (templateData.name.trim()) {
			onCreate(templateData);
		}
	};

	const handlePermissionToggle = (permissionId: string) => {
		setTemplateData(prev => ({
			...prev,
			permissions: prev.permissions.includes(permissionId)
				? prev.permissions.filter(id => id !== permissionId)
				: [...prev.permissions, permissionId],
		}));
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
							<option value='custom'>{t('Custom')}</option>
							<option value='admin'>{t('Admin')}</option>
							<option value='moderator'>{t('Moderator')}</option>
							<option value='user'>{t('User')}</option>
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
							<option value='user'>{t('User')}</option>
							<option value='shield-alt'>{t('Shield')}</option>
							<option value='crown'>{t('Crown')}</option>
							<option value='star'>{t('Star')}</option>
							<option value='key'>{t('Key')}</option>
						</select>
					</FieldRow>
				</Field>

				<Field>
					<FieldLabel>{t('Permissions')}</FieldLabel>
					<FieldHint>{t('Select_permissions_for_this_template')}</FieldHint>
					{Object.entries(groupedPermissions).map(([category, categoryPermissions]) => (
						<Box key={category} marginBlockEnd={16}>
							<FieldLabel style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
								{t(category)}
							</FieldLabel>
							<FieldGroup>
								{categoryPermissions.map((permission) => (
									<Field key={permission.id}>
										<FieldRow>
											<Box style={{ flex: 1 }}>
												<FieldLabel>{t(permission.name)}</FieldLabel>
												<FieldHint>{t(permission.description)}</FieldHint>
											</Box>
											<Button
												variant={templateData.permissions.includes(permission.id) ? 'primary' : 'secondary'}
												icon={templateData.permissions.includes(permission.id) ? 'check' : 'cross'}
												onClick={() => handlePermissionToggle(permission.id)}
												style={{
													backgroundColor: templateData.permissions.includes(permission.id) ? 'var(--rc-color-success, #28a745)' : undefined,
												}}
											>
												{templateData.permissions.includes(permission.id) ? t('Enabled') : t('Disabled')}
											</Button>
										</FieldRow>
									</Field>
								))}
							</FieldGroup>
						</Box>
					))}
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
	template: RoleTemplate;
	permissions: Array<{ id: string; name: string; description: string; category: string }>;
	onUpdate: (templateId: string, template: Partial<RoleTemplate>) => void;
	onCancel: () => void;
}

const EditTemplateForm = ({ template, permissions, onUpdate, onCancel }: EditTemplateFormProps): ReactElement => {
	const { t } = useTranslation();
	const [templateData, setTemplateData] = useState<Partial<RoleTemplate>>(template);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		onUpdate(template.id, templateData);
	};

	const handlePermissionToggle = (permissionId: string) => {
		setTemplateData(prev => ({
			...prev,
			permissions: prev.permissions?.includes(permissionId)
				? prev.permissions.filter(id => id !== permissionId)
				: [...(prev.permissions || []), permissionId],
		}));
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

export default SynqRoleTemplates;
