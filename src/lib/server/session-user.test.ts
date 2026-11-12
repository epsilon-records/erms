import { describe, expect, it, vi } from 'vitest';
import { claimedUserId, verifiedUser, type SessionAuth } from './session-user';

/**
 * EPSILON-145: the hook reads memberships while Supabase Auth verifies the session, and keeps the
 * read only when Auth returns the user the token claimed. The user always comes from getUser().
 */
const alice = '00000000-0000-7000-8000-0000000145d1';
const mallory = '00000000-0000-7000-8000-0000000145d2';
const tokenFor = (sub: unknown) =>
	`header.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.signature`;

function fakeAuth(token: string | null, verified: string | null) {
	let answer!: () => void;
	const gate = new Promise<void>((resolve) => (answer = resolve));
	const auth = {
		getSession: vi.fn(async () => ({ data: { session: token ? { access_token: token } : null } })),
		getUser: vi.fn(async () => {
			await gate;
			return { data: { user: verified ? ({ id: verified } as never) : null } };
		})
	} satisfies SessionAuth;
	return { auth, answer };
}

describe('verifiedUser', () => {
	it('reads the memberships while Auth is still verifying, and keeps them for that user', async () => {
		const { auth, answer } = fakeAuth(tokenFor(alice), alice);
		const load = vi.fn(async (id: string) => `rows of ${id}`);
		const result = verifiedUser(auth, load);
		await vi.waitFor(() => expect(load).toHaveBeenCalledWith(alice));
		expect(auth.getUser).toHaveBeenCalledWith(tokenFor(alice)); // Auth has not answered yet
		answer();
		expect(await result).toEqual({ user: { id: alice }, loaded: `rows of ${alice}` });
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("throws away a read for a user Auth didn't return, and reads for the verified one", async () => {
		const { auth, answer } = fakeAuth(tokenFor(mallory), alice);
		const load = vi.fn(async (id: string) => `rows of ${id}`);
		const result = verifiedUser(auth, load);
		answer();
		expect(await result).toEqual({ user: { id: alice }, loaded: `rows of ${alice}` });
		expect(load.mock.calls).toEqual([[mallory], [alice]]);
	});

	it('returns no one when Auth rejects the token, whatever it claimed', async () => {
		const { auth, answer } = fakeAuth(tokenFor(alice), null);
		const result = verifiedUser(auth, async (id) => `rows of ${id}`);
		answer();
		expect(await result).toBeNull();
	});

	it('reads after verification when the early read fails', async () => {
		const { auth, answer } = fakeAuth(tokenFor(alice), alice);
		const load = vi
			.fn<(id: string) => Promise<string>>()
			.mockRejectedValueOnce(new Error('pool busy'))
			.mockResolvedValueOnce('rows');
		const result = verifiedUser(auth, load);
		answer();
		expect(await result).toEqual({ user: { id: alice }, loaded: 'rows' });
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('reads nothing early from a token that names no user id', async () => {
		const { auth, answer } = fakeAuth(tokenFor('not-a-uuid'), alice);
		const load = vi.fn(async (id: string) => `rows of ${id}`);
		const result = verifiedUser(auth, load);
		answer();
		expect(await result).toEqual({ user: { id: alice }, loaded: `rows of ${alice}` });
		expect(load.mock.calls).toEqual([[alice]]);
	});

	it('asks getUser() with no token when there is no session, as before', async () => {
		const { auth, answer } = fakeAuth(null, null);
		const load = vi.fn();
		const result = verifiedUser(auth, load);
		answer();
		expect(await result).toBeNull();
		expect(auth.getUser).toHaveBeenCalledWith();
		expect(load).not.toHaveBeenCalled();
	});
});

describe('claimedUserId', () => {
	it("reads a token's sub only when it is a user id", () => {
		expect(claimedUserId(tokenFor(alice))).toBe(alice);
		expect(claimedUserId(tokenFor(42))).toBeNull();
		expect(claimedUserId(tokenFor("x' or 1=1"))).toBeNull();
		expect(claimedUserId('not a jwt')).toBeNull();
		expect(claimedUserId('a.%%%.b')).toBeNull();
	});
});
