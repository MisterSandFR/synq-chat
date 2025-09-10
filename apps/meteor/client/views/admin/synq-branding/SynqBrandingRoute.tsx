import { usePermission } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { memo } from 'react';

import SynqBrandingPage from './SynqBrandingPage';
import NotAuthorizedPage from '../../notAuthorized/NotAuthorizedPage';

const SynqBrandingRoute = (): ReactElement => {
	const canManageSettings = usePermission('manage-settings');

	if (!canManageSettings) {
		return <NotAuthorizedPage />;
	}

	return <SynqBrandingPage />;
};

export default memo(SynqBrandingRoute);


