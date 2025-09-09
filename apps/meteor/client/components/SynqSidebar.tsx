import { Box, Button, ButtonGroup, Icon, Badge } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import { useState } from 'react';

import SynqLogo from './SynqLogo';

interface SynqSidebarProps {
	isOpen: boolean;
	onClose: () => void;
	currentChannel?: string;
	channels?: Array<{
		id: string;
		name: string;
		type: 'channel' | 'direct' | 'group';
		unread?: number;
		mentions?: number;
	}>;
	onChannelSelect: (channelId: string) => void;
}

const SynqSidebar = ({ 
	isOpen, 
	onClose, 
	currentChannel, 
	channels = [], 
	onChannelSelect 
}: SynqSidebarProps): ReactElement => {
	const { t } = useTranslation();
	const [activeSection, setActiveSection] = useState('channels');

	const sidebarStyle = {
		position: 'fixed' as const,
		top: 0,
		left: isOpen ? 0 : '-300px',
		width: '300px',
		height: '100vh',
		backgroundColor: '#ffffff',
		borderRight: '1px solid #e1e5e9',
		boxShadow: isOpen ? '2px 0 5px rgba(0, 0, 0, 0.1)' : 'none',
		transition: 'left 0.3s ease',
		zIndex: 1000,
		overflowY: 'auto' as const,
	};

	const overlayStyle = {
		position: 'fixed' as const,
		top: 0,
		left: 0,
		width: '100vw',
		height: '100vh',
		backgroundColor: 'rgba(0, 0, 0, 0.5)',
		zIndex: 999,
		display: isOpen ? 'block' : 'none',
	};

	return (
		<>
			{isOpen && (
				<Box style={overlayStyle} onClick={onClose} />
			)}
			<Box style={sidebarStyle}>
				{/* Header */}
				<Box
					style={{
						padding: '1rem',
						borderBottom: '1px solid #e1e5e9',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
					}}
				>
					<Box style={{ display: 'flex', alignItems: 'center' }}>
						<SynqLogo size="small" style={{ marginRight: '0.5rem' }} />
						<Box style={{ fontSize: '1.125rem', fontWeight: 'bold' }}>
							Synq
						</Box>
					</Box>
					<Button variant='ghost' icon='cross' onClick={onClose} />
				</Box>

				{/* Navigation */}
				<Box style={{ padding: '1rem' }}>
					<ButtonGroup vertical stretch>
						<Button
							variant={activeSection === 'channels' ? 'primary' : 'ghost'}
							icon='hash'
							onClick={() => setActiveSection('channels')}
							style={{ justifyContent: 'flex-start', marginBottom: '0.5rem' }}
						>
							{t('Channels')}
						</Button>
						<Button
							variant={activeSection === 'direct' ? 'primary' : 'ghost'}
							icon='user'
							onClick={() => setActiveSection('direct')}
							style={{ justifyContent: 'flex-start', marginBottom: '0.5rem' }}
						>
							{t('Direct_Messages')}
						</Button>
						<Button
							variant={activeSection === 'groups' ? 'primary' : 'ghost'}
							icon='team'
							onClick={() => setActiveSection('groups')}
							style={{ justifyContent: 'flex-start', marginBottom: '0.5rem' }}
						>
							{t('Groups')}
						</Button>
					</ButtonGroup>
				</Box>

				{/* Channels List */}
				<Box style={{ padding: '0 1rem 1rem' }}>
					<Box style={{ fontSize: '0.875rem', fontWeight: 'bold', marginBottom: '0.5rem', color: '#666' }}>
						{activeSection === 'channels' && t('Channels')}
						{activeSection === 'direct' && t('Direct_Messages')}
						{activeSection === 'groups' && t('Groups')}
					</Box>
					{channels
						.filter(channel => {
							if (activeSection === 'channels') return channel.type === 'channel';
							if (activeSection === 'direct') return channel.type === 'direct';
							if (activeSection === 'groups') return channel.type === 'group';
							return false;
						})
						.map(channel => (
							<Button
								key={channel.id}
								variant={currentChannel === channel.id ? 'primary' : 'ghost'}
								onClick={() => onChannelSelect(channel.id)}
								style={{
									width: '100%',
									justifyContent: 'flex-start',
									marginBottom: '0.25rem',
									position: 'relative',
								}}
							>
								<Icon 
									name={channel.type === 'channel' ? 'hash' : channel.type === 'direct' ? 'user' : 'team'} 
									size='x16' 
									style={{ marginRight: '0.5rem' }} 
								/>
								{channel.name}
								{channel.unread && channel.unread > 0 && (
									<Badge variant='danger' style={{ marginLeft: 'auto' }}>
										{channel.unread}
									</Badge>
								)}
								{channel.mentions && channel.mentions > 0 && (
									<Badge variant='warning' style={{ marginLeft: 'auto' }}>
										{channel.mentions}
									</Badge>
								)}
							</Button>
						))}
				</Box>

				{/* Footer */}
				<Box
					style={{
						position: 'absolute',
						bottom: 0,
						left: 0,
						right: 0,
						padding: '1rem',
						borderTop: '1px solid #e1e5e9',
						backgroundColor: '#f7f8fa',
					}}
				>
					<ButtonGroup vertical stretch>
						<Button variant='ghost' icon='settings' style={{ justifyContent: 'flex-start' }}>
							{t('Settings')}
						</Button>
						<Button variant='ghost' icon='help' style={{ justifyContent: 'flex-start' }}>
							{t('Help')}
						</Button>
					</ButtonGroup>
				</Box>
			</Box>
		</>
	);
};

export default SynqSidebar;
