import type { Role } from './db/schema';

export type Membership = {
	orgId: string;
	orgName: string;
	role: Role;
	onboardedAt?: Date | null;
	/** Set when an owner has closed the label (migration 0027). */
	closedAt?: Date | null;
};

/** Cookie holding the org the user last switched to. */
export const ORG_COOKIE = 'erms_org';

/**
 * The org a request acts in: the one in the cookie if the user still belongs to it,
 * otherwise the oldest membership. `rows` must be in a stable order (oldest first).
 */
export function pickMembership(rows: Membership[], wanted: string | undefined) {
	return rows.find((r) => r.orgId === wanted) ?? rows[0] ?? null;
}

/**
 * Whether a signed-in member should be sent to first-run onboarding: they have a
 * membership they haven't completed onboarding for, and the path isn't exempt.
 * Kept pure so the routing rule can be unit-tested.
 */
export function needsOnboarding(
	membership: Membership | null,
	pathname: string,
	exempt: string[]
): boolean {
	return Boolean(
		membership && !membership.onboardedAt && !exempt.some((p) => pathname.startsWith(p))
	);
}
