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
	DATABASE_URL: {
		schema: z.string().startsWith('postgres'),
		description: 'Postgres connection string (server only)'
	},
	AUDIO_PROVIDER: {
		schema: z.enum(['stub', 'audiokit']).default('stub'),
		description: 'Which AudioProvider implementation the processing worker uses'
	},
	AUDIOKIT_WEBHOOK_SECRET: {
		schema: (value) => value || undefined,
		description: 'HMAC secret for AudioKit webhooks (required once AUDIO_PROVIDER=audiokit)'
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
