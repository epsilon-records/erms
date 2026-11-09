import { masterEndpoint } from '#lib/server/masters-http.js';
import { deleteMaster, MasterError } from '#lib/server/masters.js';
import type { RequestHandler } from './$types';

/**
 * Delete a master: removes the R2 object and the row, audited as master_delete.
 *
 * Decision 0023: the request must carry `{ "removalConfirmed": "yes" }`, which the page only sends
 * after the person confirms. Without it nothing is read, removed or audited.
 */
export const DELETE: RequestHandler = (event) =>
	masterEndpoint(event, (ctx, storage, body) => {
		if ((body as { removalConfirmed?: unknown } | null)?.removalConfirmed !== 'yes') {
			throw new MasterError(400, 'Deleting a master needs confirmation; nothing was deleted.');
		}
		return event.locals.db((tx) => deleteMaster(tx, storage, ctx, event.params.masterId));
	});
