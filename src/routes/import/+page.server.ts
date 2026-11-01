import { createHash } from 'node:crypto';
import { fail } from '@sveltejs/kit';
import { recentImports } from '#lib/server/catalog.js';
import { requireScope } from '#lib/server/guard.js';
import { applyImport } from '#lib/server/import/apply.js';
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

	const result = await locals.db((tx) =>
		applyImport(tx, plan, {
			orgId: m.orgId,
			actor: { id: locals.user!.id, kind: 'user' },
			fileName: csv.name,
			fileSha256: sha256,
			dryRun
		})
	);
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
