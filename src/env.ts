import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';

/**
 * Environment variables, validated when the app starts.
 * Public ones come from `$app/env/public`, private ones from `$app/env/private`.
 */
export const variables = defineEnvVars({
	PUBLIC_SUPABASE_URL: {
		public: true,
		schema: z.url(),
		description: 'Supabase project URL (project "ERMS")'
	},
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: {
		public: true,
		schema: z.string().min(1),
		description: 'Supabase publishable (anon) key; safe for the browser'
	},
	SUPABASE_SECRET_KEY: {
		schema: (value) => value || undefined,
		description:
			'Server-only Supabase secret/service-role key for owner-authorized invitation links'
	},
	RESEND_API_KEY: {
		schema: (value) => value || undefined,
		description: 'Send-only Resend key for invitations from no-reply@auth.epsilonrecords.com'
	},
	DATABASE_URL: {
		schema: z.string().startsWith('postgres'),
		description: 'Postgres connection string (server only)'
	},
	AUDIO_PROVIDER: {
		schema: z.enum(['stub', 'audiokit']).default('stub'),
		description: 'Which AudioProvider implementation the processing worker uses'
	},
	AUDIOKIT_BASE_URL: {
		schema: (value) => value || undefined,
		description: 'AudioKit API base URL (e.g., https://api.audiokit.ai)'
	},
	AUDIOKIT_API_KEY: {
		schema: (value) => value || undefined,
		description: 'AudioKit API key for authentication'
	},
	AUDIOKIT_WEBHOOK_SECRET: {
		schema: (value) => value || undefined,
		description: 'HMAC secret for AudioKit webhooks (required once AUDIO_PROVIDER=audiokit)'
	},
	WORKER_SECRET: {
		schema: (value) => value || undefined,
		description: 'Bearer token for the background job worker endpoint'
	},
	// Error monitoring (shared decision 0003). Optional: unset disables Sentry.
	SENTRY_DSN: {
		schema: (value) => value || undefined,
		description: 'Sentry DSN for server-side error monitoring'
	},
	PUBLIC_SENTRY_DSN: {
		public: true,
		schema: (value) => value || undefined,
		description: 'Sentry DSN for browser error monitoring (safe for the browser)'
	},
	// Master uploads (Cloudflare R2, decision 0011). Uploads stay off until all four are set.
	R2_ACCOUNT_ID: {
		schema: (value) => value || undefined,
		description: 'Cloudflare account id; the R2 endpoint is https://<id>.r2.cloudflarestorage.com'
	},
	R2_ACCESS_KEY_ID: {
		schema: (value) => value || undefined,
		description: 'R2 API token access key id, scoped to the masters bucket'
	},
	R2_SECRET_ACCESS_KEY: {
		schema: (value) => value || undefined,
		description: 'R2 API token secret access key (server only)'
	},
	R2_MASTERS_BUCKET: {
		schema: (value) => value || undefined,
		description: 'Name of the private R2 bucket that holds masters'
	}
});
