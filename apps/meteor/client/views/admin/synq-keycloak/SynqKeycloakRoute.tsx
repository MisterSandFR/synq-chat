import { usePermission } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { memo } from 'react';

import SynqKeycloakPage from './SynqKeycloakPage';
import NotAuthorizedPage from '../../notAuthorized/NotAuthorizedPage';

const SynqKeycloakRoute = (): ReactElement => {
	const canManageSettings = usePermission('manage-settings');

	if (!canManageSettings) {
		return <NotAuthorizedPage />;
	}

	return <SynqKeycloakPage />;
};

export default memo(SynqKeycloakRoute);


