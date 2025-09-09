import type { ReactElement } from 'react';

interface SynqLogoProps {
	size?: 'small' | 'medium' | 'large' | 'xlarge';
	className?: string;
	style?: React.CSSProperties;
	alt?: string;
}

const SynqLogo = ({ 
	size = 'medium', 
	className, 
	style, 
	alt = 'Synq Logo' 
}: SynqLogoProps): ReactElement => {
	const sizeMap = {
		small: { width: '24px', height: '24px' },
		medium: { width: '32px', height: '32px' },
		large: { width: '48px', height: '48px' },
		xlarge: { width: '64px', height: '64px' },
	};

	const logoStyle = {
		...sizeMap[size],
		...style,
	};

	return (
		<img
			src="/images/synq/logo.svg"
			alt={alt}
			className={className}
			style={logoStyle}
		/>
	);
};

export default SynqLogo;
