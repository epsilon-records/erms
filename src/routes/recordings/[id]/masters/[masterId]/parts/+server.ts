import { masterEndpoint } from '#lib/server/masters-http.js';
import { signMasterParts } from '#lib/server/masters.js';
import type { RequestHandler } from './$types';

/** Presigned PUT URLs for parts of a multipart master upload. */
export const POST: RequestHandler = (event) =>
	masterEndpoint(event, (ctx, storage, body) =>
		event.locals.db((tx) => signMasterParts(tx, storage, ctx, event.params.masterId, body))
	);
