import { listReleasesPage, pageParams, v1 } from '#lib/server/api/v1.js';
import type { RequestHandler } from './$types';

/** GET /v1/releases - the label's releases, oldest first, 50 a page (`limit`, `after`). */
export const GET: RequestHandler = v1('catalog:read', ({ url }, { orgId, db }) => {
	const params = pageParams(url);
	return db((tx) => listReleasesPage(tx, orgId, params));
});
