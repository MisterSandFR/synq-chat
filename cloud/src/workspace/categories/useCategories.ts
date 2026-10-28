import { useEffect, useState } from 'react';

import type { Category } from '../../../shared/categories';
import type { Channel } from '../../../shared/types';
import { api } from '../../api';

// Toute modification de catégorie resynchronise les salons : relecture quand leur rangement change, pas à chaque nouveau tableau.
// Null jusqu'à la première réponse : la liste n'apparaît pas à plat avant d'être rangée.
export function useCategories(workspaceId: string, channels: Channel[] | null, tick = 0): Category[] | null {
	const [categories, setCategories] = useState<Category[] | null>(null);
	const layout = channels?.map((c) => `${c.id}:${c.categoryId ?? ''}:${c.position}`).join('|') ?? '';
	useEffect(() => {
		let live = true;
		api<Category[]>('GET', `/w/${workspaceId}/categories`).then(
			(list) => {
				if (live) {
					setCategories(list);
				}
			},
			() => live && setCategories((current) => current ?? []),
		);
		return () => {
			live = false;
		};
	}, [workspaceId, layout, tick]);
	return categories;
}
