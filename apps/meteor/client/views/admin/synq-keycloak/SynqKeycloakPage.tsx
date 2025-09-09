import { Box, Card, CardBody, CardHeader, CardTitle, Field, FieldGroup, FieldLabel, FieldRow, FieldHint, Callout } from '@rocket.chat/fuselage';
import { useSetting } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Page, PageHeader, PageScrollableContentWithShadow } from '../../../components/Page';
import BooleanSettingInput from '../settings/Setting/inputs/BooleanSettingInput';
import StringSettingInput from '../settings/Setting/inputs/StringSettingInput';
import PasswordSettingInput from '../settings/Setting/inputs/PasswordSettingInput';
import IntSettingInput from '../settings/Setting/inputs/IntSettingInput';
import CodeSettingInput from '../settings/Setting/inputs/CodeSettingInput';
import SelectSettingInput from '../settings/Setting/inputs/SelectSettingInput';

const SynqKeycloakPage = (): ReactElement => {
	const { t } = useTranslation();

	// Configuration Keycloak
	const enabled = useSetting('Synq_Keycloak_Enabled');
	const serverUrl = useSetting('Synq_Keycloak_Server_URL');
	const realm = useSetting('Synq_Keycloak_Realm');
	const clientId = useSetting('Synq_Keycloak_Client_ID');
	const clientSecret = useSetting('Synq_Keycloak_Client_Secret');
	const redirectUri = useSetting('Synq_Keycloak_Redirect_URI');

	// User Provisioning
	const autoProvision = useSetting('Synq_Keycloak_Auto_Provision');
	const autoUpdate = useSetting('Synq_Keycloak_Auto_Update');
	const syncGroups = useSetting('Synq_Keycloak_Sync_Groups');
	const syncRoles = useSetting('Synq_Keycloak_Sync_Roles');

	// Role Mapping
	const roleMapping = useSetting('Synq_Keycloak_Role_Mapping');
	const groupMapping = useSetting('Synq_Keycloak_Group_Mapping');
	const defaultRole = useSetting('Synq_Keycloak_Default_Role');

	// Advanced Configuration
	const syncInterval = useSetting('Synq_Keycloak_Sync_Interval');
	const realTimeSync = useSetting('Synq_Keycloak_Real_Time_Sync');
	const debugLogs = useSetting('Synq_Keycloak_Debug_Logs');

	return (
		<Page bg='tint'>
			<PageHeader title={t('Synq_Keycloak')} />
			<PageScrollableContentWithShadow p={16}>
				<Box marginBlock='none' marginInline='auto' width='full' color='default'>
					{/* Configuration Keycloak Section */}
					<Card marginBlockEnd={16}>
						<CardHeader>
							<CardTitle>{t('Keycloak_Configuration')}</CardTitle>
						</CardHeader>
						<CardBody>
							<FieldGroup>
								<Field>
									<FieldLabel>{t('Synq_Keycloak_Enabled')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Keycloak_Enabled' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Enabled_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Keycloak_Server_URL')}</FieldLabel>
									<FieldRow>
										<StringSettingInput _id='Synq_Keycloak_Server_URL' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Server_URL_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Keycloak_Realm')}</FieldLabel>
									<FieldRow>
										<StringSettingInput _id='Synq_Keycloak_Realm' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Realm_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Keycloak_Client_ID')}</FieldLabel>
									<FieldRow>
										<StringSettingInput _id='Synq_Keycloak_Client_ID' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Client_ID_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Keycloak_Client_Secret')}</FieldLabel>
									<FieldRow>
										<PasswordSettingInput _id='Synq_Keycloak_Client_Secret' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Client_Secret_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Keycloak_Redirect_URI')}</FieldLabel>
									<FieldRow>
										<StringSettingInput _id='Synq_Keycloak_Redirect_URI' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Redirect_URI_Description')}</FieldHint>
								</Field>
							</FieldGroup>
						</CardBody>
					</Card>

					{/* User Provisioning Section */}
					<Card marginBlockEnd={16}>
						<CardHeader>
							<CardTitle>{t('User_Provisioning')}</CardTitle>
						</CardHeader>
						<CardBody>
							<FieldGroup>
								<Field>
									<FieldLabel>{t('Synq_Keycloak_Auto_Provision')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Keycloak_Auto_Provision' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Auto_Provision_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Keycloak_Auto_Update')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Keycloak_Auto_Update' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Auto_Update_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Keycloak_Sync_Groups')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Keycloak_Sync_Groups' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Sync_Groups_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Keycloak_Sync_Roles')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Keycloak_Sync_Roles' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Sync_Roles_Description')}</FieldHint>
								</Field>
							</FieldGroup>
						</CardBody>
					</Card>

					{/* Role Mapping Section */}
					<Card marginBlockEnd={16}>
						<CardHeader>
							<CardTitle>{t('Role_Mapping')}</CardTitle>
						</CardHeader>
						<CardBody>
							<FieldGroup>
								<Field>
									<FieldLabel>{t('Synq_Keycloak_Role_Mapping')}</FieldLabel>
									<FieldRow>
										<CodeSettingInput _id='Synq_Keycloak_Role_Mapping' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Role_Mapping_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Keycloak_Group_Mapping')}</FieldLabel>
									<FieldRow>
										<CodeSettingInput _id='Synq_Keycloak_Group_Mapping' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Group_Mapping_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Keycloak_Default_Role')}</FieldLabel>
									<FieldRow>
										<SelectSettingInput _id='Synq_Keycloak_Default_Role' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Default_Role_Description')}</FieldHint>
								</Field>
							</FieldGroup>
						</CardBody>
					</Card>

					{/* Advanced Configuration Section */}
					<Card marginBlockEnd={16}>
						<CardHeader>
							<CardTitle>{t('Advanced_Configuration')}</CardTitle>
						</CardHeader>
						<CardBody>
							<FieldGroup>
								<Field>
									<FieldLabel>{t('Synq_Keycloak_Sync_Interval')}</FieldLabel>
									<FieldRow>
										<IntSettingInput _id='Synq_Keycloak_Sync_Interval' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Sync_Interval_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Keycloak_Real_Time_Sync')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Keycloak_Real_Time_Sync' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Real_Time_Sync_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Keycloak_Debug_Logs')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Keycloak_Debug_Logs' />
									</FieldRow>
									<FieldHint>{t('Synq_Keycloak_Debug_Logs_Description')}</FieldHint>
								</Field>
							</FieldGroup>
						</CardBody>
					</Card>

					{/* Configuration Help */}
					<Callout type='info' title={t('Configuration_Help')}>
						<Box withRichContent>
							<p>{t('Synq_Keycloak_Configuration_Help_Text')}</p>
							<ul>
								<li>{t('Synq_Keycloak_Configuration_Step_1')}</li>
								<li>{t('Synq_Keycloak_Configuration_Step_2')}</li>
								<li>{t('Synq_Keycloak_Configuration_Step_3')}</li>
								<li>{t('Synq_Keycloak_Configuration_Step_4')}</li>
							</ul>
						</Box>
					</Callout>
				</Box>
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default SynqKeycloakPage;
