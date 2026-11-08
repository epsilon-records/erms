import { EditError } from './catalog-edit';

/** UX acknowledgement only: authorization and audit remain in the existing mutation. */
export function requireRemovalConfirmation(fields: Record<string, string>, removes = true) {
	if (removes && fields.removalConfirmed !== 'yes')
		throw new EditError({
			form: 'Removal requires confirmation. Enable JavaScript and submit again to review the confirmation; nothing was removed.'
		});
}
