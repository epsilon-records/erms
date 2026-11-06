import { masterEndpoint } from '#lib/server/masters-http.js';
import { deleteMaster } from '#lib/server/masters.js';
import type { RequestHandler } from './$types';

/** Delete a master: removes the R2 object and the row, audited as master_delete. */
export const DELETE: RequestHandler = (event) =>
	masterEndpoint(event, (ctx, storage) =>
		event.locals.db((tx) => deleteMaster(tx, storage, ctx, event.params.masterId))
	);
