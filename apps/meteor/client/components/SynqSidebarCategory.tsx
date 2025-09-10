import { Box, Icon, Badge, Button } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';

interface SynqSidebarCategoryProps {
	id: string;
	name: string;
	icon?: string;
	channels: ReactNode[];
	channelCount?: number;
	collapsible?: boolean;
	defaultCollapsed?: boolean;
	showChannelCount?: boolean;
	showIcon?: boolean;
	onToggle?: (categoryId: string, collapsed: boolean) => void;
	onReorder?: (categoryId: string, direction: 'up' | 'down') => void;
	allowReorder?: boolean;
}

const SynqSidebarCategory = ({
	id,
	name,
	icon = 'folder',
	channels,
	channelCount = 0,
	collapsible = true,
	defaultCollapsed = false,
	showChannelCount = true,
	showIcon = true,
	onToggle,
	onReorder,
	allowReorder = false,
}: SynqSidebarCategoryProps): ReactElement => {
	const { t } = useTranslation();
	const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

	const handleToggle = () => {
		if (!collapsible) return;
		
		const newCollapsed = !isCollapsed;
		setIsCollapsed(newCollapsed);
		onToggle?.(id, newCollapsed);
	};

	const handleReorder = (direction: 'up' | 'down') => {
		onReorder?.(id, direction);
	};

	return (
		<Box
			style={{
				marginBottom: '0.5rem',
				borderRadius: '4px',
				backgroundColor: 'var(--rc-color-sidebar-background, #2f343d)',
			}}
		>
			{/* En-tête de catégorie */}
			<Box
				style={{
					display: 'flex',
					alignItems: 'center',
					padding: '0.5rem',
					cursor: collapsible ? 'pointer' : 'default',
					borderRadius: '4px',
					backgroundColor: 'var(--rc-color-sidebar-hover, #3a4049)',
				}}
				onClick={handleToggle}
			>
				{showIcon && (
					<Icon
						name={icon}
						size='x16'
						style={{
							marginRight: '0.5rem',
							color: 'var(--rc-color-sidebar-text, #ffffff)',
						}}
					/>
				)}
				
				<Box
					style={{
						flex: 1,
						fontWeight: 'bold',
						color: 'var(--rc-color-sidebar-text, #ffffff)',
						fontSize: '0.875rem',
					}}
				>
					{name}
				</Box>

				{showChannelCount && channelCount > 0 && (
					<Badge
						variant='secondary'
						style={{
							marginRight: '0.5rem',
							backgroundColor: 'var(--rc-color-primary, #1d74f5)',
							color: 'white',
						}}
					>
						{channelCount}
					</Badge>
				)}

				{collapsible && (
					<Icon
						name={isCollapsed ? 'chevron-right' : 'chevron-down'}
						size='x16'
						style={{
							color: 'var(--rc-color-sidebar-text, #ffffff)',
						}}
					/>
				)}

				{allowReorder && (
					<Box style={{ marginLeft: '0.5rem', display: 'flex', flexDirection: 'column' }}>
						<Button
							size='x16'
							icon='arrow-up'
							ghost
							onClick={(e) => {
								e.stopPropagation();
								handleReorder('up');
							}}
						/>
						<Button
							size='x16'
							icon='arrow-down'
							ghost
							onClick={(e) => {
								e.stopPropagation();
								handleReorder('down');
							}}
						/>
					</Box>
				)}
			</Box>

			{/* Liste des canaux */}
			{!isCollapsed && (
				<Box
					style={{
						padding: '0.25rem 0',
					}}
				>
					{channels}
				</Box>
			)}
		</Box>
	);
};

export default SynqSidebarCategory;


