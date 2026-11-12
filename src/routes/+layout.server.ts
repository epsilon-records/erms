import { brandIcon } from '#lib/server/branding.js';
import { featuresFor } from '#lib/server/features.js';
import { flagSource } from '#lib/server/features-env.js';
import { plansClient } from '#lib/server/plans.js';
import { plansConfig } from '#lib/server/plans-env.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => ({
	user: locals.user ? { id: locals.user.id, email: locals.user.email } : null,
	membership: locals.membership,
	memberships: locals.memberships,
	brand: locals.brand,
	// The tab icon for this host: the Epsilon mark on erms.epsilonrecords.com, LabelKit's elsewhere.
	icon: brandIcon(url.host),
	// Same check as /org/billing: on, and billing reachable by URL and token.
	plansEnabled: plansClient(plansConfig()) !== null,
	// Per-org feature switches, evaluated on the server (EPSILON-133). Pages show or hide gated
	// modules from this; the routes themselves still call requireFeature.
	features: locals.membership ? await featuresFor(flagSource(), locals.membership.orgId) : null
});
