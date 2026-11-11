import { exportCatalog, exportFileName } from '#lib/server/export.js';
import { requireScope } from '#lib/server/guard.js';
import type { RequestHandler } from './$types';

/** GET /org/export/catalog - the label's catalogue as a JSON download, for its owners. */
export const GET: RequestHandler = async ({ locals }) => {
	const m = requireScope(locals, 'roles:manage');
	const now = new Date();
	const body = await locals.db((tx) => exportCatalog(tx, { id: m.orgId, name: m.orgName }, now));
	return new Response(JSON.stringify(body, null, 2), {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Disposition': `attachment; filename="${exportFileName(m.orgName, now)}"`,
			'Cache-Control': 'no-store'
		}
	});
};
