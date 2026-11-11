import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/**
 * EPSILON-145: the recording page's Run / Re-run only queues. It takes one RLS transaction
 * through `locals.db`, and never reaches AudioKit, R2 or the network; the per-minute worker
 * submits the job (decision 0013).
 */
const mocks = vi.hoisted(() => ({
	queue: vi.fn(),
	resolver: vi.fn(),
	submit: vi.fn(),
	storage: vi.fn()
}));
vi.mock('./server/audiokit-jobs', async (original) => ({
	...(await original<object>()),
	queueJobForLatestMaster: mocks.queue,
	submitQueuedJob: mocks.submit
}));
vi.mock('./server/audiokit-clients', async (original) => ({
	...(await original<object>()),
	providerResolver: mocks.resolver
}));
vi.mock('./server/storage/env', async (original) => ({
	...(await original<object>()),
	masterStorage: mocks.storage
}));
const { JobError, NO_READY_MASTER } = await import('./server/audiokit-jobs');
const { actions } = await import('../routes/recordings/[id]/+page.server');

const tx = { marker: 'tx' };
let db: ReturnType<typeof vi.fn>;
const event = (role = 'catalog_manager') =>
	({
		request: new Request('http://localhost/recordings/x?/runAnalysis', {
			method: 'POST',
			body: new URLSearchParams({ operation: 'loudness' })
		}),
		params: { id: 'recording' },
		locals: {
			user: { id: 'member' },
			membership: { orgId: 'label', role },
			db
		}
	}) as never;

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	for (const m of Object.values(mocks)) m.mockReset();
	db = vi.fn(async (run: (t: object) => unknown) => run(tx));
	fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in the action'));
});
afterEach(() => fetchSpy.mockRestore());

it('queues in one locals.db transaction and returns without touching AudioKit or R2', async () => {
	const result = { jobId: 'job', status: 'queued', operation: 'loudness' };
	mocks.queue.mockResolvedValue(result);

	expect(await actions.runAnalysis(event())).toEqual({ action: 'runAnalysis', ok: true, result });

	expect(db).toHaveBeenCalledOnce();
	expect(mocks.queue).toHaveBeenCalledOnce();
	expect(mocks.queue).toHaveBeenCalledWith(
		tx,
		{ orgId: 'label', role: 'catalog_manager', actor: { id: 'member', kind: 'user' } },
		'recording',
		{ operation: 'loudness' }
	);
	expect(mocks.submit).not.toHaveBeenCalled();
	expect(mocks.resolver).not.toHaveBeenCalled();
	expect(mocks.storage).not.toHaveBeenCalled();
	expect(fetchSpy).not.toHaveBeenCalled();
});

it('answers a recording with no ready master with the same 409 as before', async () => {
	mocks.queue.mockRejectedValue(new JobError(409, NO_READY_MASTER));
	expect(await actions.runAnalysis(event())).toMatchObject({
		status: 409,
		data: { action: 'runAnalysis', ok: false, errors: { form: NO_READY_MASTER } }
	});
	expect(db).toHaveBeenCalledOnce();
});
