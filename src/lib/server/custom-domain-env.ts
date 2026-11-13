import {
	NETLIFY_API_TOKEN,
	NETLIFY_SITE_ID,
	SUPABASE_ACCESS_TOKEN,
	SUPABASE_PROJECT_REF
} from '$app/env/private';
import { provisioner } from './custom-domain.js';

/** The custom-domain provisioner, configured from the environment (see custom-domain.ts). */
export function domainProvisioner() {
	return provisioner({
		netlifyToken: NETLIFY_API_TOKEN,
		netlifySiteId: NETLIFY_SITE_ID,
		supabaseToken: SUPABASE_ACCESS_TOKEN,
		supabaseProjectRef: SUPABASE_PROJECT_REF
	});
}
