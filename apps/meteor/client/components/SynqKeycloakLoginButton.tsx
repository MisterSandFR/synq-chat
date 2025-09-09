import { Button } from '@rocket.chat/fuselage';
import { useMethod } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

const SynqKeycloakLoginButton = (): ReactElement => {
	const { t } = useTranslation();
	const [isLoading, setIsLoading] = useState(false);
	
	const getAuthUrl = useMethod('synq.keycloak.getAuthUrl');
	const isKeycloakEnabled = useMethod('synq.keycloak.isEnabled');

	const handleKeycloakLogin = async () => {
		try {
			setIsLoading(true);
			
			// Vérifier si Keycloak est activé
			const enabled = await isKeycloakEnabled();
			if (!enabled) {
				throw new Error('Keycloak n\'est pas activé');
			}

			// Obtenir l'URL d'authentification
			const authUrl = await getAuthUrl();
			
			// Rediriger vers Keycloak
			window.location.href = authUrl;
		} catch (error) {
			console.error('Erreur lors de la connexion Keycloak:', error);
			setIsLoading(false);
		}
	};

	return (
		<Button
			onClick={handleKeycloakLogin}
			loading={isLoading}
			disabled={isLoading}
			icon='shield-alt'
			style={{
				backgroundColor: '#1d74f5',
				borderColor: '#1d74f5',
				color: 'white',
			}}
		>
			{t('Login_with_Keycloak')}
		</Button>
	);
};

export default SynqKeycloakLoginButton;
