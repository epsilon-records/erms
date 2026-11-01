import { error } from '@sveltejs/kit';
import { getArtist } from '#lib/server/catalog.js';
import { renameParty } from '#lib/server/catalog-edit.js';
import { editAction, formFields } from '#lib/server/form.js';
import { requireScope } from '#lib/server/guard.js';
import { hasScope } from '#lib/server/rbac.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const m = requireScope(locals, 'catalog:read');
	if (!/^[0-9a-f-]{36}$/.test(params.id)) error(404, 'Artist not found');
	const artist = await locals.db((tx) => getArtist(tx, m.orgId, params.id));
	if (!artist) error(404, 'Artist not found');
	return { artist, can: { edit: hasScope(m.role, 'catalog:write') } };
};

export const actions: Actions = {
	rename: async ({ request, locals, params }) => {
		const m = requireScope(locals, 'catalog:write');
		const f = await formFields(request);
		return editAction('rename', f, () =>
			locals.db((tx) =>
				renameParty(
					tx,
					{ orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' } },
					params.id,
					f
				)
			)
		);
	}
};
