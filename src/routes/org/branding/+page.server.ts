import { error, fail } from '@sveltejs/kit';
import { clearBrandCache } from '#lib/server/branding.js';
import {
	BrandingError,
	checkIcon,
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
export const load: PageServerLoad = async ({ locals }) => {
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
		iconMax: ICON_MAX_PX
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const m = requireScope(locals, 'roles:manage');
		const form = await request.formData();
		const displayNameIn = String(form.get('displayName') ?? '');
		const accentIn = String(form.get('accent') ?? '');
		try {
			const displayName = parseDisplayName(displayNameIn);
			const accent = parseAccent(accentIn);
			const current = await locals.db((tx) => loadBranding(tx, m.orgId));
			let faviconPng = current?.faviconPng ?? null;
			const upload = form.get('icon');
			if (form.get('removeIcon') === 'on') {
				faviconPng = null;
			} else if (upload instanceof File && upload.size > 0) {
				const bytes = new Uint8Array(await upload.arrayBuffer());
				checkIcon(bytes);
				faviconPng = Buffer.from(bytes).toString('base64');
			}
			await locals.db((tx) => saveBranding(tx, m.orgId, { displayName, accent, faviconPng }));
			clearBrandCache();
			return { saved: true };
		} catch (e) {
			if (e instanceof BrandingError) {
				return fail(e.status, { error: e.message, displayName: displayNameIn, accent: accentIn });
			}
			throw e;
		}
	}
};
