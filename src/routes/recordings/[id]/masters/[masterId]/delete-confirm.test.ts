import { describe, expect, it, vi } from 'vitest';

// R2 configured, but a stand-in: nothing here may reach storage or the database.
vi.mock('#lib/server/storage/env.js', () => ({ masterStorage: () => ({}) }));
const deleteMaster = vi.fn(async (..._args: unknown[]) => ({
	status: 'deleted' as const,
	masterId: MASTER
}));
vi.mock('#lib/server/masters.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/masters.js')>()),
	deleteMaster
}));

const { DELETE } = await import('./+server');

const ORIGIN = 'https://erms.epsilonrecords.com';
const REC = '00000000-0000-7000-8000-00000000d001';
const MASTER = '00000000-0000-7000-8000-00000000d002';

/** A DELETE from the page's own origin by an owner, with the given body (if any). */
function event(body?: unknown) {
	const url = new URL(`${ORIGIN}/recordings/${REC}/masters/${MASTER}`);
	const db = vi.fn((run: (tx: unknown) => unknown) => run({}));
	const request = new Request(url, {
		method: 'DELETE',
		headers: {
			origin: ORIGIN,
			...(body === undefined ? {} : { 'content-type': 'application/json' })
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const locals = {
		user: { id: '00000000-0000-7000-8000-0000000000a1' },
		membership: { orgId: 'org', orgName: 'Label A', role: 'owner' },
		db
	};
	return { db, ev: { request, url, locals, params: { id: REC, masterId: MASTER } } as never };
}

describe('master delete needs confirmation (decision 0023)', () => {
	it.each([
		['no body', undefined],
		['an empty body', {}],
		['a wrong value', { removalConfirmed: true }],
		['another field', { confirm: 'yes' }]
	])('refuses a delete with %s and touches nothing', async (_, body) => {
		deleteMaster.mockClear();
		const { db, ev } = event(body);
		await expect(DELETE(ev)).rejects.toMatchObject({
			status: 400,
			body: { message: expect.stringContaining('confirmation') }
		});
		expect(db).not.toHaveBeenCalled();
		expect(deleteMaster).not.toHaveBeenCalled();
	});

	it('deletes once the confirmation is sent', async () => {
		deleteMaster.mockClear();
		const { db, ev } = event({ removalConfirmed: 'yes' });
		const res = await DELETE(ev);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: 'deleted', masterId: MASTER });
		expect(db).toHaveBeenCalledOnce();
		expect(deleteMaster).toHaveBeenCalledOnce();
		expect(deleteMaster.mock.calls[0]).toContain(MASTER);
	});

	it('still refuses a cross-origin delete before looking at the confirmation', async () => {
		const { db, ev } = event({ removalConfirmed: 'yes' });
		(ev as { request: Request }).request = new Request(
			`${ORIGIN}/recordings/${REC}/masters/${MASTER}`,
			{
				method: 'DELETE',
				headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
				body: JSON.stringify({ removalConfirmed: 'yes' })
			}
		);
		await expect(DELETE(ev)).rejects.toMatchObject({ status: 403 });
		expect(db).not.toHaveBeenCalled();
	});
});
