import { masterEndpoint } from '#lib/server/masters-http.js';
import { abortMasterUpload } from '#lib/server/masters.js';
import type { RequestHandler } from './$types';

/** Cancel a pending master upload. */
export const POST: RequestHandler = (event) =>
	masterEndpoint(event, (ctx, storage) =>
		event.locals.db((tx) => abortMasterUpload(tx, storage, ctx, event.params.masterId))
	);
