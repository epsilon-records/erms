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
	}
});
