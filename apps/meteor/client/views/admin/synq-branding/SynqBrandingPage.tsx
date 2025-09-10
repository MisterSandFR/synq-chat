import { Box, Card, CardBody, CardHeader, CardTitle, Field, FieldGroup, FieldLabel, FieldRow, FieldHint } from '@rocket.chat/fuselage';
import { useSetting } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Page, PageHeader, PageScrollableContentWithShadow } from '../../../components/Page';
import AssetSettingInput from '../settings/Setting/inputs/AssetSettingInput';
import ColorSettingInput from '../settings/Setting/inputs/ColorSettingInput';
import StringSettingInput from '../settings/Setting/inputs/StringSettingInput';
import BooleanSettingInput from '../settings/Setting/inputs/BooleanSettingInput';
import CodeSettingInput from '../settings/Setting/inputs/CodeSettingInput';

const SynqBrandingPage = (): ReactElement => {
	const { t } = useTranslation();

	// Workspace Branding Settings
	const workspaceName = useSetting('Synq_Workspace_Name');
	const logo = useSetting('Synq_Logo');
	const logoDark = useSetting('Synq_Logo_Dark');
	const favicon = useSetting('Synq_Favicon');
	const primaryColor = useSetting('Synq_Primary_Color');
	const secondaryColor = useSetting('Synq_Secondary_Color');
	const accentColor = useSetting('Synq_Accent_Color');
	const backgroundColor = useSetting('Synq_Background_Color');
	const textColor = useSetting('Synq_Text_Color');

	// Login Page Settings
	const loginBackgroundImage = useSetting('Synq_Login_Background_Image');
	const loginBackgroundColor = useSetting('Synq_Login_Background_Color');
	const loginWelcomeText = useSetting('Synq_Login_Welcome_Text');
	const loginSubtitleText = useSetting('Synq_Login_Subtitle_Text');
	const loginHideLogo = useSetting('Synq_Login_Hide_Logo');
	const loginHideTitle = useSetting('Synq_Login_Hide_Title');

	// Sidebar Settings
	const sidebarBackgroundColor = useSetting('Synq_Sidebar_Background_Color');
	const sidebarTextColor = useSetting('Synq_Sidebar_Text_Color');
	const sidebarHoverColor = useSetting('Synq_Sidebar_Hover_Color');

	// Advanced Settings
	const customCSS = useSetting('Synq_Custom_CSS');
	const customJavaScript = useSetting('Synq_Custom_JavaScript');
	const defaultDarkTheme = useSetting('Synq_Default_Dark_Theme');

	return (
		<Page bg='tint'>
			<PageHeader title={t('Synq_Branding')} />
			<PageScrollableContentWithShadow p={16}>
				<Box marginBlock='none' marginInline='auto' width='full' color='default'>
					{/* Workspace Branding Section */}
					<Card marginBlockEnd={16}>
						<CardHeader>
							<CardTitle>{t('Workspace_Branding')}</CardTitle>
						</CardHeader>
						<CardBody>
							<FieldGroup>
								<Field>
									<FieldLabel>{t('Synq_Workspace_Name')}</FieldLabel>
									<FieldRow>
										<StringSettingInput _id='Synq_Workspace_Name' />
									</FieldRow>
									<FieldHint>{t('Synq_Workspace_Name_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Logo')}</FieldLabel>
									<FieldRow>
										<AssetSettingInput _id='Synq_Logo' />
									</FieldRow>
									<FieldHint>{t('Synq_Logo_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Logo_Dark')}</FieldLabel>
									<FieldRow>
										<AssetSettingInput _id='Synq_Logo_Dark' />
									</FieldRow>
									<FieldHint>{t('Synq_Logo_Dark_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Favicon')}</FieldLabel>
									<FieldRow>
										<AssetSettingInput _id='Synq_Favicon' />
									</FieldRow>
									<FieldHint>{t('Synq_Favicon_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Primary_Color')}</FieldLabel>
									<FieldRow>
										<ColorSettingInput _id='Synq_Primary_Color' />
									</FieldRow>
									<FieldHint>{t('Synq_Primary_Color_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Secondary_Color')}</FieldLabel>
									<FieldRow>
										<ColorSettingInput _id='Synq_Secondary_Color' />
									</FieldRow>
									<FieldHint>{t('Synq_Secondary_Color_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Accent_Color')}</FieldLabel>
									<FieldRow>
										<ColorSettingInput _id='Synq_Accent_Color' />
									</FieldRow>
									<FieldHint>{t('Synq_Accent_Color_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Background_Color')}</FieldLabel>
									<FieldRow>
										<ColorSettingInput _id='Synq_Background_Color' />
									</FieldRow>
									<FieldHint>{t('Synq_Background_Color_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Text_Color')}</FieldLabel>
									<FieldRow>
										<ColorSettingInput _id='Synq_Text_Color' />
									</FieldRow>
									<FieldHint>{t('Synq_Text_Color_Description')}</FieldHint>
								</Field>
							</FieldGroup>
						</CardBody>
					</Card>

					{/* Login Page Customization Section */}
					<Card marginBlockEnd={16}>
						<CardHeader>
							<CardTitle>{t('Login_Page_Customization')}</CardTitle>
						</CardHeader>
						<CardBody>
							<FieldGroup>
								<Field>
									<FieldLabel>{t('Synq_Login_Background_Image')}</FieldLabel>
									<FieldRow>
										<AssetSettingInput _id='Synq_Login_Background_Image' />
									</FieldRow>
									<FieldHint>{t('Synq_Login_Background_Image_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Login_Background_Color')}</FieldLabel>
									<FieldRow>
										<ColorSettingInput _id='Synq_Login_Background_Color' />
									</FieldRow>
									<FieldHint>{t('Synq_Login_Background_Color_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Login_Welcome_Text')}</FieldLabel>
									<FieldRow>
										<StringSettingInput _id='Synq_Login_Welcome_Text' />
									</FieldRow>
									<FieldHint>{t('Synq_Login_Welcome_Text_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Login_Subtitle_Text')}</FieldLabel>
									<FieldRow>
										<StringSettingInput _id='Synq_Login_Subtitle_Text' />
									</FieldRow>
									<FieldHint>{t('Synq_Login_Subtitle_Text_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Login_Hide_Logo')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Login_Hide_Logo' />
									</FieldRow>
									<FieldHint>{t('Synq_Login_Hide_Logo_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Login_Hide_Title')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Login_Hide_Title' />
									</FieldRow>
									<FieldHint>{t('Synq_Login_Hide_Title_Description')}</FieldHint>
								</Field>
							</FieldGroup>
						</CardBody>
					</Card>

					{/* Sidebar Customization Section */}
					<Card marginBlockEnd={16}>
						<CardHeader>
							<CardTitle>{t('Sidebar_Customization')}</CardTitle>
						</CardHeader>
						<CardBody>
							<FieldGroup>
								<Field>
									<FieldLabel>{t('Synq_Sidebar_Background_Color')}</FieldLabel>
									<FieldRow>
										<ColorSettingInput _id='Synq_Sidebar_Background_Color' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Background_Color_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Text_Color')}</FieldLabel>
									<FieldRow>
										<ColorSettingInput _id='Synq_Sidebar_Text_Color' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Text_Color_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Hover_Color')}</FieldLabel>
									<FieldRow>
										<ColorSettingInput _id='Synq_Sidebar_Hover_Color' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Hover_Color_Description')}</FieldHint>
								</Field>
							</FieldGroup>
						</CardBody>
					</Card>

					{/* Advanced Customization Section */}
					<Card marginBlockEnd={16}>
						<CardHeader>
							<CardTitle>{t('Advanced_Customization')}</CardTitle>
						</CardHeader>
						<CardBody>
							<FieldGroup>
								<Field>
									<FieldLabel>{t('Synq_Custom_CSS')}</FieldLabel>
									<FieldRow>
										<CodeSettingInput _id='Synq_Custom_CSS' />
									</FieldRow>
									<FieldHint>{t('Synq_Custom_CSS_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Custom_JavaScript')}</FieldLabel>
									<FieldRow>
										<CodeSettingInput _id='Synq_Custom_JavaScript' />
									</FieldRow>
									<FieldHint>{t('Synq_Custom_JavaScript_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Default_Dark_Theme')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Default_Dark_Theme' />
									</FieldRow>
									<FieldHint>{t('Synq_Default_Dark_Theme_Description')}</FieldHint>
								</Field>
							</FieldGroup>
						</CardBody>
					</Card>
				</Box>
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default SynqBrandingPage;


