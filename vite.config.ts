import adapter from '@sveltejs/adapter-netlify';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Netlify hosts the web UI; everything else runs on Supabase.
			adapter: adapter(),
			// SvelteKit adds a per-request nonce to its own scripts. The browser only talks
			// to this origin (Supabase is called from the server), Google Fonts, and R2 for
			// master uploads (presigned PUTs straight to the bucket, EPSILON-29).
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
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
						'https://o337159.ingest.us.sentry.io'
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
		environment: 'node'
	}
});
