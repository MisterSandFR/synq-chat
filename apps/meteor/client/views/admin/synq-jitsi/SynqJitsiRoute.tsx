import { lazy } from 'react';

const SynqJitsiPage = lazy(() => import('./SynqJitsiPage'));

const SynqJitsiRoute = () => <SynqJitsiPage />;

export default SynqJitsiRoute;
