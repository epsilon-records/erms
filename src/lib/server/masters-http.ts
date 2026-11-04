import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireScope } from './guard';
import { type MasterCtx, MasterError } from './masters';
import { masterStorage } from './storage/env';
import type { MasterStorage } from './storage/r2';

/**
 * Shared handling for the master upload endpoints: same-origin JSON only, a catalog:write
 * member of the active org, and R2 configured. Each call gets the caller's org from the
 * session, never from the request.
 */
export async function masterEndpoint<T>(
	event: Pick<RequestEvent, 'request' | 'locals' | 'url'>,
	run: (ctx: MasterCtx, storage: MasterStorage, body: unknown) => Promise<T>
) {
	const { request, locals, url } = event;
	// SvelteKit's CSRF check covers form posts only; these endpoints take JSON.
	if (request.headers.get('origin') !== url.origin) error(403, 'Cross-origin request refused.');
	const m = requireScope(locals, 'catalog:write');
	const storage = masterStorage();
	if (!storage) error(503, 'Master uploads are not set up yet.');
	let body: unknown = {};
	if (request.headers.get('content-type')?.startsWith('application/json')) {
		body = await request.json().catch(() => error(400, 'Invalid JSON.'));
	}
	const ctx: MasterCtx = {
		orgId: m.orgId,
		role: m.role,
		actor: { id: locals.user!.id, kind: 'user' }
	};
	try {
		return json(await run(ctx, storage, body));
	} catch (e) {
		if (e instanceof MasterError) error(e.status, e.message);
		throw e;
	}
}
