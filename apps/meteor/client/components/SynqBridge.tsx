import React, { useState, useEffect } from 'react';
import { Box, Button, Field, FieldGroup, FieldLabel, FieldRow, FieldError, Select, TextInput, TextArea, ToggleSwitch, Callout } from '@rocket.chat/fuselage';
import { useTranslation } from '@rocket.chat/ui-client';
import { useMethod } from '@rocket.chat/ui-contexts';

interface BridgeConfig {
	enabled: boolean;
	serverUrl?: string;
	accessToken?: string;
	botToken?: string;
	appToken?: string;
	guildId?: string;
	teamId?: string;
	roomMapping?: string;
	channelMapping?: string;
	userMapping?: string;
	roleMapping?: string;
	syncMessages?: boolean;
	syncUsers?: boolean;
	syncFiles?: boolean;
}

interface SynqBridgeProps {
	onConfigChange?: (config: BridgeConfig) => void;
}

export const SynqBridge: React.FC<SynqBridgeProps> = ({ onConfigChange }) => {
	const t = useTranslation();
	const [config, setConfig] = useState<BridgeConfig>({
		enabled: false,
		syncMessages: true,
		syncUsers: true,
		syncFiles: true,
	});
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const saveSettings = useMethod('saveSettings');

	useEffect(() => {
		if (onConfigChange) {
			onConfigChange(config);
		}
	}, [config, onConfigChange]);

	const handleSave = async () => {
		setIsLoading(true);
		setError(null);
		setSuccess(null);

		try {
			await saveSettings([{
				_id: 'Synq_Bridge_Enabled',
				value: config.enabled,
			}]);
			setSuccess(t('Settings_updated'));
		} catch (err) {
			setError(t('Error_updating_settings'));
		} finally {
			setIsLoading(false);
		}
	};

	const handleConfigChange = (key: keyof BridgeConfig, value: any) => {
		setConfig(prev => ({
			...prev,
			[key]: value,
		}));
	};

	return (
		<Box>
			<FieldGroup>
				<Field>
					<FieldRow>
						<FieldLabel>{t('Synq_Bridge_Enabled')}</FieldLabel>
						<ToggleSwitch
							checked={config.enabled}
							onChange={(checked) => handleConfigChange('enabled', checked)}
						/>
					</FieldRow>
				</Field>

				{config.enabled && (
					<>
						<Field>
							<FieldLabel>{t('Synq_Bridge_Matrix_Enabled')}</FieldLabel>
							<FieldRow>
								<ToggleSwitch
									checked={config.enabled}
									onChange={(checked) => handleConfigChange('enabled', checked)}
								/>
							</FieldRow>
						</Field>

						<Field>
							<FieldLabel>{t('Synq_Bridge_Discord_Enabled')}</FieldLabel>
							<FieldRow>
								<ToggleSwitch
									checked={config.enabled}
									onChange={(checked) => handleConfigChange('enabled', checked)}
								/>
							</FieldRow>
						</Field>

						<Field>
							<FieldLabel>{t('Synq_Bridge_Slack_Enabled')}</FieldLabel>
							<FieldRow>
								<ToggleSwitch
									checked={config.enabled}
									onChange={(checked) => handleConfigChange('enabled', checked)}
								/>
							</FieldRow>
						</Field>

						<Field>
							<FieldLabel>{t('Synq_Bridge_Sync_Interval')}</FieldLabel>
							<FieldRow>
								<TextInput
									type="number"
									value={60000}
									onChange={(e) => handleConfigChange('syncInterval', parseInt(e.target.value))}
								/>
							</FieldRow>
						</Field>

						<Field>
							<FieldLabel>{t('Synq_Bridge_Retry_Attempts')}</FieldLabel>
							<FieldRow>
								<TextInput
									type="number"
									value={3}
									onChange={(e) => handleConfigChange('retryAttempts', parseInt(e.target.value))}
								/>
							</FieldRow>
						</Field>

						<Field>
							<FieldLabel>{t('Synq_Bridge_Log_Level')}</FieldLabel>
							<FieldRow>
								<Select
									options={[
										{ label: t('Debug'), value: 'debug' },
										{ label: t('Info'), value: 'info' },
										{ label: t('Warning'), value: 'warn' },
										{ label: t('Error'), value: 'error' },
									]}
									value="info"
									onChange={(value) => handleConfigChange('logLevel', value)}
								/>
							</FieldRow>
						</Field>
					</>
				)}

				{error && (
					<Field>
						<FieldError>{error}</FieldError>
					</Field>
				)}

				{success && (
					<Field>
						<Callout type="success">{success}</Callout>
					</Field>
				)}

				<Field>
					<FieldRow>
						<Button primary onClick={handleSave} disabled={isLoading}>
							{isLoading ? t('Saving') : t('Save')}
						</Button>
					</FieldRow>
				</Field>
			</FieldGroup>
		</Box>
	);
};
