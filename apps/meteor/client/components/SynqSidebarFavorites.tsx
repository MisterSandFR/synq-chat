import { Box, Icon, Badge, Button } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement, ReactNode } from 'react';

interface SynqSidebarFavoritesProps {
	favorites: ReactNode[];
	favoritesCount?: number;
	limit?: number;
	showCount?: boolean;
	onManageFavorites?: () => void;
}

const SynqSidebarFavorites = ({
	favorites,
	favoritesCount = 0,
	limit = 10,
	showCount = true,
	onManageFavorites,
}: SynqSidebarFavoritesProps): ReactElement => {
	const { t } = useTranslation();

	const displayFavorites = favorites.slice(0, limit);
	const hasMore = favorites.length > limit;

	return (
		<Box
			style={{
				marginBottom: '1rem',
				borderRadius: '4px',
				backgroundColor: 'var(--rc-color-sidebar-background, #2f343d)',
			}}
		>
			{/* En-tête des favoris */}
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
					name='star'
					size='x16'
					style={{
						marginRight: '0.5rem',
						color: 'var(--rc-color-accent, #ffd21f)',
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
					{t('Favorites')}
				</Box>

				{showCount && favoritesCount > 0 && (
					<Badge
						variant='secondary'
						style={{
							marginRight: '0.5rem',
							backgroundColor: 'var(--rc-color-accent, #ffd21f)',
							color: 'var(--rc-color-sidebar-background, #2f343d)',
						}}
					>
						{favoritesCount}
					</Badge>
				)}

				{onManageFavorites && (
					<Button
						size='x16'
						icon='settings'
						ghost
						onClick={onManageFavorites}
						title={t('Manage_Favorites')}
					/>
				)}
			</Box>

			{/* Liste des favoris */}
			<Box
				style={{
					padding: '0.25rem 0',
				}}
			>
				{displayFavorites}
				
				{hasMore && (
					<Box
						style={{
							padding: '0.25rem 0.5rem',
							fontSize: '0.75rem',
							color: 'var(--rc-color-sidebar-text, #ffffff)',
							opacity: 0.7,
							textAlign: 'center',
						}}
					>
						{t('And_more_favorites', { count: favorites.length - limit })}
					</Box>
				)}
			</Box>
		</Box>
	);
};

export default SynqSidebarFavorites;
