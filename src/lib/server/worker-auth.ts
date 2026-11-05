/** Check the shared bearer secret used by scheduled machine endpoints. */
export function isAuthorizedWorkerRequest(
	request: Request,
	workerSecret = process.env.WORKER_SECRET
): boolean {
	return Boolean(workerSecret && request.headers.get('authorization') === `Bearer ${workerSecret}`);
}
