import { lazy } from 'react';

const SynqUXPage = lazy(() => import('./SynqUXPage'));

const SynqUXRoute = () => <SynqUXPage />;

export default SynqUXRoute;
