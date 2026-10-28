import type { Member } from '../../../shared/types';
import { ListPage } from './BasePage';

type Props = {
	workspaceId: string;
	listId: string;
	viewId?: string | null;
	compact?: boolean;
	// Sans membres : avatars par initiales, filtre « Mes cartes » inactif.
	members?: Map<string, Member>;
	myId?: string;
};

const NO_MEMBERS = new Map<string, Member>();

// Base intégrée dans une page : onglets de vues et vue choisie, l'élément s'ouvre dans la base.
export function ListView({ workspaceId, listId, viewId = null, compact = true, members = NO_MEMBERS, myId = '' }: Props) {
	return <ListPage key={listId} workspaceId={workspaceId} listId={listId} viewId={viewId} compact={compact} members={members} rooms={[]} version={0} myId={myId} />;
}

export default ListView;
