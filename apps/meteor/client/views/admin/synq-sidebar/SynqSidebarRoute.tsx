import { usePermission } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { memo } from 'react';

import SynqSidebarPage from './SynqSidebarPage';
import NotAuthorizedPage from '../../notAuthorized/NotAuthorizedPage';

const SynqSidebarRoute = (): ReactElement => {
	const canManageSettings = usePermission('manage-settings');

	if (!canManageSettings) {
		return <NotAuthorizedPage />;
	}

	return <SynqSidebarPage />;
};

export default memo(SynqSidebarRoute);


