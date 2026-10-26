import app from './app';

export { Workspace } from './workspace';

export default {
	fetch: app.fetch,
} satisfies ExportedHandler<Env>;
