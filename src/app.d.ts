import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Role } from '#lib/server/db/schema.js';

declare global {
	namespace App {
		interface Locals {
			supabase: SupabaseClient;
			/** Verified with Supabase Auth on every request; null when signed out. */
			user: User | null;
			/** The user's org membership; null if the user has none yet. */
			membership: { orgId: string; orgName: string; role: Role } | null;
		}
		interface PageData {
			user?: { id: string; email?: string } | null;
			membership?: App.Locals['membership'];
		}
	}
}

export {};
