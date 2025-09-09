import { lazy } from 'react';

const SynqWorkspaceTemplatesPage = lazy(() => import('./SynqWorkspaceTemplatesPage'));

const SynqWorkspaceTemplatesRoute = () => <SynqWorkspaceTemplatesPage />;

export default SynqWorkspaceTemplatesRoute;
