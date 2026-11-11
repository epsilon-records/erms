import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Check the shared bearer secret used by scheduled machine endpoints.
 *
 * Both sides are hashed first, so the comparison takes the same time whatever the presented
 * value's length or content.
 */
export function isAuthorizedWorkerRequest(
	request: Request,
	workerSecret = process.env.WORKER_SECRET
): boolean {
	if (!workerSecret) return false;
	const presented = request.headers.get('authorization') ?? '';
	const digest = (value: string) => createHash('sha256').update(value).digest();
	return timingSafeEqual(digest(presented), digest(`Bearer ${workerSecret}`));
}
