import { Box, Card, CardBody, CardHeader, CardTitle, Button, ButtonGroup, Badge, Icon, Field, FieldGroup, FieldLabel, FieldRow, FieldHint, ProgressBar, Callout } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import { useState, useCallback, useEffect } from 'react';

import SynqLogo from './SynqLogo';

interface OnboardingStep {
	id: string;
	title: string;
	description: string;
	component: ReactElement;
	completed: boolean;
	required: boolean;
}

interface SynqOnboardingProps {
	steps: OnboardingStep[];
	onStepComplete: (stepId: string) => void;
	onOnboardingComplete: () => void;
	onSkip: () => void;
	currentStep: number;
}

const SynqOnboarding = ({
	steps,
	onStepComplete,
	onOnboardingComplete,
	onSkip,
	currentStep,
}: SynqOnboardingProps): ReactElement => {
	const { t } = useTranslation();
	const [stepData, setStepData] = useState<Record<string, any>>({});

	const handleNext = useCallback(() => {
		if (currentStep < steps.length - 1) {
			onStepComplete(steps[currentStep].id);
		} else {
			onOnboardingComplete();
		}
	}, [currentStep, steps, onStepComplete, onOnboardingComplete]);

	const handlePrevious = useCallback(() => {
		if (currentStep > 0) {
			// Go to previous step
		}
	}, [currentStep]);

	const handleSkip = useCallback(() => {
		onSkip();
	}, [onSkip]);

	const progress = ((currentStep + 1) / steps.length) * 100;

	return (
		<Box style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
			<Card marginBlockEnd={24}>
				<CardHeader>
					<CardTitle style={{ display: 'flex', alignItems: 'center' }}>
						<SynqLogo size="medium" style={{ marginRight: '0.5rem' }} />
						{t('Welcome_to_Synq')}
					</CardTitle>
				</CardHeader>
				<CardBody>
					<Box marginBlockEnd={16}>
						<ProgressBar percentage={progress} />
					</Box>
					<Box style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
						<Box>
							<FieldLabel>{t('Step')} {currentStep + 1} {t('of')} {steps.length}</FieldLabel>
							<FieldHint>{steps[currentStep]?.title}</FieldHint>
						</Box>
						<ButtonGroup>
							<Button variant='secondary' onClick={handleSkip}>
								{t('Skip')}
							</Button>
						</ButtonGroup>
					</Box>
				</CardBody>
			</Card>

			<Card marginBlockEnd={24}>
				<CardHeader>
					<CardTitle>{steps[currentStep]?.title}</CardTitle>
				</CardHeader>
				<CardBody>
					<Box marginBlockEnd={16}>
						<p>{steps[currentStep]?.description}</p>
					</Box>
					{steps[currentStep]?.component}
				</CardBody>
			</Card>

			<Box style={{ display: 'flex', justifyContent: 'space-between' }}>
				<Button
					variant='secondary'
					onClick={handlePrevious}
					disabled={currentStep === 0}
				>
					{t('Previous')}
				</Button>
				<Button
					variant='primary'
					onClick={handleNext}
				>
					{currentStep === steps.length - 1 ? t('Finish') : t('Next')}
				</Button>
			</Box>
		</Box>
	);
};

// Composants pour les étapes d'onboarding
const WelcomeStep = (): ReactElement => {
	const { t } = useTranslation();
	return (
		<Box>
			<Callout type='info' title={t('Welcome')}>
				{t('Welcome_to_Synq_description')}
			</Callout>
		</Box>
	);
};

const ProfileSetupStep = (): ReactElement => {
	const { t } = useTranslation();
	const [profileData, setProfileData] = useState({
		firstName: '',
		lastName: '',
		email: '',
		avatar: '',
	});

	return (
		<FieldGroup>
			<Field>
				<FieldLabel>{t('First_Name')}</FieldLabel>
				<FieldRow>
					<input
						type='text'
						value={profileData.firstName}
						onChange={(e) => setProfileData(prev => ({ ...prev, firstName: e.target.value }))}
						placeholder={t('Enter_first_name')}
						style={{
							width: '100%',
							padding: '0.5rem',
							border: '1px solid #ddd',
							borderRadius: '4px',
						}}
					/>
				</FieldRow>
			</Field>
			<Field>
				<FieldLabel>{t('Last_Name')}</FieldLabel>
				<FieldRow>
					<input
						type='text'
						value={profileData.lastName}
						onChange={(e) => setProfileData(prev => ({ ...prev, lastName: e.target.value }))}
						placeholder={t('Enter_last_name')}
						style={{
							width: '100%',
							padding: '0.5rem',
							border: '1px solid #ddd',
							borderRadius: '4px',
						}}
					/>
				</FieldRow>
			</Field>
			<Field>
				<FieldLabel>{t('Email')}</FieldLabel>
				<FieldRow>
					<input
						type='email'
						value={profileData.email}
						onChange={(e) => setProfileData(prev => ({ ...prev, email: e.target.value }))}
						placeholder={t('Enter_email')}
						style={{
							width: '100%',
							padding: '0.5rem',
							border: '1px solid #ddd',
							borderRadius: '4px',
						}}
					/>
				</FieldRow>
			</Field>
		</FieldGroup>
	);
};

