import adapter from '@sveltejs/adapter-netlify';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => ({
	// Sentry environment and release for both hooks, fixed at build time from Netlify's
	// build variables so browser and server events are tagged alike and deploy previews
	// (CONTEXT=deploy-preview) don't report as production.
	define: {
		__SENTRY_ENVIRONMENT__: JSON.stringify(process.env.CONTEXT ?? 'development'),
		__SENTRY_RELEASE__: JSON.stringify(process.env.COMMIT_REF ?? null)
	},
	plugins: [
		// Tailwind v4 compiles src/tailwind.css at build time into the app's own stylesheet: no
		// new origin, so the CSP below is unchanged (EPSILON-166, shared 0046).
		tailwindcss(),
		// Always registered: besides uploads, it resolves `@sentry/sveltekit/browser-tracing-variant`
		// to the Kit 3 (`$app/state`) tracing module. Without it the import falls back to the
		// `$app/stores` variant, which throws app_stores_removed on Kit 3 (Sentry ERMS-1).
		// Releases and source-map uploads still only happen when SENTRY_AUTH_TOKEN is set.
		...(await sentrySvelteKit({
			org: 'epsilon-records',
			project: 'erms',
			authToken: process.env.SENTRY_AUTH_TOKEN,
			autoUploadSourceMaps: Boolean(process.env.SENTRY_AUTH_TOKEN),
			autoInstrument: false
		})),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Netlify hosts the web UI; everything else runs on Supabase.
			adapter: adapter(),
			// SvelteKit adds a per-request nonce to its own scripts. The browser only talks
			// to this origin (Supabase is called from the server), Google Fonts, R2 for
			// master uploads (presigned PUTs straight to the bucket, EPSILON-29), Sentry, and
			// Cloudflare Web Analytics on the public pages.
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					// Cloudflare Web Analytics' beacon, loaded on public signed-out pages only
					// (shared 0011, 0016; src/lib/public-analytics.ts).
					'script-src': ['self', 'https://static.cloudflareinsights.com'],
					// Inline style attributes are used for layout; with 'unsafe-inline' present
					// SvelteKit skips style nonces so the browser honours it.
					'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
					'font-src': ['self', 'https://fonts.gstatic.com'],
					'img-src': ['self', 'data:'],
					// R2's S3 endpoint for the Epsilon Records account.
					'connect-src': [
						'self',
						'https://24caefe07a98f735e8555dbc2e270449.r2.cloudflarestorage.com',
						// Sentry ingest, for browser error monitoring (shared decision 0003).
						'https://o337159.ingest.us.sentry.io',
						// Where that beacon posts its measurements.
						'https://cloudflareinsights.com'
					],
					// The same R2 endpoint, for the presigned preview audio the browser plays.
					'media-src': [
						'self',
						'https://24caefe07a98f735e8555dbc2e270449.r2.cloudflarestorage.com'
					],
					'form-action': ['self'],
					'frame-ancestors': ['none'],
					'base-uri': ['self'],
					'object-src': ['none']
				}
			}
		})
	],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
		// Builds the migrated template on the local Supabase stack that database tests copy from.
		globalSetup: ['src/lib/server/test-db.global.ts']
	}
}));
