import { Box, SearchInput, Icon } from '@rocket.chat/fuselage';
import { useDebouncedValue } from '@rocket.chat/fuselage-hooks';
import type { ReactElement } from 'react';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

interface SynqSidebarSearchProps {
	onSearch: (query: string) => void;
	placeholder?: string;
	enabled?: boolean;
}

const SynqSidebarSearch = ({
	onSearch,
	placeholder,
	enabled = true,
}: SynqSidebarSearchProps): ReactElement => {
	const { t } = useTranslation();
	const [searchQuery, setSearchQuery] = useState('');
	const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);

	const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
		const query = e.currentTarget.value;
		setSearchQuery(query);
	}, []);

	// Déclencher la recherche quand la requête débounced change
	React.useEffect(() => {
		onSearch(debouncedSearchQuery);
	}, [debouncedSearchQuery, onSearch]);

	if (!enabled) {
		return null;
	}

	return (
		<Box
			style={{
				padding: '0.5rem',
				borderBottom: '1px solid var(--rc-color-sidebar-hover, #3a4049)',
			}}
		>
			<SearchInput
				value={searchQuery}
				placeholder={placeholder || t('Search_channels')}
				onChange={handleSearchChange}
				addon={<Icon name='magnifier' size='x16' />}
				style={{
					backgroundColor: 'var(--rc-color-sidebar-background, #2f343d)',
					borderColor: 'var(--rc-color-sidebar-hover, #3a4049)',
					color: 'var(--rc-color-sidebar-text, #ffffff)',
				}}
			/>
		</Box>
	);
};

export default SynqSidebarSearch;


