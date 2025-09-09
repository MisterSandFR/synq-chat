import React, { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

const SynqBridgePage = lazy(() => import('./SynqBridgePage'));

export const SynqBridgeRoute: React.FC = () => {
	return (
		<Routes>
			<Route path="/" element={<SynqBridgePage />} />
		</Routes>
	);
};
