import { fail } from '@sveltejs/kit';
import {
	API_KEY_SCOPES,
	ApiKeyError,
	createApiKey,
	listApiKeys,
	revokeApiKey
} from '#lib/server/api-keys.js';
import { requireScope } from '#lib/server/guard.js';
import type { Actions, PageServerLoad } from './$types';

/** API keys for the public /v1 API (EPSILON-137), for the label's owners. */
export const load: PageServerLoad = async ({ locals }) => {
	const m = requireScope(locals, 'roles:manage');
	const keys = await locals.db((tx) => listApiKeys(tx, m.orgId));
	return { orgName: m.orgName, keys, scopes: API_KEY_SCOPES };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const m = requireScope(locals, 'roles:manage');
		const form = await request.formData();
		const name = String(form.get('name') ?? '');
		const scopes = form.getAll('scopes').map(String);
		try {
			const created = await locals.db((tx) => createApiKey(tx, m.orgId, { name, scopes }));
			// The only time the key is ever shown.
			return { created: { key: created.key, prefix: created.prefix, name: name.trim() } };
		} catch (e) {
			if (e instanceof ApiKeyError) return fail(e.status, { error: e.message, name });
			throw e;
		}
	},
	revoke: async ({ request, locals }) => {
		requireScope(locals, 'roles:manage');
		const id = String((await request.formData()).get('id') ?? '');
		try {
			await locals.db((tx) => revokeApiKey(tx, id));
			return { revoked: true };
		} catch (e) {
			if (e instanceof ApiKeyError) return fail(e.status, { error: e.message });
			throw e;
		}
	}
};
