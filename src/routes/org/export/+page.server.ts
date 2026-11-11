import { and, asc, eq } from 'drizzle-orm';
import { masters, recordings } from '#lib/server/db/schema.js';
import { requireScope } from '#lib/server/guard.js';
import type { PageServerLoad } from './$types';

/** The export page, for owners: the catalogue download and every ready master. */
export const load: PageServerLoad = async ({ locals }) => {
	const m = requireScope(locals, 'roles:manage');
	const rows = await locals.db((tx) =>
		tx
			.select({
				id: masters.id,
				fileName: masters.fileName,
				sizeBytes: masters.sizeBytes,
				recording: recordings.title
			})
			.from(masters)
			.innerJoin(
				recordings,
				and(eq(recordings.orgId, masters.orgId), eq(recordings.id, masters.recordingId))
			)
			.where(and(eq(masters.orgId, m.orgId), eq(masters.status, 'ready')))
			.orderBy(asc(recordings.title), asc(masters.createdAt))
	);
	return { orgName: m.orgName, masters: rows };
};
