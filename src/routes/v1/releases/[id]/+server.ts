import { releaseDetail, requireId, v1 } from '#lib/server/api/v1.js';
import type { RequestHandler } from './$types';

/** GET /v1/releases/:id - one release with its tracks, credits and artists. */
export const GET: RequestHandler = v1('catalog:read', ({ params }, { orgId, db }) => {
	const id = requireId(params.id, 'Release');
	return db((tx) => releaseDetail(tx, orgId, id));
});
