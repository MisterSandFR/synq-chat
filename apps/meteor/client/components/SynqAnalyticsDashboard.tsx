import { Box, Card, CardBody, CardHeader, CardTitle, Button, ButtonGroup, Badge, Icon, Field, FieldGroup, FieldLabel, FieldRow, FieldHint, Table, TableHead, TableBody, TableRow, TableCell, ProgressBar } from '@rocket.chat/fuselage';
import { useTranslation } from 'react-i18next';
import type { ReactElement } from 'react';
import { useState, useCallback, useEffect } from 'react';

interface AnalyticsData {
	messagesPerDay: Array<{
		date: string;
		count: number;
	}>;
	activeUsers: Array<{
		date: string;
		count: number;
	}>;
	topChannels: Array<{
		name: string;
		messages: number;
		users: number;
	}>;
	topUsers: Array<{
		username: string;
		avatar: string;
		messages: number;
		lastActivity: Date;
	}>;
	peakHours: Array<{
		hour: number;
		activity: number;
	}>;
	peakDays: Array<{
		day: string;
		activity: number;
	}>;
	messageTypes: Array<{
		type: string;
		count: number;
		percentage: number;
	}>;
	responseTime: {
		average: number;
		median: number;
		p95: number;
	};
}

interface SynqAnalyticsDashboardProps {
	data: AnalyticsData;
	onRefresh: () => void;
	onExport: (format: string) => void;
	onGenerateReport: () => void;
	timeRange: 'day' | 'week' | 'month' | 'year';
	onTimeRangeChange: (range: 'day' | 'week' | 'month' | 'year') => void;
}

