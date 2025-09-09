import React from 'react';
import { Box, Page, PageHeader, PageContent } from '@rocket.chat/fuselage';
import { useTranslation } from '@rocket.chat/ui-client';
import { SettingsGroupPage } from '../SettingsGroupPage';
import { SynqBridge } from '../../components/SynqBridge';

export const SynqBridgePage: React.FC = () => {
	const t = useTranslation();

	return (
		<Page>
			<PageHeader title={t('Synq_Bridge')} />
			<PageContent>
				<Box>
					<SettingsGroupPage
						_id="synq-bridge"
						header={<Box fontScale="h2">{t('Synq_Bridge')}</Box>}
						description={t('Synq_Bridge_Description')}
					>
						<SynqBridge />
					</SettingsGroupPage>
				</Box>
			</PageContent>
		</Page>
	);
};
