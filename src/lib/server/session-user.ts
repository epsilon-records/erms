import type { User } from '@supabase/supabase-js';

/** The part of Supabase Auth the request hook uses. */
export type SessionAuth = {
	getSession(): Promise<{ data: { session: { access_token: string } | null } }>;
	getUser(jwt?: string): Promise<{ data: { user: User | null } }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `sub` an access token claims, unverified, or null if it doesn't read as a user id. */
export function claimedUserId(accessToken: string): string | null {
	try {
		const payload = JSON.parse(
			Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString()
		);
		return typeof payload?.sub === 'string' && UUID.test(payload.sub) ? payload.sub : null;
	} catch {
		return null;
	}
}

/**
 * The signed-in user, verified by Supabase Auth, and what `load` returns for them.
 *
 * Production pays about 340 ms for Auth's `getUser()` and about 98 ms for each database round trip
 * (functions in Ohio, Supabase in Frankfurt; knowledge labelkit/decisions/0029), so the hook's
 * membership read no longer waits for Auth (EPSILON-145). The read starts for the user the session
 * token claims while Auth checks that token, and its result is used only when Auth answers with
 * that same user. Otherwise it is thrown away, and the read runs again for the user Auth returned.
 * Verification is unchanged: the user still comes from `getUser()` and nothing else.
 *
 * `getSession()` only reads the session cookie (refreshing an expired token, as `getUser()` did
 * before it asked Auth). The token's claims are never trusted: they only pick what to read early.
 */
export async function verifiedUser<T>(
	auth: SessionAuth,
	load: (userId: string) => Promise<T>
): Promise<{ user: User; loaded: T } | null> {
	const {
		data: { session }
	} = await auth.getSession();
	if (!session?.access_token) {
		// No session: getUser() answers without a network call, and clears a broken cookie.
		const {
			data: { user }
		} = await auth.getUser();
		return user ? { user, loaded: await load(user.id) } : null;
	}

	const claimed = claimedUserId(session.access_token);
	// A failed early read is not an answer: it is read again below, once Auth has said who this is.
	const early = claimed
		? load(claimed).then(
				(v) => ({ v }),
				() => null
			)
		: Promise.resolve(null);
	const {
		data: { user }
	} = await auth.getUser(session.access_token);
	const read = await early;
	if (!user) return null;
	if (read && user.id === claimed) return { user, loaded: read.v };
	return { user, loaded: await load(user.id) };
}