const WorkspaceSetupStep = (): ReactElement => {
	const { t } = useTranslation();
	const [workspaceData, setWorkspaceData] = useState({
		name: '',
		description: '',
		template: 'startup',
	});

	return (
		<FieldGroup>
			<Field>
				<FieldLabel>{t('Workspace_Name')}</FieldLabel>
				<FieldRow>
					<input
						type='text'
						value={workspaceData.name}
						onChange={(e) => setWorkspaceData(prev => ({ ...prev, name: e.target.value }))}
						placeholder={t('Enter_workspace_name')}
						style={{
							width: '100%',
							padding: '0.5rem',
							border: '1px solid #ddd',
							borderRadius: '4px',
						}}
					/>
				</FieldRow>
			</Field>
			<Field>
				<FieldLabel>{t('Description')}</FieldLabel>
				<FieldRow>
					<textarea
						value={workspaceData.description}
						onChange={(e) => setWorkspaceData(prev => ({ ...prev, description: e.target.value }))}
						placeholder={t('Enter_workspace_description')}
						style={{
							width: '100%',
							padding: '0.5rem',
							border: '1px solid #ddd',
							borderRadius: '4px',
							minHeight: '60px',
						}}
					/>
				</FieldRow>
			</Field>
			<Field>
				<FieldLabel>{t('Template')}</FieldLabel>
				<FieldRow>
					<select
						value={workspaceData.template}
						onChange={(e) => setWorkspaceData(prev => ({ ...prev, template: e.target.value }))}
						style={{
							width: '100%',
							padding: '0.5rem',
							border: '1px solid #ddd',
							borderRadius: '4px',
						}}
					>
						<option value='startup'>{t('Startup')}</option>
						<option value='enterprise'>{t('Enterprise')}</option>
						<option value='community'>{t('Community')}</option>
						<option value='education'>{t('Education')}</option>
					</select>
				</FieldRow>
			</Field>
		</FieldGroup>
	);
};

const PreferencesStep = (): ReactElement => {
	const { t } = useTranslation();
	const [preferences, setPreferences] = useState({
		theme: 'light',
		language: 'fr',
		notifications: true,
		sound: true,
	});

	return (
		<FieldGroup>
			<Field>
				<FieldLabel>{t('Theme')}</FieldLabel>
				<FieldRow>
					<select
						value={preferences.theme}
						onChange={(e) => setPreferences(prev => ({ ...prev, theme: e.target.value }))}
						style={{
							width: '100%',
							padding: '0.5rem',
							border: '1px solid #ddd',
							borderRadius: '4px',
						}}
					>
						<option value='light'>{t('Light')}</option>
						<option value='dark'>{t('Dark')}</option>
						<option value='auto'>{t('Auto')}</option>
					</select>
				</FieldRow>
			</Field>
			<Field>
				<FieldLabel>{t('Language')}</FieldLabel>
				<FieldRow>
					<select
						value={preferences.language}
						onChange={(e) => setPreferences(prev => ({ ...prev, language: e.target.value }))}
						style={{
							width: '100%',
							padding: '0.5rem',
							border: '1px solid #ddd',
							borderRadius: '4px',
						}}
					>
						<option value='fr'>{t('French')}</option>
						<option value='en'>{t('English')}</option>
						<option value='es'>{t('Spanish')}</option>
						<option value='de'>{t('German')}</option>
					</select>
				</FieldRow>
			</Field>
			<Field>
				<FieldRow>
					<label style={{ display: 'flex', alignItems: 'center' }}>
						<input
							type='checkbox'
							checked={preferences.notifications}
							onChange={(e) => setPreferences(prev => ({ ...prev, notifications: e.target.checked }))}
							style={{ marginRight: '0.5rem' }}
						/>
						{t('Enable_notifications')}
					</label>
				</FieldRow>
			</Field>
			<Field>
				<FieldRow>
					<label style={{ display: 'flex', alignItems: 'center' }}>
						<input
							type='checkbox'
							checked={preferences.sound}
							onChange={(e) => setPreferences(prev => ({ ...prev, sound: e.target.checked }))}
							style={{ marginRight: '0.5rem' }}
						/>
						{t('Enable_sound')}
					</label>
				</FieldRow>
			</Field>
		</FieldGroup>
	);
};

const CompletionStep = (): ReactElement => {
	const { t } = useTranslation();
	return (
		<Box>
			<Callout type='success' title={t('Setup_Complete')}>
				{t('Setup_complete_description')}
			</Callout>
		</Box>
	);
};

export default SynqOnboarding;
export { WelcomeStep, ProfileSetupStep, WorkspaceSetupStep, PreferencesStep, CompletionStep };
