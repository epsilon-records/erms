import { masterEndpoint } from '#lib/server/masters-http.js';
import { completeMasterUpload } from '#lib/server/masters.js';
import type { RequestHandler } from './$types';

/** Finish an upload: R2's copy is checked, then the master is recorded or rejected. */
export const POST: RequestHandler = (event) =>
	masterEndpoint(event, async (ctx, storage, body) => {
		const result = await event.locals.db((tx) =>
			completeMasterUpload(tx, storage, ctx, event.params.masterId, body)
		);
		return result.status === 'ready'
			? { status: 'ready' as const, masterId: result.master.id }
			: result;
	});
