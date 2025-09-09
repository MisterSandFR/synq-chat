import { Box, Card, CardBody, CardHeader, CardTitle, Field, FieldGroup, FieldLabel, FieldRow, FieldHint, Button, ButtonGroup, Badge, Icon } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import { useState, useCallback } from 'react';

interface Permission {
	id: string;
	name: string;
	description: string;
	category: string;
	enabled: boolean;
}

interface Role {
	id: string;
	name: string;
	description: string;
	permissions: string[];
	color: string;
	icon: string;
}

interface SynqChannelPermissionsProps {
	channelId: string;
	channelName: string;
	roles: Role[];
	permissions: Permission[];
	onPermissionChange: (roleId: string, permissionId: string, enabled: boolean) => void;
	onRoleCreate: (role: Omit<Role, 'id'>) => void;
	onRoleUpdate: (roleId: string, role: Partial<Role>) => void;
	onRoleDelete: (roleId: string) => void;
}

const SynqChannelPermissions = ({
	channelId,
	channelName,
	roles,
	permissions,
	onPermissionChange,
	onRoleCreate,
	onRoleUpdate,
	onRoleDelete,
}: SynqChannelPermissionsProps): ReactElement => {
	const { t } = useTranslation();
	const [selectedRole, setSelectedRole] = useState<string | null>(null);
	const [showCreateRole, setShowCreateRole] = useState(false);

	const groupedPermissions = permissions.reduce((acc, permission) => {
		if (!acc[permission.category]) {
			acc[permission.category] = [];
		}
		acc[permission.category].push(permission);
		return acc;
	}, {} as Record<string, Permission[]>);

	const handlePermissionToggle = useCallback((roleId: string, permissionId: string, enabled: boolean) => {
		onPermissionChange(roleId, permissionId, enabled);
	}, [onPermissionChange]);

	const handleCreateRole = useCallback((roleData: Omit<Role, 'id'>) => {
		onRoleCreate(roleData);
		setShowCreateRole(false);
	}, [onRoleCreate]);

	return (
		<Box style={{ padding: '1rem' }}>
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>
						{t('Channel_Permissions')}: {channelName}
					</CardTitle>
				</CardHeader>
				<CardBody>
					<FieldGroup>
						<Field>
							<FieldLabel>{t('Select_Role')}</FieldLabel>
							<FieldRow>
								<ButtonGroup>
									{roles.map((role) => (
										<Button
											key={role.id}
											variant={selectedRole === role.id ? 'primary' : 'secondary'}
											onClick={() => setSelectedRole(role.id)}
											style={{
												backgroundColor: selectedRole === role.id ? role.color : undefined,
												borderColor: role.color,
											}}
										>
											<Icon name={role.icon} size='x16' />
											{role.name}
										</Button>
									))}
									<Button
										variant='secondary'
										icon='plus'
										onClick={() => setShowCreateRole(true)}
									>
										{t('Create_Role')}
									</Button>
								</ButtonGroup>
							</FieldRow>
						</Field>
					</FieldGroup>
				</CardBody>
			</Card>

			{selectedRole && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>
							{t('Permissions_for')}: {roles.find(r => r.id === selectedRole)?.name}
						</CardTitle>
					</CardHeader>
					<CardBody>
						{Object.entries(groupedPermissions).map(([category, categoryPermissions]) => (
							<Box key={category} marginBlockEnd={16}>
								<FieldLabel style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>
									{t(category)}
								</FieldLabel>
								<FieldGroup>
									{categoryPermissions.map((permission) => {
										const role = roles.find(r => r.id === selectedRole);
										const isEnabled = role?.permissions.includes(permission.id) || false;
										
										return (
											<Field key={permission.id}>
												<FieldRow>
													<Box style={{ flex: 1 }}>
														<FieldLabel>{t(permission.name)}</FieldLabel>
														<FieldHint>{t(permission.description)}</FieldHint>
													</Box>
													<Button
														variant={isEnabled ? 'primary' : 'secondary'}
														icon={isEnabled ? 'check' : 'cross'}
														onClick={() => handlePermissionToggle(selectedRole, permission.id, !isEnabled)}
														style={{
															backgroundColor: isEnabled ? 'var(--rc-color-success, #28a745)' : undefined,
														}}
													>
														{isEnabled ? t('Enabled') : t('Disabled')}
													</Button>
												</FieldRow>
											</Field>
										);
									})}
								</FieldGroup>
							</Box>
						))}
					</CardBody>
				</Card>
			)}

			{showCreateRole && (
				<Card marginBlockEnd={16}>
					<CardHeader>
						<CardTitle>{t('Create_New_Role')}</CardTitle>
					</CardHeader>
					<CardBody>
						<CreateRoleForm
							onCreate={handleCreateRole}
							onCancel={() => setShowCreateRole(false)}
						/>
					</CardBody>
				</Card>
			)}
		</Box>
	);
};

interface CreateRoleFormProps {
	onCreate: (role: Omit<Role, 'id'>) => void;
	onCancel: () => void;
}

const CreateRoleForm = ({ onCreate, onCancel }: CreateRoleFormProps): ReactElement => {
	const { t } = useTranslation();
	const [roleData, setRoleData] = useState<Omit<Role, 'id'>>({
		name: '',
		description: '',
		permissions: [],
		color: '#1d74f5',
		icon: 'user',
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (roleData.name.trim()) {
			onCreate(roleData);
		}
	};

	return (
		<form onSubmit={handleSubmit}>
			<FieldGroup>
				<Field>
					<FieldLabel>{t('Role_Name')}</FieldLabel>
					<FieldRow>
						<input
							type='text'
							value={roleData.name}
							onChange={(e) => setRoleData(prev => ({ ...prev, name: e.target.value }))}
							placeholder={t('Enter_role_name')}
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
							value={roleData.description}
							onChange={(e) => setRoleData(prev => ({ ...prev, description: e.target.value }))}
							placeholder={t('Enter_role_description')}
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
					<FieldLabel>{t('Color')}</FieldLabel>
					<FieldRow>
						<input
							type='color'
							value={roleData.color}
							onChange={(e) => setRoleData(prev => ({ ...prev, color: e.target.value }))}
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
							value={roleData.icon}
							onChange={(e) => setRoleData(prev => ({ ...prev, icon: e.target.value }))}
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
					<FieldRow>
						<ButtonGroup>
							<Button type='submit' primary>
								{t('Create_Role')}
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

export default SynqChannelPermissions;
