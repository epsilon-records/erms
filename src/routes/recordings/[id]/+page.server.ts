import { removedIdentities, submittedIdentities } from '#lib/removal-confirmation.js';
import { requireRemovalConfirmation } from '#lib/server/removal-confirmation.js';
import { error, fail } from '@sveltejs/kit';
import { recordingAnalysis } from '#lib/server/analysis.js';
import { canSubmitJobs, JobError, queueJobForLatestMaster } from '#lib/server/audiokit-jobs.js';
import { countAnalysesThisMonth, LIMIT_MESSAGES, limitsFor } from '#lib/server/plans.js';
import { plansConfig } from '#lib/server/plans-env.js';
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
	ownershipFor,
	setOwnership,
	setRecordingLink
} from '#lib/server/rights.js';
import { hasScope } from '#lib/server/rbac.js';
import { masterStorage } from '#lib/server/storage/env.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const m = requireScope(locals, 'catalog:read');
	if (!/^[0-9a-f-]{36}$/.test(params.id)) error(404, 'Recording not found');
	const rights = {
		read: hasScope(m.role, 'rights:read'),
		write: hasScope(m.role, 'rights:write')
	};
	// Independent reads, each its own RLS transaction, run side by side: production pays ~100 ms
	// a database round trip, and run one after another they were most of the wait after a Run
	// (EPSILON-145), because the page reloads its data once the action returns.
	const [data, masters, analysis, ownership, holders, compositions, compositionChoices] =
		await Promise.all([
			locals.db((tx) => getRecording(tx, m.orgId, params.id)),
			locals.db((tx) => listMasters(tx, m.orgId, params.id)),
			locals.db((tx) => recordingAnalysis(tx, m.orgId, params.id)),
			rights.read ? locals.db((tx) => recordingOwnership(tx, m.orgId, params.id)) : null,
			rights.write ? locals.db((tx) => holderOptions(tx, m.orgId)) : null,
			locals.db((tx) => compositionsForRecording(tx, m.orgId, params.id)),
			rights.write ? locals.db((tx) => listCompositions(tx, m.orgId)) : null
		]);
	if (!data) error(404, 'Recording not found');
	return {
		...data,
		ownership,
		holders,
		compositions,
		compositionChoices,
		masters,
		analysis,
		previewPlayable: masterStorage() !== null && analysis.preview.status === 'done',
		uploadsEnabled: masterStorage() !== null,
		can: {
			uploadMaster: canUploadMasters(m.role),
			deleteMaster: canUploadMasters(m.role),
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
			locals.db(async (tx) => {
				const groups = await ownershipFor(tx, ctx.orgId, 'master', params.id);
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
					right: 'master',
					targetId: params.id,
					territory: f.territory || 'WW',
					holders: holdersFromForm(f)
				});
			})
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
		return editAction(
			'removeCredit',
			f,
			() => (requireRemovalConfirmation(f), locals.db((tx) => removeCredit(tx, ctx, f.creditId)))
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
			// Only queues: one RLS transaction, no AudioKit or R2 call. The per-minute worker submits
			// the job (decision 0013, EPSILON-145).
			const limits = await limitsFor(plansConfig(), m.orgId);
			const result = await locals.db(async (tx) => {
				if (limits && (await countAnalysesThisMonth(tx, m.orgId)) >= limits.analysisJobsPerMonth)
					throw new JobError(402, LIMIT_MESSAGES.analysis(limits.analysisJobsPerMonth));
				return queueJobForLatestMaster(tx, ctx, params.id, { operation: f.operation });
			});
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
