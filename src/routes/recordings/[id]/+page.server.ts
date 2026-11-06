import { error, fail } from '@sveltejs/kit';
import { latestReadyMasterId, recordingAnalysis } from '#lib/server/analysis.js';
import { canSubmitJobs, JobError, queueAudioKitJob } from '#lib/server/audiokit-jobs.js';
import { getRecording } from '#lib/server/catalog.js';
import {
	addCredit,
	approveCredit,
	removeCredit,
	updateRecording
} from '#lib/server/catalog-edit.js';
import { editAction, formFields } from '#lib/server/form.js';
import { requireScope } from '#lib/server/guard.js';
import { canUploadMasters, listMasters } from '#lib/server/masters.js';
import {
	compositionsForRecording,
	createComposition,
	holderOptions,
	holdersFromForm,
	listCompositions,
	recordingOwnership,
	setOwnership,
	setRecordingLink
} from '#lib/server/rights.js';
import { hasScope } from '#lib/server/rbac.js';
import { masterStorage } from '#lib/server/storage/env.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const m = requireScope(locals, 'catalog:read');
	if (!/^[0-9a-f-]{36}$/.test(params.id)) error(404, 'Recording not found');
	const data = await locals.db((tx) => getRecording(tx, m.orgId, params.id));
	if (!data) error(404, 'Recording not found');
	const rights = {
		read: hasScope(m.role, 'rights:read'),
		write: hasScope(m.role, 'rights:write')
	};
	const masters = await locals.db((tx) => listMasters(tx, m.orgId, params.id));
	const analysis = await locals.db((tx) => recordingAnalysis(tx, m.orgId, params.id));
	return {
		...data,
		ownership: rights.read
			? await locals.db((tx) => recordingOwnership(tx, m.orgId, params.id))
			: null,
		holders: rights.write ? await locals.db((tx) => holderOptions(tx, m.orgId)) : null,
		compositions: await locals.db((tx) => compositionsForRecording(tx, m.orgId, params.id)),
		compositionChoices: rights.write
			? await locals.db((tx) => listCompositions(tx, m.orgId))
			: null,
		masters,
		analysis,
		previewPlayable: masterStorage() !== null && analysis.preview.status === 'done',
		uploadsEnabled: masterStorage() !== null,
		can: {
			uploadMaster: canUploadMasters(m.role),
			edit: hasScope(m.role, 'catalog:write'),
			approve: hasScope(m.role, 'metadata:approve'),
			rights: rights.write,
			runAnalysis: canSubmitJobs(m.role) && masters.some((master) => master.status === 'ready')
		}
	};
};

const ctxFor = (
	locals: App.Locals,
	scope: 'catalog:write' | 'metadata:approve' | 'rights:write'
) => {
	const m = requireScope(locals, scope);
	return { orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' as const } };
};

export const actions: Actions = {
	newComposition: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals, 'rights:write');
		const f = await formFields(request);
		return editAction('newComposition', f, () =>
			locals.db((tx) =>
				createComposition(tx, ctx, { title: f.title, iswc: f.iswc, recordingIds: [params.id] })
			)
		);
	},
	linkComposition: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals, 'rights:write');
		const f = await formFields(request);
		return editAction('linkComposition', f, () =>
			locals.db((tx) => setRecordingLink(tx, ctx, f.compositionId, params.id, true))
		);
	},
	setMaster: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals, 'rights:write');
		const f = await formFields(request);
		return editAction('setMaster', f, () =>
			locals.db((tx) =>
				setOwnership(tx, ctx, {
					right: 'master',
					targetId: params.id,
					territory: f.territory || 'WW',
					holders: holdersFromForm(f)
				})
			)
		);
	},
	save: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals, 'catalog:write');
		const f = await formFields(request);
		return editAction('save', f, () =>
			locals.db((tx) => updateRecording(tx, ctx, params.id, f, f.updatedAt))
		);
	},
	addCredit: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals, 'catalog:write');
		const f = await formFields(request);
		return editAction('addCredit', f, () =>
			locals.db((tx) => addCredit(tx, ctx, { recordingId: params.id }, f))
		);
	},
	removeCredit: async ({ request, locals }) => {
		const ctx = ctxFor(locals, 'catalog:write');
		const f = await formFields(request);
		return editAction('removeCredit', f, () =>
			locals.db((tx) => removeCredit(tx, ctx, f.creditId))
		);
	},
	approveCredit: async ({ request, locals }) => {
		const ctx = ctxFor(locals, 'metadata:approve');
		const f = await formFields(request);
		return editAction('approveCredit', f, () =>
			locals.db((tx) => approveCredit(tx, ctx, f.creditId))
		);
	},
	runAnalysis: async ({ request, locals, params }) => {
		const m = requireScope(locals, 'catalog:write');
		const f = await formFields(request);
		const ctx = {
			orgId: m.orgId,
			role: m.role,
			actor: { id: locals.user!.id, kind: 'user' as const }
		};
		try {
			const masterId = await locals.db((tx) => latestReadyMasterId(tx, m.orgId, params.id));
			if (!masterId) {
				return fail(409, {
					action: 'runAnalysis',
					ok: false as const,
					errors: { form: 'Upload a ready master before running analysis.' },
					values: f
				});
			}
			const result = await locals.db((tx) =>
				queueAudioKitJob(tx, ctx, params.id, masterId, { operation: f.operation })
			);
			return { action: 'runAnalysis', ok: true as const, result };
		} catch (e) {
			if (e instanceof JobError)
				return fail(e.status, {
					action: 'runAnalysis',
					ok: false as const,
					errors: { form: e.message },
					values: f
				});
			throw e;
		}
	}
};
