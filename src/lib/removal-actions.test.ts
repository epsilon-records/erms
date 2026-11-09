import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), ownership: vi.fn(), composition: vi.fn() }));
vi.mock('./server/rights', async (original) => ({
	...(await original<object>()),
	ownershipFor: mocks.ownership,
	getComposition: mocks.composition,
	setOwnership: mocks.mutate,
	setWriters: mocks.mutate,
	setRecordingLink: mocks.mutate
}));
vi.mock('./server/catalog-edit', async (original) => ({
	...(await original<object>()),
	removeCredit: mocks.mutate
}));
vi.mock('./server/members', async (original) => ({
	...(await original<object>()),
	removeMember: mocks.mutate
}));
const members = (await import('../routes/members/+page.server')).actions;
const recording = (await import('../routes/recordings/[id]/+page.server')).actions;
const release = (await import('../routes/releases/[id]/edit/+page.server')).actions;
const composition = (await import('../routes/compositions/[id]/+page.server')).actions;
const event = (fields: Record<string, string>) =>
	({
		request: new Request('http://localhost/fixture', {
			method: 'POST',
			body: new URLSearchParams(fields)
		}),
		params: { id: 'target' },
		locals: {
			user: { id: 'owner' },
			membership: { orgId: 'label', role: 'owner' },
			db: async (run: (tx: object) => unknown) => run({})
		}
	}) as never;
beforeEach(() => {
	mocks.mutate.mockReset();
	mocks.ownership.mockResolvedValue([
		{ territory: 'WW', holders: [{ holder: 'p:a' }] },
		{ territory: 'NL', holders: [{ holder: 'p:b' }] }
	]);
	mocks.composition.mockResolvedValue({ writers: [{ partyId: 'a', role: 'composer' }] });
});
it.each([
	['member', members.remove, { userId: 'other' }],
	['recording credit', recording.removeCredit, { creditId: 'credit' }],
	['release credit', release.removeCredit, { creditId: 'credit' }],
	['unlink', composition.unlink, { recordingId: 'recording' }]
] as const)(
	'%s plain POST cannot remove; confirmation calls original mutation once',
	async (_name, action, fields) => {
		expect(await action(event(fields))).toMatchObject({ status: 400 });
		expect(mocks.mutate).not.toHaveBeenCalled();
		expect(await action(event({ ...fields, removalConfirmed: 'yes' }))).toMatchObject({ ok: true });
		expect(mocks.mutate).toHaveBeenCalledOnce();
	}
);
it.each([recording.setMaster, composition.setPublishing])(
	'compares ownership against the submitted territory and guards clearing and partial omissions',
	async (action) => {
		expect(await action(event({ territory: 'nl', holder_0: 'p:a' }))).toMatchObject({
			status: 400
		});
		expect(await action(event({ territory: 'WW' }))).toMatchObject({ status: 400 });
		expect(mocks.mutate).not.toHaveBeenCalled();
		expect(
			await action(
				event({ territory: 'nl', holder_0: 'p:b', share_0: '75', holder_1: 'p:c', share_1: '25' })
			)
		).toMatchObject({ ok: true });
		expect(await action(event({ territory: 'NL', removalConfirmed: 'yes' }))).toMatchObject({
			ok: true
		});
		expect(mocks.mutate).toHaveBeenCalledTimes(2);
	}
);
it('writer role change and clear require confirmation, retained identities and additions do not', async () => {
	expect(await composition.writers(event({ writer_0: 'a', role_0: 'lyricist' }))).toMatchObject({
		status: 400
	});
	expect(await composition.writers(event({}))).toMatchObject({ status: 400 });
	expect(mocks.mutate).not.toHaveBeenCalled();
	expect(
		await composition.writers(
			event({
				writer_0: 'a',
				role_0: 'composer',
				share_0: '50',
				writer_1: 'b',
				role_1: 'lyricist',
				share_1: '50'
			})
		)
	).toMatchObject({ ok: true });
	expect(await composition.writers(event({ removalConfirmed: 'yes' }))).toMatchObject({ ok: true });
	expect(mocks.mutate).toHaveBeenCalledTimes(2);
});
