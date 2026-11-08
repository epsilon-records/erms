import { removedIdentities, submittedIdentities } from '#lib/removal-confirmation.js';
import { requireRemovalConfirmation } from '#lib/server/removal-confirmation.js';
import { error } from '@sveltejs/kit';
import { editAction, formFields } from '#lib/server/form.js';
import { requireScope } from '#lib/server/guard.js';
import { hasScope } from '#lib/server/rbac.js';
import {
	getComposition,
	holderOptions,
	holdersFromForm,
	ownershipFor,
	recordingOptions,
	setOwnership,
	setRecordingLink,
	setWriters,
	updateComposition,
	writersFromForm
} from '#lib/server/rights.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const m = requireScope(locals, 'catalog:read');
	if (!/^[0-9a-f-]{36}$/.test(params.id)) error(404, 'Composition not found');
	const data = await locals.db((tx) => getComposition(tx, m.orgId, params.id));
	if (!data) error(404, 'Composition not found');
	const canRead = hasScope(m.role, 'rights:read');
	const canWrite = hasScope(m.role, 'rights:write');
	const [publishing, options, recordings] = await Promise.all([
		canRead ? locals.db((tx) => ownershipFor(tx, m.orgId, 'publishing', params.id)) : null,
		canWrite ? locals.db((tx) => holderOptions(tx, m.orgId)) : null,
		canWrite ? locals.db((tx) => recordingOptions(tx, m.orgId)) : null
	]);
	return { ...data, publishing, options, recordingChoices: recordings, can: { write: canWrite } };
};

const ctxFor = (locals: App.Locals) => {
	const m = requireScope(locals, 'rights:write');
	return { orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' as const } };
};

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals);
		const f = await formFields(request);
		return editAction('save', f, () =>
			locals.db((tx) => updateComposition(tx, ctx, params.id, f, f.updatedAt))
		);
	},
	writers: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals);
		const f = await formFields(request);
		return editAction('writers', f, () =>
			locals.db(async (tx) => {
				const current = await getComposition(tx, ctx.orgId, params.id);
				requireRemovalConfirmation(
					f,
					removedIdentities(
						current?.writers ?? [],
						submittedIdentities(f, 'writer'),
						(w) => `${w.partyId}:${w.role}`
					).length > 0
				);
				return setWriters(tx, ctx, { compositionId: params.id, writers: writersFromForm(f) });
			})
		);
	},
	setPublishing: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals);
		const f = await formFields(request);
		return editAction('setPublishing', f, () =>
			locals.db(async (tx) => {
				const groups = await ownershipFor(tx, ctx.orgId, 'publishing', params.id);
				const territory = (f.territory || 'WW').trim().toUpperCase();
				requireRemovalConfirmation(
					f,
					removedIdentities(
						groups.find((g) => g.territory === territory)?.holders ?? [],
						submittedIdentities(f, 'holder'),
						(h) => h.holder
					).length > 0
				);
				return setOwnership(tx, ctx, {
					right: 'publishing',
					targetId: params.id,
					territory: f.territory || 'WW',
					holders: holdersFromForm(f)
				});
			})
		);
	},
	link: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals);
		const f = await formFields(request);
		return editAction('link', f, () =>
			locals.db((tx) => setRecordingLink(tx, ctx, params.id, f.recordingId, true))
		);
	},
	unlink: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals);
		const f = await formFields(request);
		return editAction(
			'unlink',
			f,
			() => (
				requireRemovalConfirmation(f),
				locals.db((tx) => setRecordingLink(tx, ctx, params.id, f.recordingId, false))
			)
		);
	}
};
