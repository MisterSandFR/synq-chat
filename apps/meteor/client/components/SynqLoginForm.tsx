import { Box, Button, Field, FieldLabel, FieldRow, FieldError, FieldHint } from '@rocket.chat/fuselage';
import { useLoginWithPassword, useLoginWithToken } from '@rocket.chat/ui-contexts';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSynqBranding } from '../../hooks/useSynqBranding';
import SynqLogo from './SynqLogo';

const SynqLoginForm = (): ReactElement => {
	const { t } = useTranslation();
	const loginWithPassword = useLoginWithPassword();
	const loginWithToken = useLoginWithToken();
	const branding = useSynqBranding();

	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsLoading(true);
		setError(null);

		try {
			await loginWithPassword(username, password);
		} catch (err) {
			setError(t('Invalid_username_or_password'));
		} finally {
			setIsLoading(false);
		}
	};

	const loginStyle = {
		backgroundImage: branding.loginBackgroundImage ? `url(${branding.loginBackgroundImage})` : undefined,
		backgroundColor: branding.loginBackgroundColor || '#f7f8fa',
		backgroundSize: 'cover',
		backgroundPosition: 'center',
		backgroundRepeat: 'no-repeat',
		minHeight: '100vh',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
	};

	return (
		<Box style={loginStyle}>
			<Box
				style={{
					backgroundColor: 'rgba(255, 255, 255, 0.95)',
					padding: '2rem',
					borderRadius: '8px',
					boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
					maxWidth: '400px',
					width: '100%',
					margin: '1rem',
				}}
			>
				{!branding.loginHideLogo && (
					<Box marginBlockEnd={24} textAlign='center'>
						{branding.logo ? (
							<img
								src={branding.logo}
								alt={branding.workspaceName || 'Synq'}
								style={{ maxHeight: '60px', maxWidth: '200px' }}
							/>
						) : (
							<SynqLogo size="large" style={{ maxHeight: '60px', maxWidth: '200px' }} />
						)}
					</Box>
				)}

				{!branding.loginHideTitle && (
					<Box marginBlockEnd={16} textAlign='center'>
						<h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 'bold' }}>
							{branding.loginWelcomeText || t('Welcome_to_Synq')}
						</h1>
						{branding.loginSubtitleText && (
							<p style={{ margin: '0.5rem 0 0 0', color: '#666' }}>
								{branding.loginSubtitleText}
							</p>
						)}
					</Box>
				)}

				<form onSubmit={handleSubmit}>
					<Field marginBlockEnd={16}>
						<FieldLabel>{t('Username_or_email')}</FieldLabel>
						<FieldRow>
							<input
								type='text'
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								placeholder={t('Username_or_email')}
								required
								style={{
									width: '100%',
									padding: '0.5rem',
									border: '1px solid #ddd',
									borderRadius: '4px',
									fontSize: '1rem',
								}}
							/>
						</FieldRow>
					</Field>

					<Field marginBlockEnd={16}>
						<FieldLabel>{t('Password')}</FieldLabel>
						<FieldRow>
							<input
								type='password'
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder={t('Password')}
								required
								style={{
									width: '100%',
									padding: '0.5rem',
									border: '1px solid #ddd',
									borderRadius: '4px',
									fontSize: '1rem',
								}}
							/>
						</FieldRow>
					</Field>

					{error && (
						<FieldError marginBlockEnd={16}>
							{error}
						</FieldError>
					)}

					<Button
						type='submit'
						primary
						loading={isLoading}
						disabled={isLoading}
						style={{
							width: '100%',
							backgroundColor: branding.primaryColor || '#1d74f5',
							borderColor: branding.primaryColor || '#1d74f5',
						}}
					>
						{t('Login')}
					</Button>
				</form>

				<Box marginBlockStart={16} textAlign='center'>
					<p style={{ fontSize: '0.875rem', color: '#666', margin: 0 }}>
						{t('Synq_login_subtitle')}
					</p>
				</Box>
			</Box>
		</Box>
	);
};

export default SynqLoginForm;


