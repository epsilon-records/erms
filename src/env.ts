import { defineEnvVars } from '@sveltejs/kit/env';
import { z } from 'zod';

/**
 * Environment variables, validated when the app starts.
 * Public ones come from `$app/env/public`, private ones from `$app/env/private`.
 */
export const variables = defineEnvVars({
	APP_METRICS_ENABLED: {
		schema: z
			.string()
			.default('false')
			.transform((v) => v === 'true'),
		description: 'First-party performance ingestion; disabled pending review'
	},
	PUBLIC_APP_METRICS_ENABLED: {
		public: true,
		schema: z
			.string()
			.default('false')
			.transform((v) => v === 'true'),
		description: 'First-party performance client; disabled pending review'
	},
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
	DATABASE_URL: {
		schema: z.string().startsWith('postgres'),
		description: 'Postgres connection string (server only)'
	},
	// Member invites (EPSILON-87). Server only, and read by one module: src/lib/server/auth-admin.ts.
	// Optional: unset turns invites off (the members page still lists and manages members).
	SUPABASE_SECRET_KEY: {
		schema: (value) => value || undefined,
		description:
			'Supabase secret (service-role) key for the Auth admin API, used only to send member invites'
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
		description:
			"Deployment-wide AudioKit API key (Epsilon's): the fallback for orgs in AUDIOKIT_FALLBACK_ORG_IDS with no client of their own yet, and for polling jobs already submitted with it (EPSILON-102, EPSILON-135)"
	},
	AUDIOKIT_FALLBACK_ORG_IDS: {
		schema: (value) =>
			(value ?? '')
				.split(',')
				.map((id: string) => id.trim())
				.filter(Boolean),
		description:
			'Comma-separated org ids that may submit new jobs with the deployment-wide key while they have no client of their own; unset means none (EPSILON-135)'
	},
	AUDIOKIT_WEBHOOK_SECRET: {
		schema: (value) => value || undefined,
		description:
			"HMAC secret for the deployment-wide key's webhooks (required once AUDIO_PROVIDER=audiokit)"
	},
	// Per-label AudioKit clients (EPSILON-102). Read by the AudioKit routes only.
	AUDIOKIT_CREDENTIALS_KEY: {
		schema: (value) => value || undefined,
		description:
			'Seals each label\'s AudioKit key and webhook secret in the database: "<id>:<base64 of 32 bytes>", comma-separated, first entry seals. Required once any label has its own client'
	},
	AUDIOKIT_BILLING_URL: {
		schema: (value) => value || undefined,
		description: 'AudioKit billing service base URL (e.g., https://billing.audiokit.ai)'
	},
	LABEL_CLIENTS_ADMIN_TOKEN: {
		schema: (value) => value || undefined,
		description:
			"Bearer token for billing's /v1/admin/label-clients routes; server only, never logged"
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
