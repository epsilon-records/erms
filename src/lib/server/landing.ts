/**
 * LabelKit's own marketing homepage: `/` is public on LabelKit's hosts (labelkit.co, previews).
 * A customer's branded domain (erms.epsilonrecords.com) has no landing page, so its `/` still
 * goes to sign-in. Signed-in users get the dashboard at `/` either way.
 */
export function isLandingRequest(pathname: string, brand: { orgId: string | null }): boolean {
	return pathname === '/' && !brand.orgId;
}
