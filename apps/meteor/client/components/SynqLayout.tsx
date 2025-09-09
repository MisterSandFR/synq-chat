import { Box } from '@rocket.chat/fuselage';
import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';

import SynqHeader from './SynqHeader';
import SynqSidebar from './SynqSidebar';

interface SynqLayoutProps {
	children: ReactNode;
	user?: {
		name: string;
		avatar?: string;
	};
	channels?: Array<{
		id: string;
		name: string;
		type: 'channel' | 'direct' | 'group';
		unread?: number;
		mentions?: number;
	}>;
	currentChannel?: string;
	onChannelSelect: (channelId: string) => void;
	onUserMenuClick?: () => void;
}

const SynqLayout = ({
	children,
	user,
	channels = [],
	currentChannel,
	onChannelSelect,
	onUserMenuClick,
}: SynqLayoutProps): ReactElement => {
	const [sidebarOpen, setSidebarOpen] = useState(false);

	const handleMenuToggle = () => {
		setSidebarOpen(!sidebarOpen);
	};

	const handleSidebarClose = () => {
		setSidebarOpen(false);
	};

	return (
		<Box style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
			<SynqHeader
				onMenuToggle={handleMenuToggle}
				user={user}
				onUserMenuClick={onUserMenuClick}
			/>
			
			<Box style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
				<SynqSidebar
					isOpen={sidebarOpen}
					onClose={handleSidebarClose}
					currentChannel={currentChannel}
					channels={channels}
					onChannelSelect={onChannelSelect}
				/>
				
				<Box
					style={{
						flex: 1,
						display: 'flex',
						flexDirection: 'column',
						overflow: 'hidden',
						marginLeft: sidebarOpen ? '300px' : '0',
						transition: 'margin-left 0.3s ease',
					}}
				>
					{children}
				</Box>
			</Box>
		</Box>
	);
};

export default SynqLayout;
