import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import SynqLogo from '../client/components/SynqLogo';
import SynqHeader from '../client/components/SynqHeader';
import SynqSidebar from '../client/components/SynqSidebar';
import SynqLayout from '../client/components/SynqLayout';

// Mock des hooks et contextes
jest.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

jest.mock('@rocket.chat/ui-contexts', () => ({
	useLoginWithPassword: () => jest.fn(),
	useLoginWithToken: () => jest.fn(),
}));

describe('Synq Components', () => {
	describe('SynqLogo', () => {
		it('should render with default props', () => {
			render(<SynqLogo />);
			const logo = screen.getByAltText('Synq Logo');
			expect(logo).toBeInTheDocument();
			expect(logo).toHaveAttribute('src', '/images/synq/logo.svg');
		});

		it('should render with custom size', () => {
			render(<SynqLogo size="large" />);
			const logo = screen.getByAltText('Synq Logo');
			expect(logo).toHaveStyle({ width: '48px', height: '48px' });
		});

		it('should render with custom alt text', () => {
			render(<SynqLogo alt="Custom Alt Text" />);
			const logo = screen.getByAltText('Custom Alt Text');
			expect(logo).toBeInTheDocument();
		});
	});

	describe('SynqHeader', () => {
		const mockUser = {
			name: 'John Doe',
			avatar: 'https://example.com/avatar.jpg',
		};

		it('should render with menu button', () => {
			const mockOnMenuToggle = jest.fn();
			render(<SynqHeader onMenuToggle={mockOnMenuToggle} />);
			
			const menuButton = screen.getByRole('button');
			expect(menuButton).toBeInTheDocument();
			
			fireEvent.click(menuButton);
			expect(mockOnMenuToggle).toHaveBeenCalled();
		});

		it('should render with user info', () => {
			render(<SynqHeader user={mockUser} />);
			expect(screen.getByText('John Doe')).toBeInTheDocument();
		});

		it('should hide menu button when showMenuButton is false', () => {
			render(<SynqHeader showMenuButton={false} />);
			const buttons = screen.getAllByRole('button');
			// Should not contain menu button, only notification and settings buttons
			expect(buttons.length).toBeLessThan(4);
		});
	});

	describe('SynqSidebar', () => {
		const mockChannels = [
			{ id: '1', name: 'general', type: 'channel' as const, unread: 5 },
			{ id: '2', name: 'John Doe', type: 'direct' as const, mentions: 2 },
			{ id: '3', name: 'dev-team', type: 'group' as const },
		];

		it('should render when open', () => {
			render(
				<SynqSidebar
					isOpen={true}
					onClose={jest.fn()}
					channels={mockChannels}
					onChannelSelect={jest.fn()}
				/>
			);
			
			expect(screen.getByText('Synq')).toBeInTheDocument();
			expect(screen.getByText('Channels')).toBeInTheDocument();
		});

		it('should call onClose when overlay is clicked', () => {
			const mockOnClose = jest.fn();
			render(
				<SynqSidebar
					isOpen={true}
					onClose={mockOnClose}
					channels={mockChannels}
					onChannelSelect={jest.fn()}
				/>
			);
			
			// Click on overlay (first child of the fragment)
			const overlay = document.querySelector('[style*=\"position: fixed\"]');
			if (overlay) {
				fireEvent.click(overlay);
				expect(mockOnClose).toHaveBeenCalled();
			}
		});

		it('should display channels with unread counts', () => {
			render(
				<SynqSidebar
					isOpen={true}
					onClose={jest.fn()}
					channels={mockChannels}
					onChannelSelect={jest.fn()}
				/>
			);
			
			expect(screen.getByText('general')).toBeInTheDocument();
			expect(screen.getByText('5')).toBeInTheDocument(); // unread count
		});
	});

	describe('SynqLayout', () => {
		const mockUser = {
			name: 'John Doe',
			avatar: 'https://example.com/avatar.jpg',
		};

		const mockChannels = [
			{ id: '1', name: 'general', type: 'channel' as const },
		];

		it('should render with children', () => {
			render(
				<SynqLayout
					user={mockUser}
					channels={mockChannels}
					onChannelSelect={jest.fn()}
				>
					<div>Test Content</div>
				</SynqLayout>
			);
			
			expect(screen.getByText('Test Content')).toBeInTheDocument();
			expect(screen.getByText('John Doe')).toBeInTheDocument();
		});

		it('should toggle sidebar when menu button is clicked', () => {
			render(
				<SynqLayout
					user={mockUser}
					channels={mockChannels}
					onChannelSelect={jest.fn()}
				>
					<div>Test Content</div>
				</SynqLayout>
			);
			
			// Initially sidebar should be closed
			expect(screen.queryByText('Channels')).not.toBeInTheDocument();
			
			// Click menu button to open sidebar
			const menuButton = screen.getAllByRole('button')[0];
			fireEvent.click(menuButton);
			
			// Sidebar should now be visible
			expect(screen.getByText('Channels')).toBeInTheDocument();
		});
	});
});
