import { Box, Callout, Link } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';

import { SettingsGroupPage } from '../settings/SettingsGroupPage';

const SynqUXPage = () => {
	const { t } = useTranslation();
	return (
		<SettingsGroupPage group='Synq_UX'>
			<Box mbs={24}>
				<Callout title={t('Configuration_Help')} type='info'>
					<Box withRichContent>
						<p>{t('Synq_UX_Configuration_Help_Text')}</p>
						<ol>
							<li>{t('Synq_UX_Configuration_Step_1')}</li>
							<li>{t('Synq_UX_Configuration_Step_2')}</li>
							<li>{t('Synq_UX_Configuration_Step_3')}</li>
							<li>{t('Synq_UX_Configuration_Step_4')}</li>
						</ol>
						<p>
							<Link
								href='https://docs.rocket.chat/docs/collaborate-using-rocketchat/user-guide'
								target='_blank'
								rel='noopener noreferrer'
							>
								{t('Click_here_for_more_info')}
							</Link>
						</p>
					</Box>
				</Callout>
			</Box>
		</SettingsGroupPage>
	);
};

export default SynqUXPage;
