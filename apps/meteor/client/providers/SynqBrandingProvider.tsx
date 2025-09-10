import type { ReactElement, ReactNode } from 'react';
import { useEffect } from 'react';

import { useSynqBranding } from '../hooks/useSynqBranding';

type SynqBrandingProviderProps = {
	children: ReactNode;
};

const SynqBrandingProvider = ({ children }: SynqBrandingProviderProps): ReactElement => {
	useSynqBranding();

	return <>{children}</>;
};

export default SynqBrandingProvider;

