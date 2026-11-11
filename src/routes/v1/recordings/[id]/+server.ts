import { recordingDetail, requireId, v1 } from '#lib/server/api/v1.js';
import type { RequestHandler } from './$types';

/** GET /v1/recordings/:id - one recording with its releases and credits. */
export const GET: RequestHandler = v1('catalog:read', ({ params }, { orgId, db }) => {
	const id = requireId(params.id, 'Recording');
	return db((tx) => recordingDetail(tx, orgId, id));
});
