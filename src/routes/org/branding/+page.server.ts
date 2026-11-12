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
import {
	activateDomain,
	cancelDomainRequest,
	DomainError,
	failDomain,
	hasVerificationRecord,
	isApex,
	parseDomain,
	removeDomain,
	requestDomain,
	ROUTING,
	txtName,
	txtValue
} from '#lib/server/custom-domain.js';
import { domainProvisioner } from '#lib/server/custom-domain-env.js';
import { requireScope } from '#lib/server/guard.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Branding for the label's owners: display name, accent colour, tab icon and the label's own
 * domain. The same settings for every label (knowledge labelkit 0034, 0036).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const m = requireScope(locals, 'roles:manage');
	const b = await locals.db((tx) => loadBranding(tx, m.orgId));
	if (!b) error(404, 'Label not found.');
	const pending = b.domainRequested && b.domainToken ? b.domainRequested : null;
	return {
		orgName: m.orgName,
		name: b.name,
		displayName: b.displayName,
		accent: b.accent,
		icon: b.faviconPng ? `data:image/png;base64,${b.faviconPng}` : null,
		iconMin: ICON_MIN_PX,
		iconMax: ICON_MAX_PX,
		domain: {
			active: b.customDomain,
			pending,
			status: b.domainStatus,
			error: b.domainError,
			// What the owner adds at their DNS provider for the pending domain.
			dns: pending
				? {
						txtName: txtName(pending),
						txtValue: txtValue(b.domainToken!),
						apex: isApex(pending),
						cname: ROUTING.cname,
						apexA: ROUTING.apexA
					}
				: null,
			provisioning: domainProvisioner().configured
		},
		saved: url.searchParams.has('saved')
	};
};

const domainFail = (e: unknown) => {
	if (e instanceof DomainError) return fail(e.status, { domainError: e.message });
	throw e;
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		const m = requireScope(locals, 'roles:manage');
		const form = await request.formData();
		const displayNameIn = String(form.get('displayName') ?? '');
		const accentIn = String(form.get('accent') ?? '');
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
			await locals.db((tx) => saveBranding(tx, m.orgId, { displayName, accent, icon }));
			clearBrandCache();
		} catch (e) {
			if (e instanceof BrandingError) {
				return fail(e.status, {
					error: e.message,
					field: e.field ?? null,
					displayName: displayNameIn,
					accent: accentIn
				});
			}
			throw e;
		}
		// A fresh request, so the hook resolves the brand again and the header, accent and tab
		// icon show what was just saved (this request's locals.brand predates the save).
		redirect(303, '/org/branding?saved');
	},

	/** Step 1: record the domain and issue the token for its TXT record. */
	requestDomain: async ({ request, locals }) => {
		const m = requireScope(locals, 'roles:manage');
		const input = String((await request.formData()).get('domain') ?? '');
		try {
			const domain = parseDomain(input);
			await locals.db((tx) => requestDomain(tx, m.orgId, domain));
			return { domainRequested: domain };
		} catch (e) {
			if (e instanceof DomainError)
				return fail(e.status, { domainError: e.message, domainInput: input });
			throw e;
		}
	},

	/** Step 2: read the TXT record; if it holds the token, provision the domain and activate it. */
	verifyDomain: async ({ locals }) => {
		const m = requireScope(locals, 'roles:manage');
		const b = await locals.db((tx) => loadBranding(tx, m.orgId));
		const domain = b?.domainRequested;
		if (!domain || !b?.domainToken) return fail(409, { domainError: 'Add a domain first.' });
		try {
			if (!(await hasVerificationRecord(domain, b.domainToken))) {
				const reason = `No TXT record ${txtName(domain)} with the expected value yet. DNS changes can take a few minutes, sometimes longer.`;
				await locals.db((tx) => failDomain(tx, m.orgId, domain, reason));
				return fail(409, { domainError: reason });
			}
			const provision = domainProvisioner();
			try {
				await provision.add(domain);
			} catch (e) {
				if (!(e instanceof DomainError)) throw e;
				await locals.db((tx) => failDomain(tx, m.orgId, domain, e.message));
				return fail(e.status, { domainError: e.message });
			}
			const previous = b.customDomain;
			await locals.db((tx) => activateDomain(tx, m.orgId, domain));
			clearBrandCache();
			// Moving to a new domain: the old one stops being served for this label.
			if (previous && previous !== domain) await provision.remove(previous).catch(() => {});
			return { domainActivated: domain };
		} catch (e) {
			return domainFail(e);
		}
	},

	/** Drops a pending request; the label's active domain, if any, stays. */
	cancelDomain: async ({ locals }) => {
		const m = requireScope(locals, 'roles:manage');
		try {
			await locals.db((tx) => cancelDomainRequest(tx, m.orgId));
			return { domainCancelled: true };
		} catch (e) {
			return domainFail(e);
		}
	},

	/** Removes the label's domain (or a pending request) and takes it off Netlify and Supabase Auth. */
	removeDomain: async ({ locals }) => {
		const m = requireScope(locals, 'roles:manage');
		try {
			const removed = await locals.db((tx) => removeDomain(tx, m.orgId));
			clearBrandCache();
			if (removed) await domainProvisioner().remove(removed);
			return { domainRemoved: true };
		} catch (e) {
			return domainFail(e);
		}
	}
};
