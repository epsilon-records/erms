import { masterEndpoint } from '#lib/server/masters-http.js';
import { startMasterUpload } from '#lib/server/masters.js';
import type { RequestHandler } from './$types';

/** Start a master upload: records a pending master and returns where to PUT the file. */
export const POST: RequestHandler = (event) =>
	masterEndpoint(event, (ctx, storage, body) =>
		event.locals.db((tx) => startMasterUpload(tx, storage, ctx, event.params.id, body))
	);
