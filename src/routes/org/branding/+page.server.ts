import { error, fail, redirect } from '@sveltejs/kit';
import { clearBrandCache } from '#lib/server/branding.js';
import {
	BrandingError,
	checkIcon,
	type IconChange,
	ICON_MAX_PX,
	ICON_MIN_PX,
	loadBranding,
	parseAccent,
	parseDisplayName,
	saveBranding
} from '#lib/server/branding-settings.js';
import { requireScope } from '#lib/server/guard.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Branding for the label's owners: display name, accent colour and tab icon. The same settings
 * for every label; they show on the label's own domain. The domain itself is set up with us,
 * because it needs DNS and TLS.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const m = requireScope(locals, 'roles:manage');
	const b = await locals.db((tx) => loadBranding(tx, m.orgId));
	if (!b) error(404, 'Label not found.');
	return {
		orgName: m.orgName,
		name: b.name,
		displayName: b.displayName,
		accent: b.accent,
		icon: b.faviconPng ? `data:image/png;base64,${b.faviconPng}` : null,
		customDomain: b.customDomain,
		iconMin: ICON_MIN_PX,
		iconMax: ICON_MAX_PX,
		saved: url.searchParams.has('saved')
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const m = requireScope(locals, 'roles:manage');
		const form = await request.formData();
		const displayNameIn = String(form.get('displayName') ?? '');
		const accentIn = String(form.get('accent') ?? '');
		// What the form showed when it was loaded, to refuse a save made over another owner's change.
		const seenDisplayNameIn = String(form.get('seenDisplayName') ?? '');
		const seenAccentIn = String(form.get('seenAccent') ?? '');
		const seen = { displayName: seenDisplayNameIn || null, accent: seenAccentIn || null };
		try {
			const displayName = parseDisplayName(displayNameIn);
			const accent = parseAccent(accentIn);
			let icon: IconChange = 'keep';
			const upload = form.get('icon');
			if (form.get('removeIcon') === 'on') {
				icon = 'remove';
			} else if (upload instanceof File && upload.size > 0) {
				const bytes = new Uint8Array(await upload.arrayBuffer());
				checkIcon(bytes);
				icon = { png: Buffer.from(bytes).toString('base64') };
			}
			await locals.db((tx) => saveBranding(tx, m.orgId, { displayName, accent, icon, seen }));
			clearBrandCache();
		} catch (e) {
			if (e instanceof BrandingError && e.status === 409) {
				// Another owner saved first: show their version (the page reloads it), not this form's.
				return fail(409, { error: e.message, field: null });
			}
			if (e instanceof BrandingError) {
				return fail(e.status, {
					error: e.message,
					field: e.field ?? null,
					displayName: displayNameIn,
					accent: accentIn,
					seenDisplayName: seenDisplayNameIn,
					seenAccent: seenAccentIn
				});
			}
			throw e;
		}
		// A fresh request, so the hook resolves the brand again and the header, accent and tab
		// icon show what was just saved (this request's locals.brand predates the save).
		redirect(303, '/org/branding?saved');
	}
};
