import { lazy } from 'react';

const SynqDocsPage = lazy(() => import('./SynqDocsPage'));

const SynqDocsRoute = () => <SynqDocsPage />;

export default SynqDocsRoute;
