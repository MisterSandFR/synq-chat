import { lazy } from 'react';

const SynqReadOnlyChannelsPage = lazy(() => import('./SynqReadOnlyChannelsPage'));

const SynqReadOnlyChannelsRoute = () => <SynqReadOnlyChannelsPage />;

export default SynqReadOnlyChannelsRoute;
