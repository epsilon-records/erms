import { error } from '@sveltejs/kit';
import { getArtist } from '#lib/server/catalog.js';
import { db } from '#lib/server/db/client.js';
import { requireScope } from '#lib/server/guard.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const m = requireScope(locals, 'catalog:read');
	if (!/^[0-9a-f-]{36}$/.test(params.id)) error(404, 'Artist not found');
	const artist = await getArtist(db(), m.orgId, params.id);
	if (!artist) error(404, 'Artist not found');
	return { artist };
};
