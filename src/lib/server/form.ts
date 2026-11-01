import { fail } from '@sveltejs/kit';
import { EditError } from './catalog-edit';

/** Plain string fields of a submitted form. */
export async function formFields(request: Request) {
	const form = await request.formData();
	const fields: Record<string, string> = {};
	for (const [k, v] of form) if (typeof v === 'string') fields[k] = v;
	return fields;
}

/**
 * Run an edit for a form action. EditError becomes a 400 with field messages;
 * anything else is a real failure and is rethrown.
 */
export async function editAction<T>(
	action: string,
	fields: Record<string, string>,
	run: () => Promise<T>
) {
	try {
		const result = await run();
		return { action, ok: true as const, result };
	} catch (e) {
		if (e instanceof EditError)
			return fail(400, { action, ok: false as const, errors: e.fields, values: fields });
		throw e;
	}
}