const SynqAnalyticsDashboard = ({
	data,
	onRefresh,
	onExport,
	onGenerateReport,
	timeRange,
	onTimeRangeChange,
}: SynqAnalyticsDashboardProps): ReactElement => {
	const { t } = useTranslation();

	return (
		<Box style={{ padding: '1rem' }}>
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Analytics_Dashboard')}</CardTitle>
					<ButtonGroup>
						<Button
							variant='secondary'
							icon='refresh'
							onClick={onRefresh}
						>
							{t('Refresh')}
						</Button>
						<Button
							variant='secondary'
							icon='download'
							onClick={() => onExport('csv')}
						>
							{t('Export')}
						</Button>
						<Button
							variant='primary'
							icon='file-text'
							onClick={onGenerateReport}
						>
							{t('Generate_Report')}
						</Button>
					</ButtonGroup>
				</CardHeader>
				<CardBody>
					<Box marginBlockEnd={16}>
						<ButtonGroup>
							<Button
								variant={timeRange === 'day' ? 'primary' : 'secondary'}
								onClick={() => onTimeRangeChange('day')}
							>
								{t('Day')}
							</Button>
							<Button
								variant={timeRange === 'week' ? 'primary' : 'secondary'}
								onClick={() => onTimeRangeChange('week')}
							>
								{t('Week')}
							</Button>
							<Button
								variant={timeRange === 'month' ? 'primary' : 'secondary'}
								onClick={() => onTimeRangeChange('month')}
							>
								{t('Month')}
							</Button>
							<Button
								variant={timeRange === 'year' ? 'primary' : 'secondary'}
								onClick={() => onTimeRangeChange('year')}
							>
								{t('Year')}
							</Button>
						</ButtonGroup>
					</Box>
				</CardBody>
			</Card>

			{/* Messages par jour */}
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Messages_Per_Day')}</CardTitle>
				</CardHeader>
				<CardBody>
					<Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
						{data.messagesPerDay.slice(-7).map((day) => (
							<Box key={day.date} style={{ textAlign: 'center' }}>
								<Box style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>
									{new Date(day.date).toLocaleDateString()}
								</Box>
								<Box style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1d74f5' }}>
									{day.count}
								</Box>
								<Box style={{ fontSize: '0.75rem', color: '#666' }}>
									{t('messages')}
								</Box>
							</Box>
						))}
					</Box>
				</CardBody>
			</Card>

			{/* Utilisateurs actifs */}
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Active_Users')}</CardTitle>
				</CardHeader>
				<CardBody>
					<Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
						{data.activeUsers.slice(-7).map((day) => (
							<Box key={day.date} style={{ textAlign: 'center' }}>
								<Box style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>
									{new Date(day.date).toLocaleDateString()}
								</Box>
								<Box style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#28a745' }}>
									{day.count}
								</Box>
								<Box style={{ fontSize: '0.75rem', color: '#666' }}>
									{t('users')}
								</Box>
							</Box>
						))}
					</Box>
				</CardBody>
			</Card>

			{/* Top canaux */}
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Top_Channels')}</CardTitle>
				</CardHeader>
				<CardBody>
					<Table>
						<TableHead>
							<TableRow>
								<TableCell>{t('Channel')}</TableCell>
								<TableCell>{t('Messages')}</TableCell>
								<TableCell>{t('Users')}</TableCell>
								<TableCell>{t('Activity')}</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{data.topChannels.map((channel) => (
								<TableRow key={channel.name}>
									<TableCell>
										<Box style={{ display: 'flex', alignItems: 'center' }}>
											<Icon name='hashtag' size='x16' style={{ marginRight: '0.5rem' }} />
											{channel.name}
										</Box>
									</TableCell>
									<TableCell>
										<Badge variant='primary'>
											{channel.messages}
										</Badge>
									</TableCell>
									<TableCell>
										<Badge variant='secondary'>
											{channel.users}
										</Badge>
									</TableCell>
									<TableCell>
										<ProgressBar percentage={(channel.messages / Math.max(...data.topChannels.map(c => c.messages))) * 100} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardBody>
			</Card>

			{/* Top utilisateurs */}
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Top_Users')}</CardTitle>
				</CardHeader>
				<CardBody>
					<Table>
						<TableHead>
							<TableRow>
								<TableCell>{t('User')}</TableCell>
								<TableCell>{t('Messages')}</TableCell>
								<TableCell>{t('Last_Activity')}</TableCell>
								<TableCell>{t('Activity')}</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{data.topUsers.map((user) => (
								<TableRow key={user.username}>
									<TableCell>
										<Box style={{ display: 'flex', alignItems: 'center' }}>
											<img
												src={user.avatar}
												alt={user.username}
												style={{
													width: '24px',
													height: '24px',
													borderRadius: '50%',
													marginRight: '0.5rem',
												}}
											/>
											{user.username}
										</Box>
									</TableCell>
									<TableCell>
										<Badge variant='primary'>
											{user.messages}
										</Badge>
									</TableCell>
									<TableCell>
										<Box style={{ fontSize: '0.875rem' }}>
											{new Date(user.lastActivity).toLocaleDateString()}
										</Box>
									</TableCell>
									<TableCell>
										<ProgressBar percentage={(user.messages / Math.max(...data.topUsers.map(u => u.messages))) * 100} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardBody>
			</Card>

			{/* Heures de pointe */}
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Peak_Hours')}</CardTitle>
				</CardHeader>
				<CardBody>
					<Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: '0.5rem' }}>
						{data.peakHours.map((hour) => (
							<Box key={hour.hour} style={{ textAlign: 'center' }}>
								<Box style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>
									{hour.hour}:00
								</Box>
								<Box style={{ fontSize: '1rem', fontWeight: 'bold', color: '#1d74f5' }}>
									{hour.activity}
								</Box>
								<ProgressBar percentage={(hour.activity / Math.max(...data.peakHours.map(h => h.activity))) * 100} />
							</Box>
						))}
					</Box>
				</CardBody>
			</Card>

			{/* Jours de pointe */}
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Peak_Days')}</CardTitle>
				</CardHeader>
				<CardBody>
					<Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem' }}>
						{data.peakDays.map((day) => (
							<Box key={day.day} style={{ textAlign: 'center' }}>
								<Box style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.25rem' }}>
									{t(day.day)}
								</Box>
								<Box style={{ fontSize: '1rem', fontWeight: 'bold', color: '#28a745' }}>
									{day.activity}
								</Box>
								<ProgressBar percentage={(day.activity / Math.max(...data.peakDays.map(d => d.activity))) * 100} />
							</Box>
						))}
					</Box>
				</CardBody>
			</Card>

			{/* Types de messages */}
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Message_Types')}</CardTitle>
				</CardHeader>
				<CardBody>
					<Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
						{data.messageTypes.map((type) => (
							<Box key={type.type} style={{ textAlign: 'center' }}>
								<Box style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>
									{t(type.type)}
								</Box>
								<Box style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1d74f5' }}>
									{type.count}
								</Box>
								<Box style={{ fontSize: '0.75rem', color: '#666' }}>
									{type.percentage}%
								</Box>
								<ProgressBar percentage={type.percentage} />
							</Box>
						))}
					</Box>
				</CardBody>
			</Card>

			{/* Temps de réponse */}
			<Card marginBlockEnd={16}>
				<CardHeader>
					<CardTitle>{t('Response_Time')}</CardTitle>
				</CardHeader>
				<CardBody>
					<Box style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
						<Box style={{ textAlign: 'center' }}>
							<Box style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>
								{t('Average')}
							</Box>
							<Box style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1d74f5' }}>
								{data.responseTime.average}ms
							</Box>
						</Box>
						<Box style={{ textAlign: 'center' }}>
							<Box style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>
								{t('Median')}
							</Box>
							<Box style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#28a745' }}>
								{data.responseTime.median}ms
							</Box>
						</Box>
						<Box style={{ textAlign: 'center' }}>
							<Box style={{ fontSize: '0.875rem', color: '#666', marginBottom: '0.5rem' }}>
								{t('P95')}
							</Box>
							<Box style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#dc3545' }}>
								{data.responseTime.p95}ms
							</Box>
						</Box>
					</Box>
				</CardBody>
			</Card>
		</Box>
	);
};

export default SynqAnalyticsDashboard;
