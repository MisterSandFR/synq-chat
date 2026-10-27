import { fileURLToPath } from 'node:url';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			// Binding AI distant : jamais en test, `ai.run` est simulé.
			remoteBindings: false,
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				bindings: {
					TEST_MIGRATIONS: await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url))),
					RECUBE_CLIENT_ID: 'synq-test',
					RECUBE_CLIENT_SECRET: 'secret-test',
					REALTIME_APP_SECRET: 'sfu-test',
					MAIL_KEY: 'mail-test-key',
				},
			},
		})),
	],
	test: {
		include: ['test/**/*.test.ts'],
		testTimeout: 20_000,
		setupFiles: ['./test/apply-migrations.ts'],
	},
});
