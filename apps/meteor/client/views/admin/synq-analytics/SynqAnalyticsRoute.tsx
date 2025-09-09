import { lazy } from 'react';

const SynqAnalyticsPage = lazy(() => import('./SynqAnalyticsPage'));

const SynqAnalyticsRoute = () => <SynqAnalyticsPage />;

export default SynqAnalyticsRoute;
