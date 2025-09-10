import { useState, useEffect, useCallback } from 'react';
import { useSettings } from '@rocket.chat/ui-contexts';

export interface ChannelCategory {
	id: string;
	name: string;
	icon: string;
	channels: string[];
	order: number;
	collapsed: boolean;
	userCreated: boolean;
}

export interface UserCategoryPreferences {
	[categoryId: string]: {
		collapsed: boolean;
		order: number;
	};
}

export const useSynqSidebarCategories = () => {
	const settings = useSettings();
	const [categories, setCategories] = useState<ChannelCategory[]>([]);
	const [userPreferences, setUserPreferences] = useState<UserCategoryPreferences>({});

	// Charger les catégories par défaut depuis les settings
	useEffect(() => {
		const defaultCategoriesConfig = settings.Synq_Sidebar_Default_Categories;
		if (defaultCategoriesConfig) {
			try {
				const defaultCategories = JSON.parse(defaultCategoriesConfig);
				setCategories(defaultCategories);
			} catch (error) {
				console.error('Erreur lors du parsing des catégories par défaut:', error);
			}
		}
	}, [settings.Synq_Sidebar_Default_Categories]);

	// Charger les préférences utilisateur depuis le localStorage
	useEffect(() => {
		const savedPreferences = localStorage.getItem('synq-sidebar-preferences');
		if (savedPreferences) {
			try {
				const preferences = JSON.parse(savedPreferences);
				setUserPreferences(preferences);
			} catch (error) {
				console.error('Erreur lors du chargement des préférences:', error);
			}
		}
	}, []);

	// Sauvegarder les préférences utilisateur
	const saveUserPreferences = useCallback((preferences: UserCategoryPreferences) => {
		setUserPreferences(preferences);
		localStorage.setItem('synq-sidebar-preferences', JSON.stringify(preferences));
	}, []);

	// Créer une nouvelle catégorie
	const createCategory = useCallback((name: string, icon: string = 'folder') => {
		if (!settings.Synq_Sidebar_Allow_User_Categories) {
			throw new Error('Création de catégories non autorisée');
		}

		const newCategory: ChannelCategory = {
			id: `category_${Date.now()}`,
			name,
			icon,
			channels: [],
			order: categories.length,
			collapsed: settings.Synq_Sidebar_Default_Collapsed || false,
			userCreated: true,
		};

		setCategories(prev => [...prev, newCategory]);
		return newCategory;
	}, [categories.length, settings.Synq_Sidebar_Allow_User_Categories, settings.Synq_Sidebar_Default_Collapsed]);

	// Supprimer une catégorie
	const deleteCategory = useCallback((categoryId: string) => {
		setCategories(prev => prev.filter(cat => cat.id !== categoryId));
		
		// Supprimer les préférences associées
		const newPreferences = { ...userPreferences };
		delete newPreferences[categoryId];
		saveUserPreferences(newPreferences);
	}, [userPreferences, saveUserPreferences]);

	// Ajouter un canal à une catégorie
	const addChannelToCategory = useCallback((categoryId: string, channelId: string) => {
		setCategories(prev => prev.map(cat => 
			cat.id === categoryId 
				? { ...cat, channels: [...cat.channels, channelId] }
				: cat
		));
	}, []);

	// Retirer un canal d'une catégorie
	const removeChannelFromCategory = useCallback((categoryId: string, channelId: string) => {
		setCategories(prev => prev.map(cat => 
			cat.id === categoryId 
				? { ...cat, channels: cat.channels.filter(id => id !== channelId) }
				: cat
		));
	}, []);

	// Basculer l'état replié/déplié d'une catégorie
	const toggleCategory = useCallback((categoryId: string) => {
		const category = categories.find(cat => cat.id === categoryId);
		if (!category) return;

		const newCollapsed = !category.collapsed;
		
		// Mettre à jour les préférences utilisateur
		const newPreferences = {
			...userPreferences,
			[categoryId]: {
				...userPreferences[categoryId],
				collapsed: newCollapsed,
			},
		};
		saveUserPreferences(newPreferences);

		// Mettre à jour l'état local
		setCategories(prev => prev.map(cat => 
			cat.id === categoryId 
				? { ...cat, collapsed: newCollapsed }
				: cat
		));
	}, [categories, userPreferences, saveUserPreferences]);

	// Réorganiser les catégories
	const reorderCategories = useCallback((categoryId: string, direction: 'up' | 'down') => {
		if (!settings.Synq_Sidebar_Allow_Reorder) {
			throw new Error('Réorganisation non autorisée');
		}

		setCategories(prev => {
			const sortedCategories = [...prev].sort((a, b) => a.order - b.order);
			const currentIndex = sortedCategories.findIndex(cat => cat.id === categoryId);
			
			if (currentIndex === -1) return prev;
			
			const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
			
			if (newIndex < 0 || newIndex >= sortedCategories.length) return prev;
			
			// Échanger les positions
			const newCategories = [...sortedCategories];
			const temp = newCategories[currentIndex];
			newCategories[currentIndex] = newCategories[newIndex];
			newCategories[newIndex] = temp;
			
			// Mettre à jour les ordres
			return newCategories.map((cat, index) => ({ ...cat, order: index }));
		});
	}, [settings.Synq_Sidebar_Allow_Reorder]);

	// Obtenir les catégories avec les préférences utilisateur appliquées
	const getCategoriesWithPreferences = useCallback(() => {
		return categories.map(cat => ({
			...cat,
			collapsed: userPreferences[cat.id]?.collapsed ?? cat.collapsed,
		}));
	}, [categories, userPreferences]);

	return {
		categories: getCategoriesWithPreferences(),
		userPreferences,
		createCategory,
		deleteCategory,
		addChannelToCategory,
		removeChannelFromCategory,
		toggleCategory,
		reorderCategories,
		saveUserPreferences,
	};
};


