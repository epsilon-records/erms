import { sql } from 'drizzle-orm';
import { PUBLIC_SUPABASE_URL } from '$app/env/public';
import {
	AUTH_EMAIL_EPSILON_ORG_ID,
	RESEND_KEY_EPSILON,
	RESEND_KEY_LABELKIT,
	SEND_EMAIL_HOOK_SECRET
} from '$app/env/private';
import { handleSendEmailHook } from '#lib/server/auth-email/hook.js';
import type { RequestHandler } from './$types';

/**
 * Supabase Auth's Send Email hook (EPSILON-147). Not behind sign-in: hooks.server.ts hands this
 * path the erms_auth_email runner and nothing else, and the handler verifies the Standard Webhooks
 * signature before it reads the database. See README, "Sign-in email".
 */
export const POST: RequestHandler = ({ request, locals, url }) =>
	handleSendEmailHook(request, {
		config: {
			hookSecret: SEND_EMAIL_HOOK_SECRET,
			keys: { epsilon: RESEND_KEY_EPSILON, labelkit: RESEND_KEY_LABELKIT },
			epsilonOrgId: AUTH_EMAIL_EPSILON_ORG_ID,
			supabaseUrl: PUBLIC_SUPABASE_URL
		},
		appOrigin: url.origin,
		memberOrgIds: (userId) =>
			locals.db(async (tx) => {
				const rows = (await tx.execute(
					sql`select unnest(app_auth_email.member_org_ids(${userId}::uuid))::text as id`
				)) as { id: string }[];
				return rows.map((r) => r.id);
			}),
		fetcher: globalThis.fetch
	});
