import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$app/env/public';
import { SUPABASE_SECRET_KEY } from '$app/env/private';

/**
 * The one place ERMS holds Supabase's secret (service-role) key: the Auth admin API, for member
 * invites (EPSILON-87). It is deliberately narrow.
 *
 * - Auth only. This client never queries tables: every database read and write still goes
 *   through `locals.db` as `labelkit_app` under RLS. The key bypasses RLS, so it must not grow into a
 *   second database path.
 * - Three calls: invite an address, find the account behind an address, and read the email and
 *   last sign-in of an org's members for the members page.
 * - Server only. `$app/env/private` cannot reach the browser, and `auth-admin-access.test.ts`
 *   fails if any file other than the members route imports this module.
 *
 * Why the admin API at all: an invite has to create the account (the login page refuses to,
 * `shouldCreateUser: false`) and only the admin API sends Supabase's invite email, through the
 * same SMTP sender as sign-in (decisions 0004, 0021). The email copy names the recipient's own
 * label from `invited_org_name`, and the Send Email hook picks the sender from `invited_org_id`
 * (src/lib/server/auth-email/, EPSILON-147).
 */

export type InviteResult = {
	userId: string;
	/** False when reusing an existing account, including a pending invitation; no mail is resent. */
	emailed: boolean;
};

export type MemberAccount = { email: string | null; lastSignInAt: string | null };

export interface AuthAdmin {
	invite(email: string, orgName: string, orgId: string): Promise<InviteResult>;
	accounts(userIds: string[]): Promise<Map<string, MemberAccount>>;
}

/** A refusal from Supabase Auth that the owner can act on (bad address, rate limit). */
export class InviteRefused extends Error {}

/** How many pages of accounts to scan for an existing address (1000 per page). */
const MAX_PAGES = 20;

export function supabaseAuthAdmin(client: SupabaseClient): AuthAdmin {
	const admin = client.auth.admin;

	async function findByEmail(email: string): Promise<string | null> {
		// The admin API has no lookup by address. ERMS has a handful of accounts per label, so a
		// read-only scan is cheap; it has no side effects, unlike generating a sign-in link would.
		for (let page = 1; page <= MAX_PAGES; page++) {
			const { data, error } = await admin.listUsers({ page, perPage: 1000 });
			if (error) throw error;
			const hit = data.users.find((u) => u.email?.toLowerCase() === email);
			if (hit) return hit.id;
			if (data.users.length < 1000) return null;
		}
		throw new Error('Auth account scan exceeded its limit; no invitation was sent.');
	}

	return {
		async invite(rawEmail, orgName, orgId) {
			const email = rawEmail.trim().toLowerCase();
			// Supabase resends to pending users with their STORED metadata, ignoring new
			// invite data. Reuse every existing account before invoking the email endpoint,
			// preserving the first invitation and never overwriting shared account metadata.
			const existing = await findByEmail(email);
			if (existing) return { userId: existing, emailed: false };
			const { data, error } = await admin.inviteUserByEmail(email, {
				// The org id lets the Send Email hook pick the inviting org's sender (EPSILON-147).
				data: { invited_org_name: orgName, invited_org_id: orgId }
			});
			if (!error && data.user) return { userId: data.user.id, emailed: true };

			if (error?.code === 'email_exists' || error?.status === 422) {
				const userId = await findByEmail(email);
				if (userId) return { userId, emailed: false };
			}
			if (error?.status === 429) {
				throw new InviteRefused(
					'Too many emails were sent recently. Wait a while, then invite again.'
				);
			}
			if (error?.status === 400) {
				throw new InviteRefused('Supabase refused that address. Check it and try again.');
			}
			throw error ?? new Error('invite returned no user');
		},

		async accounts(userIds) {
			const out = new Map<string, MemberAccount>();
			const rows = await Promise.all(userIds.map((id) => admin.getUserById(id)));
			rows.forEach(({ data, error }, i) => {
				// A failed lookup is unknown, never evidence of an unsigned-in account.
				if (error || !data.user) return;
				out.set(userIds[i], {
					email: data.user?.email ?? null,
					lastSignInAt: data.user?.last_sign_in_at ?? null
				});
			});
			return out;
		}
	};
}

let instance: AuthAdmin | null | undefined;

/** The admin client, or null when this deploy has no secret key (invites are then off). */
export function authAdmin(): AuthAdmin | null {
	if (instance === undefined) {
		instance = SUPABASE_SECRET_KEY
			? supabaseAuthAdmin(
					createClient(PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
						auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
					})
				)
			: null;
	}
	return instance;
}
