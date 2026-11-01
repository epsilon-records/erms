import { error } from '@sveltejs/kit';
import { getRelease } from '#lib/server/catalog.js';
import { db } from '#lib/server/db/client.js';
import { requireScope } from '#lib/server/guard.js';
import { hasScope } from '#lib/server/rbac.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const m = requireScope(locals, 'catalog:read');
	if (!/^[0-9a-f-]{36}$/.test(params.id)) error(404, 'Release not found');
	const release = await getRelease(db(), m.orgId, params.id);
	if (!release) error(404, 'Release not found');
	return { release, can: { edit: hasScope(m.role, 'catalog:write') } };
};
