import type { AccessLevel } from './access';

export type ResourceKind = 'page' | 'list';

export const RESOURCE_KINDS: ResourceKind[] = ['page', 'list'];

export type ChannelResource = {
	kind: ResourceKind;
	id: string;
	title: string;
	icon: string | null;
	level: AccessLevel;
	addedBy: string;
	canRemove: boolean;
	// Membres du salon sans accès ; identifiants seulement pour qui peut partager.
	missing: number;
	missingIds?: string[];
};

export type ChannelResources = { items: ChannelResource[]; canLink: boolean };

export const CHANNEL_RESOURCE_LIMIT = 50;
