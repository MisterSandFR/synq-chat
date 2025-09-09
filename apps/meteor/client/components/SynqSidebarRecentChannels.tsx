import { Box, Icon, Badge, Button } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement, ReactNode } from 'react';

interface SynqSidebarRecentChannelsProps {
	recentChannels: ReactNode[];
	recentCount?: number;
	limit?: number;
	showCount?: boolean;
	onClearRecent?: () => void;
}

const SynqSidebarRecentChannels = ({
	recentChannels,
	recentCount = 0,
	limit = 5,
	showCount = true,
	onClearRecent,
}: SynqSidebarRecentChannelsProps): ReactElement => {
	const { t } = useTranslation();

	const displayRecent = recentChannels.slice(0, limit);

	return (
		<Box
			style={{
				marginBottom: '1rem',
				borderRadius: '4px',
				backgroundColor: 'var(--rc-color-sidebar-background, #2f343d)',
			}}
		>
			{/* En-tête des canaux récents */}
			<Box
				style={{
					display: 'flex',
					alignItems: 'center',
					padding: '0.5rem',
					borderRadius: '4px',
					backgroundColor: 'var(--rc-color-sidebar-hover, #3a4049)',
				}}
			>
				<Icon
					name='clock'
					size='x16'
					style={{
						marginRight: '0.5rem',
						color: 'var(--rc-color-sidebar-text, #ffffff)',
					}}
				/>
				
				<Box
					style={{
						flex: 1,
						fontWeight: 'bold',
						color: 'var(--rc-color-sidebar-text, #ffffff)',
						fontSize: '0.875rem',
					}}
				>
					{t('Recent_Channels')}
				</Box>

				{showCount && recentCount > 0 && (
					<Badge
						variant='secondary'
						style={{
							marginRight: '0.5rem',
							backgroundColor: 'var(--rc-color-secondary, #f5455c)',
							color: 'white',
						}}
					>
						{recentCount}
					</Badge>
				)}

				{onClearRecent && (
					<Button
						size='x16'
						icon='trash'
						ghost
						onClick={onClearRecent}
						title={t('Clear_Recent')}
					/>
				)}
			</Box>

			{/* Liste des canaux récents */}
			<Box
				style={{
					padding: '0.25rem 0',
				}}
			>
				{displayRecent}
			</Box>
		</Box>
	);
};

export default SynqSidebarRecentChannels;
