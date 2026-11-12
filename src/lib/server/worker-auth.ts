import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Check the shared bearer secret used by scheduled machine endpoints
 * (`Authorization: Bearer <WORKER_SECRET>`).
 *
 * Both sides are hashed to the same length first and compared with `timingSafeEqual`, so the
 * time taken does not depend on how much of the presented value matches.
 */
export function isAuthorizedWorkerRequest(
	request: Request,
	workerSecret = process.env.WORKER_SECRET
): boolean {
	if (!workerSecret) return false;
	const presented = request.headers.get('authorization') ?? '';
	return timingSafeEqual(digest(presented), digest(`Bearer ${workerSecret}`));
}
