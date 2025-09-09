import { Box, Button, ButtonGroup, Icon } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';

import SynqLogo from './SynqLogo';

interface SynqHeaderProps {
	onMenuToggle?: () => void;
	showMenuButton?: boolean;
	user?: {
		name: string;
		avatar?: string;
	};
	onUserMenuClick?: () => void;
}

const SynqHeader = ({ 
	onMenuToggle, 
	showMenuButton = true, 
	user, 
	onUserMenuClick 
}: SynqHeaderProps): ReactElement => {
	const { t } = useTranslation();

	return (
		<Box
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				padding: '1rem 1.5rem',
				backgroundColor: '#ffffff',
				borderBottom: '1px solid #e1e5e9',
				boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
			}}
		>
			<Box style={{ display: 'flex', alignItems: 'center' }}>
				{showMenuButton && (
					<Button
						variant='ghost'
						icon='menu'
						onClick={onMenuToggle}
						style={{ marginRight: '1rem' }}
					/>
				)}
				<SynqLogo size="medium" style={{ marginRight: '0.5rem' }} />
				<Box style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#2f343d' }}>
					Synq
				</Box>
			</Box>

			<Box style={{ display: 'flex', alignItems: 'center' }}>
				<ButtonGroup>
					<Button variant='ghost' icon='bell' />
					<Button variant='ghost' icon='settings' />
					{user && (
						<Button
							variant='ghost'
							onClick={onUserMenuClick}
							style={{ display: 'flex', alignItems: 'center' }}
						>
							{user.avatar ? (
								<img
									src={user.avatar}
									alt={user.name}
									style={{
										width: '24px',
										height: '24px',
										borderRadius: '50%',
										marginRight: '0.5rem',
									}}
								/>
							) : (
								<Icon name='user' size='x16' style={{ marginRight: '0.5rem' }} />
							)}
							{user.name}
						</Button>
					)}
				</ButtonGroup>
			</Box>
		</Box>
	);
};

export default SynqHeader;
