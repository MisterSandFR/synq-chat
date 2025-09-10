import { Box, Card, CardBody, CardHeader, CardTitle, Field, FieldGroup, FieldLabel, FieldRow, FieldHint, Callout } from '@rocket.chat/fuselage';
import { useSetting } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import { Page, PageHeader, PageScrollableContentWithShadow } from '../../../components/Page';
import BooleanSettingInput from '../settings/Setting/inputs/BooleanSettingInput';
import CodeSettingInput from '../settings/Setting/inputs/CodeSettingInput';
import IntSettingInput from '../settings/Setting/inputs/IntSettingInput';

const SynqSidebarPage = (): ReactElement => {
	const { t } = useTranslation();

	// Channel Categories Settings
	const categoriesEnabled = useSetting('Synq_Sidebar_Categories_Enabled');
	const defaultCategories = useSetting('Synq_Sidebar_Default_Categories');
	const allowUserCategories = useSetting('Synq_Sidebar_Allow_User_Categories');
	const allowReorder = useSetting('Synq_Sidebar_Allow_Reorder');

	// Sidebar Appearance Settings
	const showCategoryIcons = useSetting('Synq_Sidebar_Show_Category_Icons');
	const showChannelCount = useSetting('Synq_Sidebar_Show_Channel_Count');
	const collapsibleCategories = useSetting('Synq_Sidebar_Collapsible_Categories');
	const defaultCollapsed = useSetting('Synq_Sidebar_Default_Collapsed');

	// Favorites System Settings
	const enhancedFavorites = useSetting('Synq_Sidebar_Enhanced_Favorites');
	const favoritesAtTop = useSetting('Synq_Sidebar_Favorites_At_Top');
	const favoritesLimit = useSetting('Synq_Sidebar_Favorites_Limit');

	// Advanced Features Settings
	const enableSearch = useSetting('Synq_Sidebar_Enable_Search');
	const showRecentChannels = useSetting('Synq_Sidebar_Show_Recent_Channels');
	const recentChannelsLimit = useSetting('Synq_Sidebar_Recent_Channels_Limit');
	const keyboardShortcuts = useSetting('Synq_Sidebar_Keyboard_Shortcuts');

	return (
		<Page bg='tint'>
			<PageHeader title={t('Synq_Sidebar')} />
			<PageScrollableContentWithShadow p={16}>
				<Box marginBlock='none' marginInline='auto' width='full' color='default'>
					{/* Channel Categories Section */}
					<Card marginBlockEnd={16}>
						<CardHeader>
							<CardTitle>{t('Channel_Categories')}</CardTitle>
						</CardHeader>
						<CardBody>
							<FieldGroup>
								<Field>
									<FieldLabel>{t('Synq_Sidebar_Categories_Enabled')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Sidebar_Categories_Enabled' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Categories_Enabled_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Default_Categories')}</FieldLabel>
									<FieldRow>
										<CodeSettingInput _id='Synq_Sidebar_Default_Categories' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Default_Categories_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Allow_User_Categories')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Sidebar_Allow_User_Categories' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Allow_User_Categories_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Allow_Reorder')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Sidebar_Allow_Reorder' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Allow_Reorder_Description')}</FieldHint>
								</Field>
							</FieldGroup>
						</CardBody>
					</Card>

					{/* Sidebar Appearance Section */}
					<Card marginBlockEnd={16}>
						<CardHeader>
							<CardTitle>{t('Sidebar_Appearance')}</CardTitle>
						</CardHeader>
						<CardBody>
							<FieldGroup>
								<Field>
									<FieldLabel>{t('Synq_Sidebar_Show_Category_Icons')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Sidebar_Show_Category_Icons' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Show_Category_Icons_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Show_Channel_Count')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Sidebar_Show_Channel_Count' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Show_Channel_Count_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Collapsible_Categories')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Sidebar_Collapsible_Categories' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Collapsible_Categories_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Default_Collapsed')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Sidebar_Default_Collapsed' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Default_Collapsed_Description')}</FieldHint>
								</Field>
							</FieldGroup>
						</CardBody>
					</Card>

					{/* Favorites System Section */}
					<Card marginBlockEnd={16}>
						<CardHeader>
							<CardTitle>{t('Favorites_System')}</CardTitle>
						</CardHeader>
						<CardBody>
							<FieldGroup>
								<Field>
									<FieldLabel>{t('Synq_Sidebar_Enhanced_Favorites')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Sidebar_Enhanced_Favorites' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Enhanced_Favorites_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Favorites_At_Top')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Sidebar_Favorites_At_Top' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Favorites_At_Top_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Favorites_Limit')}</FieldLabel>
									<FieldRow>
										<IntSettingInput _id='Synq_Sidebar_Favorites_Limit' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Favorites_Limit_Description')}</FieldHint>
								</Field>
							</FieldGroup>
						</CardBody>
					</Card>

					{/* Advanced Features Section */}
					<Card marginBlockEnd={16}>
						<CardHeader>
							<CardTitle>{t('Advanced_Features')}</CardTitle>
						</CardHeader>
						<CardBody>
							<FieldGroup>
								<Field>
									<FieldLabel>{t('Synq_Sidebar_Enable_Search')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Sidebar_Enable_Search' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Enable_Search_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Show_Recent_Channels')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Sidebar_Show_Recent_Channels' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Show_Recent_Channels_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Recent_Channels_Limit')}</FieldLabel>
									<FieldRow>
										<IntSettingInput _id='Synq_Sidebar_Recent_Channels_Limit' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Recent_Channels_Limit_Description')}</FieldHint>
								</Field>

								<Field>
									<FieldLabel>{t('Synq_Sidebar_Keyboard_Shortcuts')}</FieldLabel>
									<FieldRow>
										<BooleanSettingInput _id='Synq_Sidebar_Keyboard_Shortcuts' />
									</FieldRow>
									<FieldHint>{t('Synq_Sidebar_Keyboard_Shortcuts_Description')}</FieldHint>
								</Field>
							</FieldGroup>
						</CardBody>
					</Card>

					{/* Configuration Help */}
					<Callout type='info' title={t('Configuration_Help')}>
						<Box withRichContent>
							<p>{t('Synq_Sidebar_Configuration_Help_Text')}</p>
							<ul>
								<li>{t('Synq_Sidebar_Configuration_Step_1')}</li>
								<li>{t('Synq_Sidebar_Configuration_Step_2')}</li>
								<li>{t('Synq_Sidebar_Configuration_Step_3')}</li>
								<li>{t('Synq_Sidebar_Configuration_Step_4')}</li>
							</ul>
						</Box>
					</Callout>
				</Box>
			</PageScrollableContentWithShadow>
		</Page>
	);
};

export default SynqSidebarPage;


