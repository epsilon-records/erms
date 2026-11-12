/**
 * Storybook gate (shared 0047, 0061): the storybook.labelkit.co site is only Storybook, so every
 * request needs the shared password. Fails closed: without STORYBOOK_PASSWORD every request is
 * refused.
 */

const REALM = 'LabelKit Storybook';

/** @param {string} text */
async function digest(text) {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/**
 * Compares hashes so the check doesn't leak the password's length or prefix through timing.
 * @param {string | null | undefined} header
 * @param {string | undefined} expected
 */
export async function passwordMatches(header, expected) {
	if (!expected || !header?.startsWith('Basic ')) return false;
	let decoded;
	try {
		decoded = atob(header.slice(6));
	} catch {
		return false;
	}
	const given = decoded.slice(decoded.indexOf(':') + 1);
	const [a, b] = await Promise.all([digest(given), digest(expected)]);
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

/** @param {(name: string) => string | undefined} env */
export function storybookGate(env) {
	/**
	 * @param {Request} request
	 * @param {{ next: () => Promise<Response> }} context
	 * @returns {Promise<Response>}
	 */
	return async (request, context) => {
		const password = env('STORYBOOK_PASSWORD');
		if (!password) return new Response('Storybook is not configured.', { status: 503 });
		if (!(await passwordMatches(request.headers.get('authorization'), password))) {
			return new Response('Password required.', {
				status: 401,
				headers: {
					'www-authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
					'x-robots-tag': 'noindex'
				}
			});
		}
		const response = await context.next();
		const headers = new Headers(response.headers);
		// Storybook renders stories in a same-origin iframe, so frames must stay allowed for this origin.
		headers.set('x-frame-options', 'SAMEORIGIN');
		headers.set('x-robots-tag', 'noindex');
		headers.set('cache-control', 'private, no-store');
		return new Response(response.body, { status: response.status, headers });
	};
}

export default storybookGate((name) => /** @type {any} */ (globalThis).Netlify?.env.get(name));
