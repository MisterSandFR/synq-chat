import { lazy } from 'react';

const SynqPermissionsPage = lazy(() => import('./SynqPermissionsPage'));

const SynqPermissionsRoute = () => <SynqPermissionsPage />;

export default SynqPermissionsRoute;
