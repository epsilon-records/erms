import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Scoped } from '#lib/server/db/scoped.js';
import type { Membership } from '#lib/server/org.js';

declare global {
	/** Sentry environment: Netlify's build CONTEXT (production, deploy-preview, …), else "development". Set in vite.config.ts. */
	const __SENTRY_ENVIRONMENT__: string;
	/** Sentry release: the commit Netlify built (COMMIT_REF), or null outside Netlify. Set in vite.config.ts. */
	const __SENTRY_RELEASE__: string | null;

	namespace App {
		interface Locals {
			supabase: SupabaseClient;
			/** Verified with Supabase Auth on every request; null when signed out. */
			user: User | null;
			/** The org this request acts in; null if the user belongs to none yet. */
			membership: Membership | null;
			/** Every org the user belongs to, oldest first. */
			memberships: Membership[];
			/** Run queries in one transaction as this user, under RLS. */
			db: Scoped;
		}
		interface PageData {
			user?: { id: string; email?: string } | null;
			membership?: App.Locals['membership'];
			memberships?: App.Locals['memberships'];
		}
	}
}

export {};
