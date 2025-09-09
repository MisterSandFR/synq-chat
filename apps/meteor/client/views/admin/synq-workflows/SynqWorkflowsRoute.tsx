import { lazy } from 'react';

const SynqWorkflowsPage = lazy(() => import('./SynqWorkflowsPage'));

const SynqWorkflowsRoute = () => <SynqWorkflowsPage />;

export default SynqWorkflowsRoute;
