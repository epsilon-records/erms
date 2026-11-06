import { and, desc, eq } from 'drizzle-orm';
import { buildAnalysis, type Analysis } from '../analysis';
import type { Database } from './audit';
import { listJobs } from './audiokit-jobs';
import { masters } from './db/schema';

/** Org-scoped reads behind the recording page's analysis section. */

/**
 * The analysis shown on a recording page, derived from the AudioKit jobs stored for it.
 * `listJobs` is org-scoped, so a caller can never read another label's jobs.
 */
export async function recordingAnalysis(
	db: Database,
	orgId: string,
	recordingId: string
): Promise<Analysis> {
	const jobs = await listJobs(db, orgId, recordingId);
	return buildAnalysis(jobs);
}

/** Newest ready master for a recording, or null. Analysis jobs need a ready master. */
export async function latestReadyMasterId(
	db: Database,
	orgId: string,
	recordingId: string
): Promise<string | null> {
	const [master] = await db
		.select({ id: masters.id })
		.from(masters)
		.where(
			and(
				eq(masters.orgId, orgId),
				eq(masters.recordingId, recordingId),
				eq(masters.status, 'ready')
			)
		)
		.orderBy(desc(masters.createdAt))
		.limit(1);
	return master?.id ?? null;
}
