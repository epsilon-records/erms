import { describe, expect, it, vi } from 'vitest';

const revokeConsent = vi.fn(async (..._args: unknown[]) => ({ changed: true as const }));
vi.mock('#lib/server/rights.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/rights.js')>()),
	revokeConsent
}));

const { actions } = await import('./+page.server');

const CONSENT = '00000000-0000-7000-8000-00000000c001';

function event(fields: Record<string, string>, role = 'rights_admin') {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	const db = vi.fn((run: (tx: unknown) => unknown) => run({}));
	const request = new Request('https://erms.epsilonrecords.com/rights/consents?/revoke', {
		method: 'POST',
		body
	});
	const locals = {
		user: { id: '00000000-0000-7000-8000-0000000000a1' },
		membership: { orgId: 'org', orgName: 'Label A', role },
		db
	};
	return { db, ev: { request, locals } as never };
}

describe('consent revoke needs confirmation (decision 0023)', () => {
	it.each([
		['no confirmation', { consentId: CONSENT }],
		['an empty confirmation', { consentId: CONSENT, removalConfirmed: '' }],
		['a wrong value', { consentId: CONSENT, removalConfirmed: 'true' }]
	])('refuses a revoke with %s and touches nothing', async (_, fields) => {
		revokeConsent.mockClear();
		const { db, ev } = event(fields);
		const out = await actions.revoke(ev);
		expect(out).toMatchObject({
			status: 400,
			data: {
				action: 'revoke',
				ok: false,
				errors: { form: expect.stringContaining('confirmation') }
			}
		});
		expect(db).not.toHaveBeenCalled();
		expect(revokeConsent).not.toHaveBeenCalled();
	});

	it('revokes once the confirm step’s button is used', async () => {
		revokeConsent.mockClear();
		const { db, ev } = event({ consentId: CONSENT, removalConfirmed: 'yes' });
		expect(await actions.revoke(ev)).toMatchObject({ action: 'revoke', ok: true });
		expect(db).toHaveBeenCalledOnce();
		expect(revokeConsent.mock.calls[0]?.[2]).toBe(CONSENT);
	});

	it('checks the role before the confirmation', async () => {
		const { db, ev } = event({ consentId: CONSENT, removalConfirmed: 'yes' }, 'viewer');
		await expect(actions.revoke(ev)).rejects.toMatchObject({ status: 403 });
		expect(db).not.toHaveBeenCalled();
	});
});
