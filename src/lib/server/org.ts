import type { Role } from './db/schema';

export type Membership = { orgId: string; orgName: string; role: Role };

/** Cookie holding the org the user last switched to. */
export const ORG_COOKIE = 'erms_org';

/**
 * The org a request acts in: the one in the cookie if the user still belongs to it,
 * otherwise the oldest membership. `rows` must be in a stable order (oldest first).
 */
export function pickMembership(rows: Membership[], wanted: string | undefined) {
	return rows.find((r) => r.orgId === wanted) ?? rows[0] ?? null;
}
