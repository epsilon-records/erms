import { createHash } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { recentImports } from '#lib/server/catalog.js';
import { requireScope } from '#lib/server/guard.js';
import { applyImport } from '#lib/server/import/apply.js';
import { countRecordings, LIMIT_MESSAGES, limitsFor, lockLimit } from '#lib/server/plans.js';
import { plansConfig } from '#lib/server/plans-env.js';

/** Thrown inside the import transaction to roll back an import that goes over the plan. */
class OverLimit extends Error {}
import {
	normalizeCsvText,
	parseSymphonicInventory,
	summarizePlan
} from '#lib/server/import/symphonic.js';
import type { Actions, PageServerLoad } from './$types';

const MAX_BYTES = 5 * 1024 * 1024;

export const load: PageServerLoad = async ({ locals }) => {
	const m = requireScope(locals, 'catalog:write');
	return { runs: await locals.db((tx) => recentImports(tx, m.orgId)) };
};

async function readCsv(form: FormData) {
	// Step 1 uploads a file; step 2 posts back the exact text that was previewed.
	const file = form.get('file');
	if (file instanceof File && file.size > 0) {
		if (file.size > MAX_BYTES) return { error: 'File is larger than 5 MB.' } as const;
		return { name: file.name, text: normalizeCsvText(await file.text()) } as const;
	}
	const text = form.get('csv');
	const name = form.get('fileName');
	if (typeof text === 'string' && text && typeof name === 'string') {
		// The confirm step posts the previewed text back; it gets the same limit as an upload.
		if (Buffer.byteLength(text) > MAX_BYTES) return { error: 'File is larger than 5 MB.' } as const;
		return { name, text: normalizeCsvText(text) } as const;
	}
	return { error: 'Choose a SymphonicMS inventory export (.csv).' } as const;
}

async function run(request: Request, locals: App.Locals, dryRun: boolean) {
	const m = requireScope(locals, 'catalog:write');
	const form = await request.formData();
	const csv = await readCsv(form);
	if ('error' in csv) return fail(400, { error: csv.error });

	const sha256 = createHash('sha256').update(csv.text).digest('hex');
	if (!dryRun && form.get('sha256') !== sha256) {
		return fail(400, { error: 'The file changed since the dry run. Run the dry run again.' });
	}

	const plan = parseSymphonicInventory(csv.text);
	const summary = summarizePlan(plan);
	const base = {
		fileName: csv.name,
		sha256,
		summary,
		issues: plan.issues.slice(0, 200),
		moreIssues: Math.max(0, plan.issues.length - 200)
	};
	if (summary.errors > 0) return fail(422, { ...base, stage: 'blocked' as const });

	const limits = await limitsFor(plansConfig(), m.orgId);
	let overLimit = false;
	let result;
	try {
		result = await locals.db(async (tx) => {
			if (limits) await lockLimit(tx, m.orgId, 'tracks');
			const applied = await applyImport(tx, plan, {
				orgId: m.orgId,
				actor: { id: locals.user!.id, kind: 'user' },
				fileName: csv.name,
				fileSha256: sha256,
				dryRun
			});
			// A dry run has already rolled back, so count what it would add on top of today's catalog.
			if (limits) {
				const total = dryRun
					? (await countRecordings(tx, m.orgId)) + applied.counts.recordings.created
					: await countRecordings(tx, m.orgId);
				if (total > limits.tracks) {
					overLimit = true;
					if (!dryRun) throw new OverLimit();
				}
			}
			return applied;
		});
	} catch (e) {
		if (e instanceof OverLimit) {
			return fail(402, {
				...base,
				stage: 'blocked' as const,
				limit: LIMIT_MESSAGES.tracks(limits!.tracks)
			});
		}
		throw e;
	}
	if (overLimit) {
		return fail(402, {
			...base,
			stage: 'blocked' as const,
			limit: LIMIT_MESSAGES.tracks(limits!.tracks)
		});
	}
	return {
		...base,
		stage: dryRun ? ('previewed' as const) : ('imported' as const),
		counts: result.counts,
		// Carried to the confirm step so the import applies exactly what was previewed.
		csv: dryRun ? csv.text : undefined
	};
}

export const actions: Actions = {
	preview: ({ request, locals }) => run(request, locals, true),
	apply: ({ request, locals }) => run(request, locals, false)
};
