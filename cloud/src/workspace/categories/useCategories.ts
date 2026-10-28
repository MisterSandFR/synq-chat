import { useEffect, useState } from 'react';

import type { Category } from '../../../shared/categories';
import type { Channel } from '../../../shared/types';
import { api } from '../../api';

// Toute modification de catégorie resynchronise les salons : relecture à chaque nouvelle liste.
export function useCategories(workspaceId: string, channels: Channel[] | null, tick = 0): Category[] {
	const [categories, setCategories] = useState<Category[]>([]);
	useEffect(() => {
		let live = true;
		api<Category[]>('GET', `/w/${workspaceId}/categories`).then(
			(list) => {
				if (live) {
					setCategories(list);
				}
			},
			() => undefined,
		);
		return () => {
			live = false;
		};
	}, [workspaceId, channels, tick]);
	return categories;
}
